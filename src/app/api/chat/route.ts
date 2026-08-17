import { NextRequest, NextResponse } from 'next/server';
import { GoogleGenerativeAI, TaskType } from '@google/generative-ai';
import { createClient } from '@supabase/supabase-js';
import OpenAI from 'openai';
import { db } from '@/infrastructure/db/client';
import { chatMessages } from '@/infrastructure/db/schema';
import { loadAuthorizedParcelInputs } from '@/infrastructure/db/parcelContextRepository';
import {
  buildNormalizedParcelContext,
  trustedMunicipalityCodeFilter,
} from '@/application/parcel-context/normalizeParcelContext';
import {
  classifyParcelQuestionScope,
  evaluateApplicability,
  isConditionalViabilityQuestion,
  requiresDeterminedParcelRegime,
} from '@/application/parcel-context/applicabilityEngine';
import {
  buildNormativeSearchScope,
  canSearchNormativeInformation,
  type NormativeSearchScope,
} from '@/application/parcel-context/normativeSearchScope';
import { resolveSupplementaryNormativeScope } from '@/application/parcel-context/supplementaryNormativeScope';
import {
  buildAnswerContract,
  buildMunicipalSafetyPrompt,
  buildReviewSafetyPrompt,
  buildSafeAbstention,
  buildStructuredParcelFactAnswer,
  sanitizeTechnicalPlaceholders,
  parseReasonerOutput,
  validateReasonerOutput,
  renderFinalAnswer,
  type ClaimValidationResult,
} from '@/application/parcel-context/responseSafety';
import { getOfficialPlanningDocumentUrl } from '@/infrastructure/planning-knowledge/PlanningKnowledgeBase';
import type { ApplicabilityResult, NormativeCandidate, ReasonerOutput } from '@/domain/parcel-context/types';
import { getExpedienteAccess } from '@/application/authorization/expedienteAccess';
import { acquireChatSlot, CHAT_REQUEST_TIMEOUT_MS, MAX_CHAT_MESSAGE_LENGTH } from '@/application/chat/chatRequestGuard';
import type { KnowledgePlan } from '@/application/knowledge-orchestrator/KnowledgeOrchestrator';
import {
  scheduleFactualShadowPipeline,
  scheduleFactualShadowResultPersistence,
} from '@/application/parcel-context/shadow/shadowIntegration';
import {
  buildTerritorialFactualContract,
  type TerritorialCoverageDerivationDiagnostics,
} from '@/application/parcel-context/buildFactualContract';
import { runTerritorialFactualShadowPipeline } from '@/application/parcel-context/shadow/shadowPipeline';
import {
  assessVisibleFactualResult,
  isSynchronousFactualEnabled,
  shouldRunVisibleFactual,
} from '@/application/parcel-context/shadow/visibleFactualRouting';
import {
  composeValidatedFactualAnswer,
  factualComposerModel,
  isFactualComposerEnabled,
} from '@/application/parcel-context/shadow/factualComposer';

// Init Gemini
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY!);

// Init DeepSeek via OpenAI SDK
const openai = new OpenAI({
  baseURL: 'https://api.deepseek.com/v1',
  apiKey: process.env.DEEPSEEK_API_KEY!,
});

// Init Supabase (Service Role)
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const supabase = createClient(supabaseUrl, supabaseKey);

interface V1Chunk {
  chunk_id: string | number;
  texto?: string | null;
  municipio_nombre?: string | null;
  nombre_pdf?: string | null;
  titulo_detectado?: string | null;
  pagina_detectada?: string | number | null;
  original_path?: string | null;
  similarity?: number | null;
}

interface V2SearchResult {
  chunk_id: string | number;
  content: string;
  title?: string | null;
  version?: string | null;
  similarity: number;
  page?: string | number | null;
  article?: string | null;
  chapter?: string | null;
  sourceUrl?: string | null;
  officialIdentifier?: string | null;
  scope?: string | null;
  category?: string | null;
}

type ChatNormativeCandidate = NormativeCandidate & {
  visibleSourceKind?: 'normative_v1' | 'normative_v2';
};

function safeHttpUrl(value?: string | null) {
  if (!value) return null;
  try {
    const url = new URL(value);
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) return null;
    return url.toString();
  } catch {
    return null;
  }
}

function resolveVisibleOfficialUrl(candidate: ChatNormativeCandidate) {
  if (candidate.visibleSourceKind === 'normative_v1') {
    const catalogUrl = safeHttpUrl(
      getOfficialPlanningDocumentUrl(candidate.parentInstrument, candidate.documentName)
    );
    if (catalogUrl) return catalogUrl;
  }
  return safeHttpUrl(candidate.sourceUrl);
}

function hierarchyForSupplementaryCandidate(result: V2SearchResult): NormativeCandidate['hierarchy'] {
  if (
    result.scope === 'especial' ||
    ['patrimonio', 'costas', 'carreteras', 'augas'].includes(result.category ?? '')
  ) {
    return 'sectorial';
  }
  if (result.scope === 'autonomico' || ['NHG', 'habitabilidad'].includes(result.category ?? '')) {
    return 'autonomico';
  }
  return 'estatal';
}

function mapV1Candidates(
  chunks: V1Chunk[],
  scope?: NormativeSearchScope,
  hierarchy: NormativeCandidate['hierarchy'] = 'municipal'
): ChatNormativeCandidate[] {
  return chunks.map((chunk) => ({
    id: String(chunk.chunk_id),
    content: chunk.texto ?? '',
    municipalityName: chunk.municipio_nombre ?? null,
    documentName: chunk.nombre_pdf ?? null,
    title: chunk.titulo_detectado ?? null,
    page: chunk.pagina_detectada ?? null,
    sourceUrl: chunk.original_path ?? null,
    similarity: chunk.similarity ?? null,
    hierarchy,
    // The scope limits retrieval; it is not evidence contained in the chunk.
    // V1 rows do not expose a proven ordinance or planning-area attribute.
    ordinance: null,
    planningArea: null,
    parentInstrument: scope?.instrumentId ?? null,
    visibleSourceKind: 'normative_v1',
  }));
}

function mapVisibleSources(candidates: ChatNormativeCandidate[]) {
  return candidates.map((candidate, index) => {
    const normalizedContent = candidate.content.trim();
    const normalizedPreview = normalizedContent.replace(/\s+/g, ' ');
    const isLargeV2Fragment =
      candidate.visibleSourceKind === 'normative_v2' && normalizedContent.length > 3_500;
    return {
      chunk_id: candidate.id,
      municipio_nombre:
        candidate.hierarchy === 'estatal'
          ? 'Ámbito estatal'
          : candidate.hierarchy === 'autonomico'
            ? 'Ámbito autonómico de Galicia'
            : candidate.hierarchy === 'sectorial'
              ? 'Normativa sectorial aplicable'
              : candidate.municipalityName ?? 'No identificado',
      nombre_pdf: candidate.documentName ?? 'Documento',
      titulo_detectado: candidate.title ?? '',
      similarity: candidate.similarity ?? 0,
      source_index: index + 1,
      source_kind: candidate.visibleSourceKind ?? 'normative_document',
      official_url: resolveVisibleOfficialUrl(candidate),
      pagina_detectada: candidate.page ?? null,
      fragmento_corto: `${normalizedPreview.slice(0, 180)}${normalizedPreview.length > 180 ? '…' : ''}`,
      fragmento_completo: isLargeV2Fragment ? null : normalizedContent || null,
      truncated: isLargeV2Fragment,
    };
  });
}

function requestsParcelNormativeDocuments(question: string) {
  return /\b(?:normativa|documentos?|fuentes?|regulaci[oó]n)\b/i.test(question)
}

async function handlePost(req: NextRequest, signal: AbortSignal) {
  let releaseChatSlot: (() => void) | undefined;
  try {
    const body = await req.json();
    const { message, expedienteId } = body;

    if (typeof expedienteId !== 'string' || !expedienteId) {
      return NextResponse.json({ error: 'expedienteId is required' }, { status: 400 });
    }

    const access = await getExpedienteAccess(expedienteId);
    if (!access.ok) {
      const status = access.reason === 'unauthenticated' ? 401 : 404;
      return NextResponse.json({ error: status === 401 ? 'Unauthorized' : 'Not found' }, { status });
    }

    if (typeof message !== 'string' || !message.trim()) {
      return NextResponse.json({ error: 'Escriba una consulta.' }, { status: 400 });
    }
    if (message.trim().length > MAX_CHAT_MESSAGE_LENGTH) {
      return NextResponse.json({ error: `La consulta no puede superar ${MAX_CHAT_MESSAGE_LENGTH} caracteres.` }, { status: 413 });
    }
    const userId = access.userId;
    const slot = acquireChatSlot(userId);
    if (!slot.ok) {
      return NextResponse.json(
        { error: slot.reason === 'concurrent' ? 'Ya hay una consulta en curso.' : 'Ha enviado demasiadas consultas. Espere un momento.' },
        { status: 429, headers: { 'Retry-After': String(slot.retryAfterSeconds) } }
      );
    }
    releaseChatSlot = slot.release;
    const factualTotalStartedAt = performance.now();
    const contextLoadStartedAt = performance.now();
    const parcelInputs = await loadAuthorizedParcelInputs(expedienteId, userId);
    const contextLoadMs = performance.now() - contextLoadStartedAt;
    if (!parcelInputs) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 });
    }

    const contextBuildStartedAt = performance.now();
    const parcelContext = buildNormalizedParcelContext({
      ...parcelInputs,
      userMessages: [...parcelInputs.userMessages, message],
    });
    const contextBuildMs = performance.now() - contextBuildStartedAt;
    // An impossible sentinel prevents municipal retrieval until Catastro confirms the municipality.
    const trustedMunicipioCodigo = trustedMunicipalityCodeFilter(parcelContext);
    const municipioCodigo =
      trustedMunicipioCodigo ?? '__urbanbrain_unconfirmed_municipality__';

    const synchronousFactualEnabled = isSynchronousFactualEnabled();
    if (!synchronousFactualEnabled) {
      scheduleFactualShadowPipeline(message, parcelContext, expedienteId, trustedMunicipioCodigo ?? null);
    }

    const questionScope = classifyParcelQuestionScope(message);
    const concreteParameterRequested = requiresDeterminedParcelRegime(message);
    const conditionalViabilityRequested = isConditionalViabilityQuestion(message);
    const normativeScope = buildNormativeSearchScope({
      context: parcelContext,
      municipioCodigo: trustedMunicipioCodigo,
      detected: parcelInputs.detected,
      rawDetection: parcelInputs.latestDetectionRaw,
    });
    // Guardar mensaje del usuario
    const userPersistStartedAt = performance.now();
    await db.insert(chatMessages).values({
      expedienteId,
      userId,
      role: 'user',
      content: message.trim(),
    });
    const userPersistMs = performance.now() - userPersistStartedAt;

    if (synchronousFactualEnabled) {
      const contractStartedAt = performance.now();
      let territorialCoverageDiagnostics: TerritorialCoverageDerivationDiagnostics = {};
      const factualContract = buildTerritorialFactualContract(parcelContext, {
        onCoverageDiagnostics: (value) => { territorialCoverageDiagnostics = value; },
      });
      const contractMs = performance.now() - contractStartedAt;
      const routingStartedAt = performance.now();
      const shouldAttemptFactual = shouldRunVisibleFactual(message, factualContract);
      const routingMs = performance.now() - routingStartedAt;

      if (shouldAttemptFactual) {
        const factualPipelineStartedAt = performance.now();
        try {
          const factualResult = await runTerritorialFactualShadowPipeline(
            message,
            factualContract,
            openai,
            { territorialCoverageDiagnostics }
          );
          const assessment = assessVisibleFactualResult(factualResult);
          let answer = assessment.answer;
          const pipelineMs = performance.now() - factualPipelineStartedAt;
          let persistMs = 0;

          if (answer) {
            if (isFactualComposerEnabled()) {
              const composerStartedAt = performance.now();
              try {
                const composerResult = await composeValidatedFactualAnswer({
                  question: message,
                  contract: factualContract,
                  output: factualResult.structuredOutput!,
                  fallbackAnswer: answer,
                  client: openai,
                  signal,
                });
                answer = composerResult.answer;
                console.info('[ComposerPerf]', {
                  expedienteId,
                  ...composerResult.diagnostics,
                });
              } catch {
                console.info('[ComposerPerf]', {
                  expedienteId,
                  totalMs: Math.round(performance.now() - composerStartedAt),
                  providerMs: 0,
                  status: 'fallback',
                  fallbackUsed: true,
                  fallbackReason: 'unexpected_error',
                  model: factualComposerModel(),
                });
              }
            }
            const operations = factualResult.structuredOutput!.operations;
            const hasConflict = operations.some(
              (operation) =>
                operation.operation === 'state_conflict' ||
                (operation.operation === 'state_status' && operation.status === 'conflict')
            );
            const hasUnresolved = operations.some(
              (operation) =>
                operation.operation === 'state_unresolved' ||
                (operation.operation === 'state_status' && operation.status === 'unresolved') ||
                (operation.operation === 'state_determination' && operation.determination === 'unresolved')
            );
            const applicability: ApplicabilityResult = {
              status: hasConflict ? 'CONFLICTIVO' : hasUnresolved ? 'PARCIAL' : 'DETERMINADO',
              applicable: [],
              review: [],
              rejected: [],
              warnings: [],
              missingData: [],
              conflicts: [],
              canAnswerConcreteParameters: false,
            };
            const contract = buildAnswerContract(
              answer,
              parcelContext,
              applicability,
              [],
              [],
              'answer'
            );

            const persistStartedAt = performance.now();
            await db.insert(chatMessages).values({
              expedienteId,
              userId,
              role: 'assistant',
              content: answer,
              sources: [],
            });
            persistMs = performance.now() - persistStartedAt;
            scheduleFactualShadowResultPersistence({
              result: answer === assessment.answer
                ? factualResult
                : { ...factualResult, renderedText: [answer] },
              query: message,
              expedienteId,
              municipalityIne: trustedMunicipioCodigo ?? null,
              shadowModel: factualResult.diagnostics.model,
              latencyMs: Math.round(pipelineMs),
              pipelineVersion: 'L2.6-sync-visible-v1',
            });
            console.info('[FactualPerf]', {
              expedienteId,
              totalMs: Math.round(performance.now() - factualTotalStartedAt),
              contextMs: Math.round(contextLoadMs + contextBuildMs),
              contextLoadMs: Math.round(contextLoadMs),
              contextBuildMs: Math.round(contextBuildMs),
              userPersistMs: Math.round(userPersistMs),
              contractMs: Math.round(contractMs),
              routingMs: Math.round(routingMs),
              pipelineMs: Math.round(pipelineMs),
              payloadMs: Math.round(factualResult.diagnostics.phases?.payloadMs ?? 0),
              providerStartedAt: factualResult.diagnostics.phases?.providerStartedAt,
              providerFinishedAt: factualResult.diagnostics.phases?.providerFinishedAt,
              providerMs: Math.round(factualResult.diagnostics.phases?.providerMs ?? 0),
              parseMs: Math.round(factualResult.diagnostics.phases?.parseMs ?? 0),
              validateMs: Math.round(factualResult.diagnostics.phases?.validateMs ?? 0),
              renderMs: Math.round(factualResult.diagnostics.phases?.renderMs ?? 0),
              persistMs: Math.round(persistMs),
              criticalRpcMs: 0,
              status: factualResult.status,
              fallbackUsed: false,
              fallbackReason: null,
              requestAborted: signal.aborted,
              model: factualResult.diagnostics.model,
              ...factualResult.diagnostics.metrics,
            });
            return NextResponse.json({ answer, sources: [], safety: contract });
          }

          console.info('[FactualPerf]', {
            expedienteId,
            totalMs: Math.round(performance.now() - factualTotalStartedAt),
            contextMs: Math.round(contextLoadMs + contextBuildMs),
            contextLoadMs: Math.round(contextLoadMs),
            contextBuildMs: Math.round(contextBuildMs),
            userPersistMs: Math.round(userPersistMs),
            contractMs: Math.round(contractMs),
            routingMs: Math.round(routingMs),
            pipelineMs: Math.round(pipelineMs),
            payloadMs: Math.round(factualResult.diagnostics.phases?.payloadMs ?? 0),
            providerStartedAt: factualResult.diagnostics.phases?.providerStartedAt,
            providerFinishedAt: factualResult.diagnostics.phases?.providerFinishedAt,
            providerMs: Math.round(factualResult.diagnostics.phases?.providerMs ?? 0),
            parseMs: Math.round(factualResult.diagnostics.phases?.parseMs ?? 0),
            validateMs: Math.round(factualResult.diagnostics.phases?.validateMs ?? 0),
            renderMs: Math.round(factualResult.diagnostics.phases?.renderMs ?? 0),
            persistMs: 0,
            criticalRpcMs: 0,
            status: factualResult.status,
            fallbackUsed: true,
            fallbackReason: assessment.fallbackReason,
            requestAborted: signal.aborted,
            model: factualResult.diagnostics.model,
            ...factualResult.diagnostics.metrics,
          });
        } catch (factualError) {
          console.info('[FactualPerf]', {
            expedienteId,
            totalMs: Math.round(performance.now() - factualTotalStartedAt),
            contextMs: Math.round(contextLoadMs + contextBuildMs),
            contextLoadMs: Math.round(contextLoadMs),
            contextBuildMs: Math.round(contextBuildMs),
            userPersistMs: Math.round(userPersistMs),
            contractMs: Math.round(contractMs),
            routingMs: Math.round(routingMs),
            pipelineMs: Math.round(performance.now() - factualPipelineStartedAt),
            payloadMs: 0,
            providerMs: 0,
            parseMs: 0,
            validateMs: 0,
            renderMs: 0,
            persistMs: 0,
            criticalRpcMs: 0,
            status: 'pipeline_threw',
            fallbackUsed: true,
            fallbackReason: `exception:${factualError instanceof Error ? factualError.name : 'UnknownError'}`,
            requestAborted: signal.aborted,
          });
        }
      }

      scheduleFactualShadowPipeline(message, parcelContext, expedienteId, trustedMunicipioCodigo ?? null);
    }

    const structuredFactAnswer = buildStructuredParcelFactAnswer(message, parcelContext);
    if (structuredFactAnswer) {
      const applicability: ApplicabilityResult = {
        status: structuredFactAnswer.hasConflict ? 'CONFLICTIVO' : 'DETERMINADO',
        applicable: [],
        review: [],
        rejected: [],
        warnings: [],
        missingData: [],
        conflicts: [],
        canAnswerConcreteParameters: false,
      };
      const answer = structuredFactAnswer.answer;
      const contract = buildAnswerContract(answer, parcelContext, applicability, [], [], 'answer');
      await db.insert(chatMessages).values({
        expedienteId,
        userId,
        role: 'assistant',
        content: answer,
        sources: [],
      });
      return NextResponse.json({ answer, sources: [], safety: contract });
    }

    if (questionScope === 'regime' && !canSearchNormativeInformation(normativeScope)) {
      const applicability = evaluateApplicability(parcelContext, [], true);
      applicability.missingData.push(`alcance normativo previo: ${normativeScope.reason}`);
      const answer = buildSafeAbstention(applicability, parcelContext, message);
      const contract = buildAnswerContract(
        answer,
        parcelContext,
        applicability,
        [],
        [],
        'abstain'
      );
      await db.insert(chatMessages).values({
        expedienteId,
        userId,
        role: 'assistant',
        content: answer,
        sources: [],
      });
      return NextResponse.json({ answer, sources: [], safety: contract });
    }

    // --- SPRINT 3: Integración del Knowledge Orchestrator ---
    let plan: KnowledgePlan | undefined;
    try {
      const { QuestionAnalyzer } = await import('@/application/intent-engine/QuestionAnalyzer');
      const { KnowledgeOrchestrator } =
        await import('@/application/knowledge-orchestrator/KnowledgeOrchestrator');
      const { expedienteNormativeContext } = await import('@/infrastructure/db/schema');
      const { eq } = await import('drizzle-orm');

      const analyzer = new QuestionAnalyzer();
      const analysis = await analyzer.analyze(message, signal);

      // Obtener contexto existente sin invocar de nuevo el motor
      const existingContext = await db
        .select()
        .from(expedienteNormativeContext)
        .where(eq(expedienteNormativeContext.expedienteId, expedienteId));

      const orchestrator = new KnowledgeOrchestrator();
      plan = await orchestrator.generatePlan({
        expedienteId,
        userMessage: message,
        questionAnalysis: analysis,
        existingContext,
      });
    } catch (orchestratorError) {
      console.error('[KnowledgeOrchestrator] Error en la orquestación:', orchestratorError);
      // Fallback a V1 if error
      plan = {
        corpus: 'v1',
        scopes: [],
        categories: [],
        specialNormatives: [],
        documentCodes: [],
        confidence: 0,
      };
    }
    // --------------------------------------------------------
    // Generar embedding con Gemini
    // El modelo disponible es 'gemini-embedding-001'
    const embeddingModel = genAI.getGenerativeModel({ model: 'gemini-embedding-001' });

    const embeddingResult = await embeddingModel.embedContent({
      content: { role: 'user', parts: [{ text: message }] },
      taskType: TaskType.RETRIEVAL_QUERY,
    }, { timeout: CHAT_REQUEST_TIMEOUT_MS, signal });

    const rawEmbedding = Array.from(embeddingResult.embedding.values);

    if (rawEmbedding.length < 768) {
      console.error('Embedding too short:', rawEmbedding.length);
      return NextResponse.json(
        { error: `Embedding too short: ${rawEmbedding.length}` },
        { status: 500 }
      );
    }

    const query_embedding = rawEmbedding.slice(0, 768);
    const supplementaryScope = resolveSupplementaryNormativeScope(message, parcelContext);

    // La RPC recibe primero el alcance aplicable y busca después dentro de él.
    const t0_v1 = performance.now();
    const needsDocumentScope =
      questionScope !== 'independent' || requestsParcelNormativeDocuments(message);
    const scopedRetrieval =
      needsDocumentScope && canSearchNormativeInformation(normativeScope);
    const rpcName = scopedRetrieval
      ? 'match_normativa_chunks_scoped'
      : 'match_normativa_chunks';
    const rpcArguments = scopedRetrieval
      ? {
          query_embedding,
          match_count: 8,
          filter_municipio_codigo: municipioCodigo,
          filter_document_names: normativeScope.documentNames ?? null,
          filter_ordinance: normativeScope.ordinance ?? null,
        }
      : {
          query_embedding,
          match_count: 8,
          filter_municipio_codigo: municipioCodigo,
        };
    const municipalRetrieval = supplementaryScope.retrieveMunicipal
      ? await supabase.rpc(rpcName, rpcArguments).abortSignal(signal)
      : { data: [], error: null };
    const t1_v1 = performance.now();
    const v1_time_ms = Math.round(t1_v1 - t0_v1);
    console.info('[ChatRpcPerf]', {
      expedienteId,
      rpcName: supplementaryScope.retrieveMunicipal ? rpcName : 'not_executed',
      rpcMs: v1_time_ms,
      requestAborted: signal.aborted,
      status: municipalRetrieval.error ? 'error' : 'completed',
    });

    if (municipalRetrieval.error) {
      console.error('Supabase RPC error:', {
        expedienteId,
        rpcName,
        requestAborted: signal.aborted,
        errorName:
          typeof municipalRetrieval.error === 'object' && municipalRetrieval.error && 'name' in municipalRetrieval.error
            ? String(municipalRetrieval.error.name)
            : 'SupabaseRpcError',
      });
      return NextResponse.json({ error: 'Error querying database' }, { status: 500 });
    }

    const safeChunks = (Array.isArray(municipalRetrieval.data) ? municipalRetrieval.data : []) as V1Chunk[];
    const v1Candidates = mapV1Candidates(
      safeChunks,
      scopedRetrieval ? normativeScope : undefined
    );

    const supplementaryV1Candidates: ChatNormativeCandidate[] = [];
    const supplementaryCandidateCountsByLayer: Record<string, number> = {};
    for (const layer of supplementaryScope.layers) {
      if (layer.source !== 'v1_global_catalog' || !layer.documentNames?.length) continue;
      const supplementaryRpcStartedAt = performance.now();
      const { data, error } = await supabase
        .rpc('match_normativa_chunks_scoped', {
          query_embedding,
          match_count: 8,
          filter_municipio_codigo: '',
          filter_document_names: [...layer.documentNames],
          filter_ordinance: null,
        })
        .abortSignal(signal);
      console.info('[ChatRpcPerf]', {
        expedienteId,
        rpcName: 'match_normativa_chunks_scoped',
        rpcMs: Math.round(performance.now() - supplementaryRpcStartedAt),
        requestAborted: signal.aborted,
        status: error ? 'error' : 'completed',
        layer: layer.hierarchy,
      });
      if (error) {
        console.error('Supabase supplementary normative RPC error:', {
          expedienteId,
          rpcName: 'match_normativa_chunks_scoped',
          requestAborted: signal.aborted,
          errorName:
            typeof error === 'object' && error && 'name' in error
              ? String(error.name)
              : 'SupabaseRpcError',
          layer: layer.hierarchy,
        });
        return NextResponse.json({ error: 'Error querying database' }, { status: 500 });
      }
      const dataCandidates = mapV1Candidates((Array.isArray(data) ? data : []) as V1Chunk[], undefined, layer.hierarchy);
      supplementaryV1Candidates.push(...dataCandidates);
      supplementaryCandidateCountsByLayer[layer.hierarchy] = (supplementaryCandidateCountsByLayer[layer.hierarchy] || 0) + dataCandidates.length;
    }

    // --- SPRINT 3.12: Laboratorio CTE V2 ---
    let v2FinalContext = '';
    let usedV2 = false;
    let fallbackReason = '';
    let v2_time_ms = 0;
    let v2LLMTime = 0;
    let v2Citas = '';
    let v2Results: V2SearchResult[] = [];
    let v2Candidates: ChatNormativeCandidate[] = [];

    const cteLayer = supplementaryScope.layers.find((layer) => layer.source === 'v2');
    if (cteLayer) {
      try {
        const { searchNormativeV2 } = await import('@/application/knowledge-engine/searchNormativeV2');

        const t0_v2 = performance.now();
        const v2Promise = searchNormativeV2({
          query_embedding,
          scopes: [...(cteLayer.scopes ?? [])],
          categories: [...(cteLayer.categories ?? [])],
          documentCodes: plan?.documentCodes || [],
          limit: 8,
        });

        const timeoutPromise = new Promise<V2SearchResult[]>((_, reject) => setTimeout(() => reject(new Error('Timeout')), 3000));
        v2Results = await Promise.race([v2Promise, timeoutPromise]);
        v2_time_ms = Math.round(performance.now() - t0_v2);

        // Validation for V2 usage
        const CTE_V2_MIN_SIMILARITY = process.env.CTE_V2_MIN_SIMILARITY ? parseFloat(process.env.CTE_V2_MIN_SIMILARITY) : 0.65;
        if (v2Results.length === 0) {
          fallbackReason = 'Cero resultados V2';
        } else if (v2Results[0].similarity < CTE_V2_MIN_SIMILARITY) {
          fallbackReason = `Similitud insuficiente (${v2Results[0].similarity.toFixed(4)} < ${CTE_V2_MIN_SIMILARITY})`;
        } else {
          // Success! Build V2 Context
          usedV2 = true;

          // Filter valid chunks above threshold, matching the plan's documentCodes, and MUST have sourceUrl
          let validChunks = v2Results.filter(r => r.similarity >= CTE_V2_MIN_SIMILARITY && r.sourceUrl);
          // Limit to Top 5
          validChunks = validChunks.slice(0, 5);

          if (validChunks.length === 0) {
             usedV2 = false;
             fallbackReason = 'Cero resultados V2 tras filtro estricto (similitud o falta URL oficial)';
          } else {
            v2FinalContext = 'NORMATIVA APLICABLE (CTE):\n\n';
            let cIndex = 1;

            // Collect unique chunks
            const seenContent = new Set<string>();
            const uniqueValidChunks = validChunks.filter((chunk) => {
              if (seenContent.has(chunk.content)) return false;
              seenContent.add(chunk.content);
              return true;
            });

            v2Candidates = uniqueValidChunks.map((result) => ({
              id: String(result.chunk_id),
              content: result.content,
              documentName: result.title ?? null,
              title: result.article ?? result.chapter ?? null,
              page: result.page ?? null,
              sourceUrl: result.sourceUrl,
              similarity: result.similarity,
              hierarchy: hierarchyForSupplementaryCandidate(result),
              status: 'vigente',
              visibleSourceKind: 'normative_v2',
            }));

            for (const r of uniqueValidChunks) {
              const citaParts = [`CTE ${r.title?.split(' - ')[0] || ''}`];
              if (r.chapter) citaParts.push(`Capítulo ${r.chapter}`);
              if (r.article) citaParts.push(`apartado ${r.article}`);
              citaParts.push(`página ${r.page}`);
              const citaString = citaParts.join(', ');

              v2FinalContext += `[Fuente ${cIndex}]\n`;
              v2FinalContext += `Documento: ${r.title}\n`;
              v2FinalContext += `Identificador Oficial: ${r.officialIdentifier || 'N/A'}\n`;
              v2FinalContext += `Versión: ${r.version || 'N/A'}\n`;
              v2FinalContext += `Sección/Capítulo: ${r.chapter || 'N/A'}\n`;
              v2FinalContext += `Apartado: ${r.article || 'N/A'}\n`;
              v2FinalContext += `Páginas: ${r.page || 'N/A'}\n`;
              v2FinalContext += `URL Oficial: ${r.sourceUrl}\n`;
              v2FinalContext += `Fragmento:\n${r.content}\n\n`;

              v2Citas += `- ${citaString}. Fuente oficial: ${r.sourceUrl}\n`;
              cIndex++;
            }
          }
        }
      } catch (err) {
        fallbackReason = `V2 Exception: ${(err as Error).message}`;
        usedV2 = false;
      }
    }
    // ----------------------------------

    let applicability: ApplicabilityResult;
    let retrievalApplicability: ApplicabilityResult;
    let answerCandidates: NormativeCandidate[];
    if (usedV2) {
      answerCandidates = v2Candidates;
      applicability = {
        status:
          answerCandidates.length === 0
            ? 'NO_DETERMINADO'
            : concreteParameterRequested
              ? 'PARCIAL'
              : 'DETERMINADO',
        applicable: answerCandidates,
        review: [],
        rejected: [],
        warnings: parcelContext.pendingValidation,
        missingData: concreteParameterRequested
          ? ['fuente municipal vinculada al régimen de la parcela']
          : [],
        conflicts: [],
        canAnswerConcreteParameters:
          !concreteParameterRequested && answerCandidates.length > 0,
      };
      retrievalApplicability = {
        ...applicability,
        status: answerCandidates.length > 0 ? 'DETERMINADO' : 'NO_DETERMINADO',
      };
    } else {
      retrievalApplicability = evaluateApplicability(
        parcelContext,
        v1Candidates,
        false,
        conditionalViabilityRequested
      );
      const regimeApplicability = concreteParameterRequested
        ? evaluateApplicability(parcelContext, v1Candidates, true)
        : retrievalApplicability;

      if (questionScope === 'mixed') {
        applicability = {
          ...regimeApplicability,
          applicable: retrievalApplicability.applicable,
          rejected: retrievalApplicability.rejected,
        };
        answerCandidates = retrievalApplicability.applicable;
      } else {
        applicability = regimeApplicability;
        answerCandidates = applicability.applicable;
      }
    }

    // El alcance de la ordenanza se aplica sólo a la recuperación municipal.
    // Las fuentes supramunicipales se añaden como candidatos de su propio nivel,
    // nunca se someten al filtro de ordenanza ni sustituyen los municipales.
    const layeredCandidates = [...v1Candidates, ...supplementaryV1Candidates, ...v2Candidates];
    const layeredRetrievalApplicability = evaluateApplicability(
      parcelContext,
      layeredCandidates,
      false,
      conditionalViabilityRequested
    );
    const layeredRegimeApplicability = concreteParameterRequested
      ? evaluateApplicability(parcelContext, layeredCandidates, true)
      : layeredRetrievalApplicability;
    if (questionScope === 'mixed') {
      applicability = {
        ...layeredRegimeApplicability,
        applicable: layeredRetrievalApplicability.applicable,
        rejected: layeredRetrievalApplicability.rejected,
      };
      answerCandidates = layeredRetrievalApplicability.applicable;
    } else {
      applicability = layeredRegimeApplicability;
      answerCandidates = applicability.applicable.length > 0
        ? applicability.applicable
        : applicability.review;
    }
    retrievalApplicability = layeredRetrievalApplicability;

    const hasConditionalRegimeEvidence =
      conditionalViabilityRequested &&
      applicability.canAnswerConditionalViability === true &&
      answerCandidates.length > 0;

    const hasReviewableRegimeEvidence =
      questionScope === 'regime' &&
      applicability.status === 'PARCIAL' &&
      applicability.review.length > 0;

    const hardStopNoCandidates = answerCandidates.length === 0;
    const hardStopRetrievalConflict = retrievalApplicability.status === 'CONFLICTIVO';
    const hardStopTerritorialConflict = applicability.status === 'CONFLICTIVO';

    // Condicional viabilidad es un caso especial: si se pregunta si se puede construir,
    // y no hay *ninguna* evidencia que hable de viabilidad general (ej. 0 chunks aplicables
    // o aplicabilidad totalmente indeterminada para viabilidad), entonces es un hard-stop.
    const hardStopNoViabilityEvidence = conditionalViabilityRequested && !hasConditionalRegimeEvidence;

    const mustAbstain =
      hardStopNoCandidates ||
      hardStopRetrievalConflict ||
      hardStopTerritorialConflict ||
      hardStopNoViabilityEvidence;

    const missingDeterminingFacts = applicability.missingData.length > 0;
    const reasonerAllowedWithMissingFacts = !mustAbstain && missingDeterminingFacts;

    const hardStopReasonCodes: string[] = [];
    if (hardStopNoCandidates) hardStopReasonCodes.push('NO_CANDIDATES');
    if (hardStopRetrievalConflict) hardStopReasonCodes.push('RETRIEVAL_CONFLICT');
    if (hardStopTerritorialConflict && !hardStopRetrievalConflict) hardStopReasonCodes.push('TERRITORIAL_CONFLICT');
    if (hardStopNoViabilityEvidence) hardStopReasonCodes.push('NO_VIABILITY_EVIDENCE');

    function logNormativeAnswerPerf(finalDecision: string, validationValid: boolean | null, validationReasonCodes: string[], extraParams: Record<string, unknown> = {}) {
      const missingDataCodes = applicability.missingData.map((d: string) => {
        if (d.includes('clasificación')) return 'MISSING_CLASIFICACION';
        if (d.includes('calificación') || d.includes('ordenanza')) return 'MISSING_CALIFICACION';
        if (d.includes('ámbito') || d.includes('zona')) return 'MISSING_AMBITO';
        if (d.includes('categoría')) return 'MISSING_CATEGORIA';
        if (d.includes('evidencia documental suficiente')) return 'MISSING_DOCUMENTARY_EVIDENCE';
        return 'MISSING_UNKNOWN';
      });

      console.info('[NormativeAnswerPerf]', {
        expedienteId,
        concreteParameterRequested,
        municipalCandidateCount: v1Candidates.length,
        municipalDocumentCount: new Set(v1Candidates.map(c => c.documentName).filter(Boolean)).size,
        municipalScopedRetrieval: !!scopedRetrieval,
        municipalScopeDocumentNameCount: normativeScope?.documentNames?.length ?? 0,
        municipalScopeHasOrdinance: !!normativeScope?.ordinance,
        municipalScopeDiagnosticCode: (!normativeScope?.documentNames?.length && !normativeScope?.ordinance) ? 'NO_DOCUMENT_FILTER' :
          (normativeScope?.documentNames?.length && !normativeScope?.ordinance) ? 'DOCUMENT_FILTER_PRESENT' :
          (!normativeScope?.documentNames?.length && normativeScope?.ordinance) ? 'ORDINANCE_FILTER_PRESENT' : 'DOCUMENT_AND_ORDINANCE_FILTER_PRESENT',
        supplementaryV1CandidateCount: supplementaryV1Candidates.length,
        supplementaryCandidateCountsByLayer,
        v2CandidateCount: v2Candidates.length,
        answerCandidateCount: answerCandidates.length,
        applicabilityStatus: applicability.status,
        retrievalApplicabilityStatus: retrievalApplicability.status,
        canAnswerConcreteParameters: applicability.canAnswerConcreteParameters,
        canAnswerConditionalViability: applicability.canAnswerConditionalViability,
        conditionalViabilityRequested,
        mustAbstainBeforeLlm: mustAbstain,
        llmExecuted: !mustAbstain,
        validationValid,
        validationReasonCodes,
        missingDataCodes,
        finalDecision,
        reasonerAllowedWithMissingFacts,
        hardStopReasonCodes,
        applicableCount: applicability.applicable.length,
        reviewCount: applicability.review.length,
        rejectedCount: applicability.rejected.length,
        missingDataCount: applicability.missingData.length,
        conflictCount: applicability.conflicts.length, ...extraParams, });
    }

    if (mustAbstain) {
      const answer = buildSafeAbstention(applicability, parcelContext, message);
      const contract = buildAnswerContract(
        answer,
        parcelContext,
        applicability,
        [],
        [],
        'abstain'
      );
      await db.insert(chatMessages).values({
        expedienteId,
        userId,
        role: 'assistant',
        content: answer,
        sources: [],
      });
      logNormativeAnswerPerf('abstain', null, [], {});
      return NextResponse.json({ answer, sources: [], safety: contract });
    }

    // Construir contexto
    let contextText = '';
    let systemPrompt = '';

    if (usedV2 && v1Candidates.length === 0 && supplementaryV1Candidates.length === 0) {
      contextText = v2FinalContext;
      systemPrompt = `Eres UrbanBrain, asistente urbanístico. Responde únicamente a partir de los fragmentos suministrados.
No inventes requisitos, cifras ni apartados.

Reglas:
1. Diferencia entre exigencia normativa, interpretación técnica, e información insuficiente.
2. Cita cada afirmación relevante usando los corchetes provistos [Fuente 1], [Fuente 2].
3. Si los fragmentos no permiten responder la pregunta de forma completa, dilo expresamente. No completes con conocimiento general.
4. No presentes tu interpretación como si fuese texto literal de la norma.
5. Advierte al usuario cuando la respuesta pueda depender además de normativa autonómica o municipal.
6. ${questionScope === 'mixed'
    ? 'Responde las partes respaldadas por el contexto y separa la parte que no puede resolverse sin clasificación urbanística. No rechaces toda la consulta.'
    : 'Limita la respuesta al alcance respaldado por las fuentes recuperadas.'}

FORMATO DE RESPUESTA REQUERIDO:

CONCLUSIÓN
[Respuesta clara y directa]

FUNDAMENTO NORMATIVO
[Explicación basada en los fragmentos recuperados, citando las fuentes con corchetes]

FUENTES
[Lista de las fuentes utilizadas en formato: - CTE DB-XX, Capítulo X, apartado Y, página Z. Fuente oficial: URL]`;
    } else {
      systemPrompt = hasReviewableRegimeEvidence
        ? buildReviewSafetyPrompt(parcelContext, answerCandidates, questionScope)
        : buildMunicipalSafetyPrompt(
            parcelContext,
            applicability,
            answerCandidates,
            questionScope
          );
    }

    if (requestsParcelNormativeDocuments(message)) {
      systemPrompt += `

MODO DOCUMENTAL ESTRICTO
La pregunta solicita únicamente la documentación o normativa localizada. Enumera exclusivamente las fuentes recuperadas y, solo cuando el fragmento lo permita, describe prudentemente su contenido. Distingue entre documentación localizada y aplicabilidad concreta a la parcela.
No calcules, afirmes ni enumeres ocupación, edificabilidad, altura, retranqueos, parcela mínima, frente mínimo, número de plantas, usos ni ningún otro parámetro urbanístico no solicitado. Cita con [Fuente N] toda afirmación normativa o documental.`;
    }


    systemPrompt += `

OUTPUT JSON REQUERIDO:
Debes responder obligatoriamente con un único objeto JSON que cumpla el siguiente schema (ReasonerOutput). No añadas texto fuera del JSON.

{
  "answerMode": "definitive" | "conditional" | "partial" | "abstain",
  "claims": [
    {
      "id": "string",
      "type": "territorial_fact" | "normative_fact" | "normative_conditional" | "limitation",
      "text": "string (la afirmación)",
      "sourceRefs": [1, 2],
      "appliesToParcel": true | false | "conditional" | "unknown",
      "numericTokens": ["5", "10", "300"]
    }
  ],
  "missingFacts": ["string (datos pendientes)"]
}
`;

    // Logging for CTE V2 Response Mode
    if (process.env.KNOWLEDGE_ENGINE === 'v2') {
      console.log(`\n========== KNOWLEDGE ENGINE RESPONSE MODE ==========
Pregunta: [omitida por privacidad]
Feature flag: ${process.env.ENABLE_CTE_V2_RESPONSES || 'false'}
DocumentCodes: ${plan?.documentCodes?.join(', ') || 'Ninguno'}
Candidatos recuperados:
- V2: ${v2Results?.length || 0}
- V1 Municipal: ${v1Candidates.length}
- V1 Suplementario: ${supplementaryV1Candidates.length}
Capas suplementarias: ${supplementaryScope.layers.map(l => l.hierarchy).join(', ') || 'Ninguna'}
Similitud Top 1 (V2): ${v2Results && v2Results.length > 0 ? v2Results[0].similarity.toFixed(4) : 'N/A'}
Fuente de respuesta visible:
- ${usedV2 ? 'V2_CTE' : (supplementaryV1Candidates.length > 0 ? 'V1_SUPLEMENTARIO_Y_MUNICIPAL' : 'V1_MUNICIPAL')}

Motivo: ${usedV2 ? 'Condiciones V2 superadas' : fallbackReason}
Tiempo búsqueda: ${usedV2 ? v2_time_ms : v1_time_ms}ms
Citas generadas:
${usedV2 ? v2Citas : 'N/A'}
==========================================\n`);
    }

    let answer = '';
    let sources = mapVisibleSources(answerCandidates);
    let decision: 'answer' | 'abstain' = 'answer';
    let validation: ClaimValidationResult | null = null;
    let reasonerRetryUsed = false;
    let reasonerParseFailureCode: string | null = null;
    let outputParsed = false;
    let parsed: ReasonerOutput | null = null;

    const maxRetries = 1;
    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      const t0_llm = performance.now();
      const completionRequest = {
        model: 'deepseek-v4-flash',
        messages: [
          { role: 'system', content: systemPrompt },
          {
            role: 'user',
            content:
              usedV2 && v1Candidates.length === 0 && supplementaryV1Candidates.length === 0
                ? `CONTEXTO RECUPERADO:\n${contextText}\n\nPregunta: ${message}`
                : attempt > 0 ? `Tu respuesta anterior fue vacía o un JSON inválido. Por favor, corrige el formato y responde OBLIGATORIAMENTE con el schema JSON provisto.\n\nPregunta: ${message}` : message,
          },
        ],
        temperature: 0.1,
        response_format: { type: 'json_object' },
        thinking: { type: 'disabled' as const },
      } satisfies Parameters<typeof openai.chat.completions.create>[0] & {
        thinking: { type: 'disabled' };
      };

      const completion = await openai.chat.completions.create(completionRequest, { signal, timeout: CHAT_REQUEST_TIMEOUT_MS });
      const t1_llm = performance.now();
      v2LLMTime = Math.round(t1_llm - t0_llm);

      const rawContent = completion.choices[0].message.content || '';

      if (!rawContent.trim()) {
        reasonerParseFailureCode = 'EMPTY_CONTENT';
        if (attempt < maxRetries) {
          reasonerRetryUsed = true;
          continue;
        } else {
          break;
        }
      }

      parsed = parseReasonerOutput(rawContent);
      if (!parsed) {
        reasonerParseFailureCode = 'INVALID_JSON_SCHEMA';
        if (attempt < maxRetries) {
          reasonerRetryUsed = true;
          continue;
        } else {
          break;
        }
      }

      outputParsed = true;
      validation = validateReasonerOutput(parsed, answerCandidates, applicability, parcelContext);

      if (validation.validClaims.length === 0) {
        decision = 'abstain';
        const failedApplicability: ApplicabilityResult = {
          ...applicability,
          missingData: [
            ...applicability.missingData,
            'evidencia documental suficiente para respaldar las afirmaciones normativas solicitadas',
          ],
          canAnswerConcreteParameters: false,
        };
        answer = buildSafeAbstention(failedApplicability, parcelContext, message);
        applicability = failedApplicability;
        sources = [];
      } else {
        answer = renderFinalAnswer(parsed, validation.validClaims);
      }

      break;
    }

    if (!outputParsed) {
      decision = 'abstain';
      const failedApplicability: ApplicabilityResult = {
        ...applicability,
        missingData: [
          ...applicability.missingData,
          'evidencia documental suficiente para respaldar las afirmaciones normativas solicitadas',
        ],
        canAnswerConcreteParameters: false,
      };
      answer = buildSafeAbstention(failedApplicability, parcelContext, message);
      applicability = failedApplicability;
      sources = [];
      validation = { validClaims: [], citations: [], invalidClaimCount: 0, invalidClaimReasonCounts: {} };
    }

    const contract = buildAnswerContract(
      answer,
      parcelContext,
      applicability,
      decision === 'answer' ? (validation?.citations || []) : [],
      decision === 'answer' ? answerCandidates : [],
      decision
    );

    // Guardar mensaje de la IA
    await db.insert(chatMessages).values({
      expedienteId,
      userId,
      role: 'assistant',
      content: answer,
      sources,
    });

    const reasonCodes: string[] = [];
    if (reasonerParseFailureCode) reasonCodes.push(reasonerParseFailureCode);
    if (validation && validation.invalidClaimCount > 0) {
      reasonCodes.push(...Object.keys(validation.invalidClaimReasonCounts));
    }
    const isTotallyValid = outputParsed && validation && validation.invalidClaimCount === 0;

    logNormativeAnswerPerf(
      decision,
      isTotallyValid,
      reasonCodes,
      {
        reasonerOutputParsed: outputParsed,
        reasonerClaimCount: validation ? validation.validClaims.length + validation.invalidClaimCount : 0,
        validClaimCount: validation ? validation.validClaims.length : 0,
        invalidClaimCount: validation ? validation.invalidClaimCount : 0,
        invalidClaimReasonCounts: validation ? validation.invalidClaimReasonCounts : {},
        renderedFromClaims: outputParsed && validation && validation.validClaims.length > 0,
        reasonerRetryUsed,
        reasonerParseFailureCode
      }
    );

    return NextResponse.json({
      answer,
      sources,
      safety: contract,
    });
  } catch (error) {
    if (signal.aborted || (error instanceof Error && error.name === 'AbortError')) {
      return NextResponse.json({ error: 'La consulta ha tardado demasiado. Inténtelo de nuevo.' }, { status: 504 });
    }
    console.error('ROUTE_TS_ERROR', error);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  } finally {
    releaseChatSlot?.();
  }
}

export async function POST(req: NextRequest) {
  const controller = new AbortController();
  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  const timeoutResponse = new Promise<NextResponse>((resolve) => {
    timeoutId = setTimeout(() => {
      controller.abort();
      resolve(NextResponse.json(
        { error: 'La consulta ha tardado demasiado. Inténtelo de nuevo.' },
        { status: 504 }
      ));
    }, CHAT_REQUEST_TIMEOUT_MS);
  });

  try {
    return await Promise.race([handlePost(req, controller.signal), timeoutResponse]);
  } finally {
    if (timeoutId) clearTimeout(timeoutId);
  }
}
