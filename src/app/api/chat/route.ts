import { NextRequest, NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';
import { randomUUID } from 'node:crypto';
import { GoogleGenerativeAI, TaskType } from '@google/generative-ai';
import { createClient } from '@supabase/supabase-js';
import OpenAI from 'openai';
import { getReasonerProvider, type ReasonerRequest } from '@/application/chat/reasonerProvider';
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
import { retrieveMunicipalProgressively } from '@/application/chat/municipalProgressiveRetrieval';
import { rankScopedChunkRows, type ScopedChunkRow } from '@/application/chat/scopedChunkFallback';
import { checkMunicipalCorpusAvailability } from '@/application/chat/municipalCorpusAvailability';
import { requestsNormativeDocumentScope, shouldUseDocumentScope } from '@/application/chat/documentScopeRouting';
import {
  buildAnswerContract,
  buildMunicipalSafetyPrompt,
  buildReviewSafetyPrompt,
  buildSafeAbstention,
  buildStructuredParcelFactAnswer,
  buildDeterministicMissingFacts,
  parseReasonerOutput,
  validateReasonerOutput,
  sanitizePresentationText,
  renderValidatedClaimsNeutral,
  type ClaimValidationResult,
} from '@/application/parcel-context/responseSafety';
import { buildV2EffectivePrompt } from '@/application/parcel-context/v2PromptContext';
import {
  classifyQuestionIntent,
  type SemanticCompositionResult,
} from '@/application/parcel-context/semanticAnswerComposition';
import { getOfficialPlanningDocumentUrl, getInstrumentIdentityCatalog } from '@/infrastructure/planning-knowledge/PlanningKnowledgeBase';
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
import { CartographicViewEvidence } from '@/infrastructure/territorial-resolver/cartographicViewEvidence';
import { cartographicToolLimit, type CartographicToolResult } from '@/application/parcel-context/cartographicViewTool';
import { assertRuntimeBudgetAvailable, recordLLMUsage, recordRuntimeCall } from '@/application/runtime/runtimeAccounting';
import { EXACT_CHUNK_SELECT, hasSpecificNormativeEvidence, resolveMentionedAcceptedIdentities, resolveNormativeCandidateProvenance, shouldWidenDirectedNormativeScope } from './routeInternals';
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
import {
  accreditedRealitySourcesAsCandidates,
  buildAccreditedRealityPackage,
  buildAccreditedRealityPrompt,
} from '@/application/parcel-context/accreditedRealityPackage';
import { SiotugaPlanningKnowledgeSource } from '@/infrastructure/planning-knowledge/SiotugaPlanningKnowledgeSource';
import { enrichPlanningDocumentPreviews } from '@/infrastructure/planning-knowledge/documentPreviewLoader';
import {
  accreditedRealityReasonerResponseSchema,
  ACCREDITED_REALITY_MAX_TOOL_CALLS,
  buildAccreditedRealityContinuationPrompt,
  executeGetInstrumentDocumentsTool,
  executeGetInstrumentDocumentContentTool,
  accreditedPlanningDocumentsAsInventory,
  instrumentDocumentContentAsCandidates,
  instrumentDocumentsAsCandidates,
  findReusableAccreditedRealityToolResult,
  normalizeAccreditedRealityToolRequest,
  type AccreditedRealityToolCall,
  parseAccreditedRealityModelResponseSequence,
  rankLegacyNormativeChunkRows,
} from '@/application/parcel-context/accreditedRealityTool';
import {
  renderAccreditedRealityClaimsNeutral,
  validateAccreditedRealityOutput,
} from '@/application/parcel-context/accreditedRealityValidation';

function traceCatalogRuntimeInternal(requestId: string, expedienteId: string, event: string, payload: Record<string, unknown>) {
  if (process.env.NODE_ENV === 'production') return
  const record = { at: new Date().toISOString(), requestId, expedienteId, processStartedAt: TRACE_PROCESS_STARTED_AT, event, ...payload }
  try {
    const tracePath = path.join(process.cwd(), 'diagnose_out', 'ub-e2e-trace.jsonl')
    fs.mkdirSync(path.dirname(tracePath), { recursive: true })
    fs.appendFileSync(tracePath, `${JSON.stringify(record)}\n`, 'utf8')
  } catch {
    // Diagnostics must never affect the chat request.
  }
  console.info('UB-E2E-TRACE', JSON.stringify(record))
}

const TRACE_PROCESS_STARTED_AT = new Date().toISOString()

function traceAnswerStage(
  requestId: string,
  expedienteId: string,
  event: 'post-validation' | 'v2-neutral-composer' | 'semantic-composer' | 'before-http-response',
  branch: string,
  text: string,
  validClaims: number
) {
  const safeText = typeof text === 'string' ? text : String(text ?? '');
  traceCatalogRuntimeInternal(requestId, expedienteId, event, {
    branch,
    correlationId: expedienteId,
    processStartedAt: TRACE_PROCESS_STARTED_AT,
    textLength: safeText.length,
    textPreview: safeText.slice(0, 180),
    validClaims,
  })
}

/** Columns available in the deployed V1 corpus for canonical exact lookup. */
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

import { NormativeRegimeIdentity } from '@/domain/parcel-context/types'

interface V1Chunk {
  chunk_id: string | number;
  texto?: string | null;
  municipio_nombre?: string | null;
  nombre_pdf?: string | null;
  titulo_detectado?: string | null;
  pagina_detectada?: string | number | null;
  original_path?: string | null;
  similarity?: number | null;
  metadata?: { regime?: NormativeRegimeIdentity } | null;
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
  metadata?: { regime?: NormativeRegimeIdentity } | null;
}

type ChatNormativeCandidate = NormativeCandidate & {
  visibleSourceKind?: 'normative_v1' | 'normative_v2';
};

function buildV2TechnicalFallback(): string {
  return 'No hay evidencia normativa suficiente para responder con seguridad.';
}

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
  hierarchy: NormativeCandidate['hierarchy'] = 'municipal',
  evidenceSpecificity: NormativeCandidate['evidenceSpecificity'] = 'SPECIFIC',
  inheritCanonicalIdentity = true
): ChatNormativeCandidate[] {
  return chunks.map((chunk) => {
    const ownRegime = chunk.metadata?.regime ?? null;
    const provenance = resolveNormativeCandidateProvenance(ownRegime, scope, inheritCanonicalIdentity);
    return {
    id: String(chunk.chunk_id),
    content: chunk.texto ?? '',
    municipalityName: chunk.municipio_nombre ?? null,
    documentName: chunk.nombre_pdf ?? null,
    title: chunk.titulo_detectado ?? null,
    page: chunk.pagina_detectada ?? null,
    sourceUrl: chunk.original_path ?? null,
    similarity: chunk.similarity ?? null,
    hierarchy,
    regimeMetadata: chunk.metadata?.regime ?? null,
    // Keep legacy attributes as null unless proven elsewhere
    ordinance: provenance.ordinance,
    planningArea: provenance.planningArea,
    parentInstrument: scope?.instrumentId ?? null,
    evidenceSpecificity,
    identityId: provenance.identityId,
    normativeReferences: provenance.normativeReferences,
    visibleSourceKind: 'normative_v1',
    };
  });
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
      source_kind: candidate.id.startsWith('cartographic-view:') ? 'cartographic_view' : candidate.visibleSourceKind ?? 'normative_document',
      evidence_specificity: candidate.evidenceSpecificity ?? 'SPECIFIC',
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

function jsonWithRequestId(requestId: string, body: Record<string, unknown>, init?: ResponseInit) {
  const headers = new Headers(init?.headers)
  headers.set('X-UrbanBrain-Request-Id', requestId)
  return NextResponse.json({ ...body, requestId }, { ...init, headers })
}

function isAccreditedRealityExperimentEnabled() {
  return process.env.NODE_ENV !== 'production' && process.env.URBANBRAIN_EXPEDIENTE_ACCREDITED_REALITY_ENABLED === '1'
}

async function handlePost(req: NextRequest, signal: AbortSignal, requestId: string) {
  const traceCatalogRuntime = (expedienteId: string, event: string, payload: Record<string, unknown>) =>
    traceCatalogRuntimeInternal(requestId, expedienteId, event, payload);
  let tracedExpedienteId = 'unknown';
  let traceStage = 'handlePost:start';
  let releaseChatSlot: (() => void) | undefined;
  try {
    const body = await req.json();
    const { message, expedienteId } = body;
    if (typeof expedienteId === 'string' && expedienteId) tracedExpedienteId = expedienteId;

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

    if (isAccreditedRealityExperimentEnabled()) {
      if (process.env.URBANBRAIN_REASONER_PROVIDER && process.env.URBANBRAIN_REASONER_PROVIDER !== 'openai') {
        return jsonWithRequestId(requestId, { error: 'El experimento requiere URBANBRAIN_REASONER_PROVIDER=openai.' }, { status: 503 });
      }
      if (process.env.URBANBRAIN_OPENAI_REASONER_MODEL && process.env.URBANBRAIN_OPENAI_REASONER_MODEL !== 'gpt-5.6-luna') {
        return jsonWithRequestId(requestId, { error: 'El experimento requiere URBANBRAIN_OPENAI_REASONER_MODEL=gpt-5.6-luna.' }, { status: 503 });
      }

      const accreditedRealityPackage = buildAccreditedRealityPackage(parcelInputs.detected, parcelContext);
      const packageSources = accreditedRealitySourcesAsCandidates(accreditedRealityPackage);
      const packagePrompt = buildAccreditedRealityPrompt(accreditedRealityPackage, message);
      traceCatalogRuntime(expedienteId, 'accredited-reality-package', {
        packageVersion: accreditedRealityPackage.packageVersion,
        package: accreditedRealityPackage,
        derivedContext: accreditedRealityPackage.derivedContext,
      });
      traceCatalogRuntime(expedienteId, 'accredited-reality-prompt', {
        systemPrompt: packagePrompt.systemPrompt,
        userPrompt: packagePrompt.userPrompt,
      });

      await db.insert(chatMessages).values({
        expedienteId,
        userId,
        role: 'user',
        content: message.trim(),
      });

      const provider = getReasonerProvider();
      if (provider.name !== 'openai') return jsonWithRequestId(requestId, { error: 'Accredited Reality cartográfico requiere proveedor OpenAI multimodal.' }, { status: 503 });
      assertRuntimeBudgetAvailable(provider.name);
      const startedAt = performance.now();
      const firstRequest = {
        systemPrompt: packagePrompt.systemPrompt,
        userPrompt: packagePrompt.userPrompt,
        signal,
        timeoutMs: CHAT_REQUEST_TIMEOUT_MS,
        responseSchemaName: 'AccreditedRealityReasonerResponse',
        responseSchema: accreditedRealityReasonerResponseSchema,
      };
      const result = await provider.generate(firstRequest);
      const runtimeCall = recordRuntimeCall({ requestId, provider: result.provider, model: result.model, callType: 'reasoning', inputTokens: result.inputTokens, outputTokens: result.outputTokens, totalTokens: result.totalTokens, cachedTokens: result.cachedInputTokens, reasoningTokens: result.reasoningTokens });
      recordLLMUsage({ operationType: 'chat_query', operationId: requestId, requestId, expedienteId, stage: 'accredited-reality', inferenceIndex: 1, provider: result.provider, model: result.model, inputTokens: result.inputTokens ?? null, cachedInputTokens: result.cachedInputTokens ?? null, outputTokens: result.outputTokens ?? null, reasoningTokens: result.reasoningTokens ?? null, totalTokens: result.totalTokens ?? null, durationMs: result.latencyMs ?? null, toolCallsRequested: 0, finishReason: null });
      traceCatalogRuntime(expedienteId, 'accredited-reality-runtime-call', { pass: 1, ...runtimeCall });
      traceCatalogRuntime(expedienteId, 'accredited-reality-model-raw', { pass: 1, provider: result.provider, model: result.model, latencyMs: result.latencyMs, rawContent: result.rawContent });

      let modelResponses = parseAccreditedRealityModelResponseSequence(result.rawContent);
      let modelResponse = modelResponses?.[modelResponses.length - 1] ?? null;
      let activeSources = [...packageSources];
      let finalResult = result;
      const activeInstrumentId = parcelInputs.detected?.applicableInstruments?.find((instrument) => instrument.status === 'current')?.id ?? null;
      let instrumentDocumentsResult: Awaited<ReturnType<typeof executeGetInstrumentDocumentsTool>> | null = accreditedPlanningDocumentsAsInventory({
        municipalityCode: accreditedRealityPackage.identity.municipalityCode,
        instrumentId: activeInstrumentId,
        documents: parcelInputs.detected?.planningDocuments,
      });
      const cartography = new CartographicViewEvidence({ expedienteId, municipalityCode: accreditedRealityPackage.identity.municipalityCode, instrumentId: activeInstrumentId, planning: parcelInputs.detected ? { status: 'partial', applicableInstruments: parcelInputs.detected.applicableInstruments ?? [], documents: parcelInputs.detected.planningDocuments ?? [], evidence: [], warnings: [] } : null, signal });
      let currentImages: ReturnType<typeof cartography.attachments> = [];
      let cartographyUsed = false;
      let toolLimitReached = false;
      let toolResult: Awaited<ReturnType<typeof executeGetInstrumentDocumentsTool>> | Awaited<ReturnType<typeof executeGetInstrumentDocumentContentTool>> | CartographicToolResult | undefined;
      const toolHistory: Array<{ request: AccreditedRealityToolCall; result: NonNullable<typeof toolResult> }> = [];
      let toolCalls = 0;
      let accreditedInferenceIndex = 1;

      const collectInstrumentDocuments = async (municipalityCode: string, currentInstrumentId: string, retrievedAt: string) => {
        const collected = await new SiotugaPlanningKnowledgeSource().collectInstrumentDocuments(municipalityCode, currentInstrumentId, retrievedAt);
        const baseDocuments = collected.documents.map((document) => ({
          id: document.officialDocumentId,
          instrumentId: document.instrumentId,
          title: document.name,
          sourceUrl: document.officialUrl,
          binding: 'general' as const,
          documentType: document.documentType,
        }));
        const documents = await enrichPlanningDocumentPreviews(baseDocuments, municipalityCode, currentInstrumentId);
        return {
          documents,
        };
      };

      const retrieveDocumentContent = async (input: {
        municipalityCode: string
        instrumentId: string
        document: NonNullable<typeof instrumentDocumentsResult>['documents'][number]
        query: string
        retrievedAt: string
      }) => {
        const terms = [...new Set(input.query.toLocaleLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').match(/[\p{L}\p{N}\-_]{3,}/gu) ?? [])];
        const score = (text: string) => terms.reduce((total, term) => total + (text.toLocaleLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').includes(term) ? 1 : 0), 0);
        const officialDocumentId = input.document.id;

        const v2Document = await supabase
          .from('normative_documents_v2')
          .select('id,title,source_url,official_identifier,file_hash,status,current_version,legal_review_status')
          .eq('official_identifier', officialDocumentId)
          .eq('municipality_id', input.municipalityCode)
          .eq('status', 'vigente')
          .eq('current_version', true)
          .eq('legal_review_status', 'reviewed')
          .limit(1);
        if (!v2Document.error && Array.isArray(v2Document.data) && v2Document.data.length > 0) {
          const document = v2Document.data[0] as Record<string, unknown>;
          const chunks = await supabase
            .from('normative_chunks_v2')
            .select('id,content,page,article,chapter,metadata')
            .eq('document_id', String(document.id))
            .limit(5000);
          if (!chunks.error && Array.isArray(chunks.data)) {
            const scopedChunks = chunks.data.filter((chunk) => {
              const metadata = chunk && typeof chunk === 'object' && 'metadata' in chunk && chunk.metadata && typeof chunk.metadata === 'object'
                ? chunk.metadata as Record<string, unknown>
                : null;
              const metadataInstrument = typeof metadata?.instrumentId === 'string' ? metadata.instrumentId : null;
              return !metadataInstrument || metadataInstrument === input.instrumentId;
            });
            const ranked = scopedChunks
              .map((chunk) => ({ chunk: chunk as Record<string, unknown>, score: score(String((chunk as Record<string, unknown>).content ?? '')) }))
              .filter((item) => terms.length === 0 || item.score > 0)
              .sort((left, right) => right.score - left.score)
              .slice(0, 12);
            return {
              status: ranked.length > 0 ? 'available' as const : 'not_ingested' as const,
              fragments: ranked.map(({ chunk }) => ({
                stableSourceRef: `instrument-document:${officialDocumentId}:chunk:${String(chunk.id)}`,
                officialDocumentId,
                chunkId: String(chunk.id),
                text: String(chunk.content ?? ''),
                page: typeof chunk.page === 'number' ? chunk.page : null,
                article: typeof chunk.article === 'string' ? chunk.article : null,
                chapter: typeof chunk.chapter === 'string' ? chunk.chapter : null,
                documentName: typeof document.title === 'string' ? document.title : input.document.title,
                sourceUrl: input.document.sourceUrl,
                checksum: typeof document.file_hash === 'string' ? document.file_hash : null,
              })),
              provenance: { source: 'normative_chunks_v2' as const, retrievedAt: input.retrievedAt, method: 'exact officialDocumentId + instrument + municipality scope' },
            };
          }
        }

        let fileName: string | null = null;
        try { fileName = decodeURIComponent(new URL(input.document.sourceUrl).pathname.split('/').pop() ?? '') || null; } catch { fileName = null; }
        if (!fileName) return { status: 'not_ingested' as const, fragments: [], provenance: { source: 'normativa_chunks' as const, retrievedAt: input.retrievedAt, method: 'official URL had no corpus filename' } };
        const legacyRows = await supabase
          .from('normativa_chunks')
          .select('chunk_id,texto,nombre_pdf,titulo_detectado,ruta_pdf,metadata')
          .eq('municipio_codigo', input.municipalityCode)
          .eq('nombre_pdf', fileName)
          .limit(5000);
        if (legacyRows.error || !Array.isArray(legacyRows.data)) {
          const error = legacyRows.error as { code?: string; message?: string } | null;
          console.error('[AccreditedReality] normativa_chunks content query failed', {
            municipalityCode: input.municipalityCode,
            fileName,
            code: error?.code ?? null,
            message: error?.message ?? 'invalid query result',
          });
          return { status: 'error' as const, fragments: [], provenance: { source: 'normativa_chunks' as const, retrievedAt: input.retrievedAt, method: 'exact municipality + corpus filename scope' }, message: error?.message };
        }
        const scopedRows = legacyRows.data
          .filter((row) => {
            const metadata = row && typeof row === 'object' && 'metadata' in row && row.metadata && typeof row.metadata === 'object'
              ? row.metadata as Record<string, unknown>
              : null;
            const metadataInstrument = typeof metadata?.instrumentId === 'string' ? metadata.instrumentId : null;
            return !metadataInstrument || metadataInstrument === input.instrumentId;
          })
        const fragments = rankLegacyNormativeChunkRows({
          rows: scopedRows,
          terms,
          officialDocumentId,
          sourceUrl: input.document.sourceUrl,
        });
        return {
          status: fragments.length > 0 ? 'available' as const : 'not_ingested' as const,
          fragments,
          provenance: { source: 'normativa_chunks' as const, retrievedAt: input.retrievedAt, method: 'exact municipality + corpus filename scope' },
        };
      };

      while (modelResponses) {
        const pendingTools = modelResponses.filter((response): response is AccreditedRealityToolCall => response.action === 'tool_call');
        if (pendingTools.length === 0) {
          modelResponse = modelResponses[modelResponses.length - 1] ?? null;
          break;
        }
        cartographyUsed ||= pendingTools.some(tool => tool.toolName === 'get_cartographic_view');
        const toolLimit = cartographyUsed ? cartographicToolLimit() : ACCREDITED_REALITY_MAX_TOOL_CALLS;
        const remaining = toolLimit - toolCalls;
        if (remaining <= 0) {
          traceCatalogRuntime(expedienteId, 'accredited-reality-tool-limit', { limit: toolLimit, toolCalls });
          toolLimitReached = true;
          modelResponse = null;
          break;
        }
        let exceededRemaining = false;
        for (const rawRequestedTool of pendingTools) {
          const requestedTool = normalizeAccreditedRealityToolRequest(rawRequestedTool, instrumentDocumentsResult);
          const previous = findReusableAccreditedRealityToolResult(toolHistory, requestedTool);
          if (previous) {
            if (previous.result.toolName === 'get_instrument_documents') instrumentDocumentsResult = previous.result;
            toolResult = previous.result;
            traceCatalogRuntime(expedienteId, 'accredited-reality-tool-reused', { toolName: requestedTool.toolName, arguments: requestedTool.arguments });
            continue;
          }
          if (toolCalls >= toolLimit) {
            exceededRemaining = true;
            break;
          }
          toolCalls += 1;
          traceCatalogRuntime(expedienteId, 'accredited-reality-tool-request', { pass: toolCalls, toolName: requestedTool.toolName, arguments: requestedTool.arguments, accepted: true });
          if (requestedTool.toolName === 'get_instrument_documents') {
            instrumentDocumentsResult = await executeGetInstrumentDocumentsTool({ municipalityCode: accreditedRealityPackage.identity.municipalityCode, instrumentId: activeInstrumentId, collect: collectInstrumentDocuments });
            toolResult = instrumentDocumentsResult;
            activeSources = [...activeSources, ...instrumentDocumentsAsCandidates(instrumentDocumentsResult)];
          } else if (requestedTool.toolName === 'get_instrument_document_content') {
            const contentResult = await executeGetInstrumentDocumentContentTool({
              municipalityCode: accreditedRealityPackage.identity.municipalityCode,
              instrumentId: activeInstrumentId,
              inventory: instrumentDocumentsResult,
              documentId: requestedTool.arguments.documentId,
              query: requestedTool.arguments.query,
              retrieve: retrieveDocumentContent,
            });
            toolResult = contentResult;
            activeSources = [...activeSources, ...instrumentDocumentContentAsCandidates(contentResult)];
          }
          if (requestedTool.toolName === 'get_cartographic_view') {
            const viewResult = await cartography.execute(requestedTool.arguments);
            toolResult = viewResult;
            currentImages = cartography.attachments(viewResult);
            activeSources = [...activeSources, ...viewResult.views.filter(view => !activeSources.some(source => source.id === view.id)).map(view => ({ id: view.id, content: JSON.stringify(view), sourceUrl: view.sourceUrl, documentName: 'Vista cartográfica: interpretación pendiente', evidenceSpecificity: 'NON_SPECIFIC' as const }))];
          }
          if (!toolResult) throw new Error('Unsupported accredited tool dispatch');
          toolHistory.push({ request: requestedTool, result: toolResult });
          traceCatalogRuntime(expedienteId, 'accredited-reality-tool-result', { pass: toolCalls, result: toolResult, sourceCount: activeSources.length });
        }
        if (exceededRemaining) {
          traceCatalogRuntime(expedienteId, 'accredited-reality-tool-limit', { limit: toolLimit, toolCalls });
          toolLimitReached = true;
          modelResponse = null;
          break;
        }
        const continuationPrompt = buildAccreditedRealityContinuationPrompt(packagePrompt, toolHistory);
        traceCatalogRuntime(expedienteId, 'accredited-reality-prompt', { pass: toolCalls + 1, systemPrompt: continuationPrompt.systemPrompt, userPrompt: continuationPrompt.userPrompt });
        assertRuntimeBudgetAvailable(provider.name);
        finalResult = await provider.generate({ ...firstRequest, images: currentImages, systemPrompt: continuationPrompt.systemPrompt, userPrompt: continuationPrompt.userPrompt });
        accreditedInferenceIndex += 1;
        recordLLMUsage({ operationType: 'chat_query', operationId: requestId, requestId, expedienteId, stage: 'accredited-reality', inferenceIndex: accreditedInferenceIndex, provider: finalResult.provider, model: finalResult.model, inputTokens: finalResult.inputTokens ?? null, cachedInputTokens: finalResult.cachedInputTokens ?? null, outputTokens: finalResult.outputTokens ?? null, reasoningTokens: finalResult.reasoningTokens ?? null, totalTokens: finalResult.totalTokens ?? null, durationMs: finalResult.latencyMs ?? null, toolCallsRequested: pendingTools.length, finishReason: null });
        const followupRuntimeCall = recordRuntimeCall({ requestId, provider: finalResult.provider, model: finalResult.model, callType: 'reasoning', inputTokens: finalResult.inputTokens, outputTokens: finalResult.outputTokens, totalTokens: finalResult.totalTokens, cachedTokens: finalResult.cachedInputTokens, reasoningTokens: finalResult.reasoningTokens });
        traceCatalogRuntime(expedienteId, 'accredited-reality-runtime-call', { pass: toolCalls + 1, ...followupRuntimeCall });
        traceCatalogRuntime(expedienteId, 'accredited-reality-model-raw', { pass: toolCalls + 1, provider: finalResult.provider, model: finalResult.model, latencyMs: finalResult.latencyMs, rawContent: finalResult.rawContent });
        modelResponses = parseAccreditedRealityModelResponseSequence(finalResult.rawContent);
      }

      const parsed = modelResponse?.action === 'final' ? modelResponse.output : null;
      const protocolError = modelResponses === null;
      const applicability: ApplicabilityResult = {
        status: accreditedRealityPackage.conflicts.length > 0 ? 'CONFLICTIVO' : 'PARCIAL',
        applicable: activeSources,
        review: [],
        rejected: [],
        warnings: accreditedRealityPackage.warnings.map((warning) => typeof warning === 'string' ? warning : JSON.stringify(warning)),
        missingData: accreditedRealityPackage.unknowns,
        conflicts: accreditedRealityPackage.conflicts.map((conflict) => JSON.stringify(conflict)),
        canAnswerConcreteParameters: false,
      };
      const validation = parsed
        ? validateAccreditedRealityOutput(parsed, activeSources, applicability, parcelContext)
        : { validClaims: [], invalidClaimCount: 0, invalidClaimReasonCounts: { INVALID_JSON_SCHEMA: 1 }, citations: [], legacyCitations: [] };
      traceCatalogRuntime(expedienteId, 'accredited-reality-validation', {
        parsed: Boolean(parsed),
        toolUsed: Boolean(toolResult),
        validClaims: validation.validClaims.length,
        invalidClaimCount: validation.invalidClaimCount,
        invalidClaimReasonCounts: validation.invalidClaimReasonCounts,
        citations: validation.citations,
      });

      const answer = toolLimitReached
        ? 'Investigación incompleta: se alcanzó el límite de herramientas antes de completar la respuesta.'
        : protocolError
        ? 'No se pudo procesar la respuesta estructurada del razonador. La ejecución se detuvo por un error de protocolo.'
        : validation.validClaims.length > 0
        ? renderAccreditedRealityClaimsNeutral(validation.validClaims)
        : `No puedo cerrar la consulta con la evidencia acreditada disponible.${accreditedRealityPackage.unknowns.length > 0 ? ` Datos pendientes: ${accreditedRealityPackage.unknowns.join('; ')}.` : ''}`;
      const contract = buildAnswerContract(
        answer,
        parcelContext,
        applicability,
        validation.legacyCitations,
        activeSources,
        validation.validClaims.length > 0 ? 'answer' : 'abstain',
      );
      await db.insert(chatMessages).values({
        expedienteId,
        userId,
        role: 'assistant',
        content: answer,
        sources: mapVisibleSources(activeSources.filter(source => !source.id.startsWith('cartographic-view:'))),
      });
      traceCatalogRuntime(expedienteId, 'accredited-reality-response', {
        answer,
        elapsedMs: Math.round(performance.now() - startedAt),
        model: finalResult.model,
        provider: finalResult.provider,
        latencyMs: finalResult.latencyMs,
        inputTokens: finalResult.inputTokens ?? null,
        outputTokens: finalResult.outputTokens ?? null,
        totalTokens: finalResult.totalTokens ?? null,
      });
      return jsonWithRequestId(requestId, {
        answer,
        sources: mapVisibleSources(activeSources),
        safety: contract,
        experimental: {
          packageVersion: accreditedRealityPackage.packageVersion,
          provider: finalResult.provider,
          model: finalResult.model,
          validation,
        },
      });
    }

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
    const questionIntent = classifyQuestionIntent(
      message,
      questionScope,
      concreteParameterRequested,
      conditionalViabilityRequested
    );
    const normativeScope = buildNormativeSearchScope({
      context: parcelContext,
      municipioCodigo: trustedMunicipioCodigo,
      detected: parcelInputs.detected,
      trace: process.env.NODE_ENV === 'production' ? undefined : (event, payload) => traceCatalogRuntime(expedienteId, event, payload),
    });
    traceCatalogRuntime(expedienteId, 'catalog-scope', {
      municipalityCode: normativeScope.municipioCodigo,
      instrumentId: normativeScope.instrumentId ?? null,
      ordinance: normativeScope.ordinance ?? null,
      identityId: normativeScope.identityId ?? null,
      normativeReferences: normativeScope.normativeReferences ?? [],
      documentNames: normativeScope.documentNames ?? [],
    })
    if (
      normativeScope.authoritativeSelection &&
      normativeScope.ordinance &&
      normativeScope.instrumentId
    ) {
      const existingConfirmed = parcelContext.ordinanceCandidates?.some(
        (candidate) =>
          candidate.status === 'user_confirmed' &&
          candidate.identity.trim().toLocaleUpperCase() === normativeScope.ordinance!.trim().toLocaleUpperCase()
      )
      if (!existingConfirmed) {
        parcelContext.ordinanceCandidates = [
          ...(parcelContext.ordinanceCandidates ?? []),
          {
            identity: normativeScope.ordinance,
            semanticDimension: 'ordinance',
            instrumentId: normativeScope.instrumentId,
            provenance: ['manual'],
            status: 'user_confirmed',
            confirmationSource: 'user',
            identityId: normativeScope.identityId,
            catalogStatus: normativeScope.catalogStatus,
            normativeReferences: normativeScope.normativeReferences,
          },
        ]
      }
    }
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
    const embeddingQuery = normativeScope.ordinance
      ? `${message}\nOrdenanza confirmada: ${normativeScope.ordinance}`
      : message;

    const embeddingResult = await embeddingModel.embedContent({
      content: { role: 'user', parts: [{ text: embeddingQuery }] },
      taskType: TaskType.RETRIEVAL_QUERY,
    }, { timeout: CHAT_REQUEST_TIMEOUT_MS, signal });
    recordRuntimeCall({
      requestId,
      provider: 'gemini',
      model: 'gemini-embedding-001',
      callType: 'embedding',
    });

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
    const identityReferenceChunkIds = [...new Set((normativeScope.normativeReferences ?? []).flatMap((reference) => reference.chunkIds).filter(Boolean))];
    const hasCatalogScopedIdentity = Boolean(
      identityReferenceChunkIds.length > 0 && normativeScope.municipioCodigo && normativeScope.instrumentId,
    );
    const scopedRetrieval =
      (needsDocumentScope || hasCatalogScopedIdentity) && (canSearchNormativeInformation(normativeScope) || hasCatalogScopedIdentity);
    const rpcName = scopedRetrieval
      ? 'match_normativa_chunks_scoped'
      : 'match_normativa_chunks';
    let municipalRetrievalData: V1Chunk[] = [];
    let municipalRetrievalError: unknown = null;
    let municipalRetrievalStrategy: 'strict' | 'document_scope' | 'municipal_scope' | 'none' = 'none';
    let municipalRetrievalAttemptCount = 0;
    let municipalStrictCandidateCount = 0;
    let municipalDocumentScopeCandidateCount = 0;
    let municipalBroadCandidateCount = 0;
    let municipalFallbackUsed = false;
    let municipalRetrievalStatus: 'NONE' | 'MATCHES' | 'NO_MATCHES' | 'TIMEOUT' | 'ERROR' | 'NON_SPECIFIC_EVIDENCE' = 'NONE';
    let municipalRetrievalSpecificStatus: 'NONE' | 'MATCHES' | 'NO_MATCHES' | 'TIMEOUT' | 'ERROR' = 'NONE';
    let municipalEvidenceSpecificity: 'NONE' | 'SPECIFIC' | 'NON_SPECIFIC' = 'NONE';

    let legacyCorpusAvailable = true;
    const checkCorpus = async (codigo: string) => {
      if (typeof supabase.from !== 'function') {
        return { exists: true, error: null };
      }
      const { data, error } = await supabase
        .from('normativa_chunks')
        .select('id')
        .eq('municipio_codigo', codigo)
        .limit(1);
      if (error) return { exists: false, error };
      if (Array.isArray(data) && data.length > 0) return { exists: true, error: null };
      legacyCorpusAvailable = false;

      // V2 is a valid municipal corpus in its own right. Keep the historical
      // V1 check as the fast path, but do not turn the absence of V1 rows into
      // a false "no corpus" result for an instrument scoped to V2.
      const v2Result = await supabase
        .from('normative_chunks_v2')
        .select('id')
        .eq('metadata->>municipalityCode', codigo)
        .limit(1);
      if (v2Result.error) return { exists: false, error: v2Result.error };
      return { exists: Array.isArray(v2Result.data) && v2Result.data.length > 0, error: null };
    };

    const shouldRetrieveMunicipal =
      supplementaryScope.retrieveMunicipal && Boolean(municipioCodigo);
    let corpusAvailable = true;

    if (shouldRetrieveMunicipal) {
      const corpusCheck = await checkMunicipalCorpusAvailability(municipioCodigo, checkCorpus);
      if (corpusCheck.error) {
        municipalRetrievalError = corpusCheck.error;
        corpusAvailable = false;
      } else if (!corpusCheck.exists) {
        corpusAvailable = false;
      }
    }

    if (shouldRetrieveMunicipal && corpusAvailable && scopedRetrieval && identityReferenceChunkIds.length > 0 && plan?.corpus !== 'v2') {
      // A catalog identity is an authoritative, instrument-scoped index. Read
      // only its exact chunk references before attempting broad vector RPCs.
      const referenceRows = await supabase
        .from('normativa_chunks')
        .select(EXACT_CHUNK_SELECT)
        .eq('municipio_codigo', municipioCodigo)
        .in('chunk_id', identityReferenceChunkIds)
      municipalRetrievalAttemptCount = 1;
      if (referenceRows.error) {
        municipalRetrievalError = referenceRows.error;
        municipalRetrievalStatus = 'ERROR';
        municipalRetrievalSpecificStatus = 'ERROR';
      } else {
        const scopedRows = (Array.isArray(referenceRows.data) ? referenceRows.data as ScopedChunkRow[] : []).filter((row) => {
          const metadata = row.metadata && typeof row.metadata === 'object' ? row.metadata as Record<string, unknown> : undefined;
          const metadataInstrument = typeof metadata?.instrumentId === 'string' ? metadata.instrumentId : undefined;
          const documentAllowed = !normativeScope.documentNames?.length || normativeScope.documentNames.includes(String(row.nombre_pdf ?? ''));
          return documentAllowed && (!metadataInstrument || metadataInstrument === normativeScope.instrumentId);
        });
        municipalRetrievalData = rankScopedChunkRows(scopedRows, query_embedding, 8, null) as V1Chunk[];
        municipalRetrievalStrategy = 'document_scope';
        municipalRetrievalStatus = municipalRetrievalData.length > 0 ? 'MATCHES' : 'NO_MATCHES';
        municipalRetrievalSpecificStatus = municipalRetrievalStatus === 'MATCHES' ? 'MATCHES' : 'NO_MATCHES';
        municipalEvidenceSpecificity = municipalRetrievalData.length > 0 ? 'SPECIFIC' : 'NONE';
        municipalDocumentScopeCandidateCount = municipalRetrievalData.length;
      }
    } else if (shouldRetrieveMunicipal && corpusAvailable && scopedRetrieval && !(plan?.corpus === 'v2' && identityReferenceChunkIds.length > 0)) {
      const progressiveRetrieval = await retrieveMunicipalProgressively(
        {
          query_embedding,
          match_count: 8,
          filter_municipio_codigo: municipioCodigo,
          filter_document_names: normativeScope.documentNames ?? null,
          filter_ordinance: normativeScope.ordinance ?? null,
          retrieveMunicipal: true,
        },
        async (rpcArguments) => {
          const result = await supabase
            .rpc('match_normativa_chunks_scoped', rpcArguments)
            .abortSignal(signal);
          return {
            data: (Array.isArray(result.data) ? result.data : []) as V1Chunk[],
            error: result.error,
          };
        },
        async (scopedArguments) => {
          // If the ordinance predicate in the RPC times out, keep the same
          // municipality/document scope and rank only that bounded subset
          // locally. This never broadens the corpus or silently drops scope.
          if (!scopedArguments.filter_document_names?.length) {
            return { data: [], error: null };
          }
          const scopedRows: ScopedChunkRow[] = [];
          const pageSize = 1000;
          const maxRows = 5000;
          for (let offset = 0; offset < maxRows; offset += pageSize) {
            const page = await supabase
              .from('normativa_chunks')
              .select('chunk_id,municipio_nombre,nombre_pdf,titulo_detectado,texto,ruta_pdf,metadata,embedding')
              .eq('municipio_codigo', scopedArguments.filter_municipio_codigo)
              .in('nombre_pdf', scopedArguments.filter_document_names)
              .range(offset, offset + pageSize - 1);
            if (page.error) return { data: [], error: page.error };
            if (Array.isArray(page.data)) scopedRows.push(...(page.data as ScopedChunkRow[]));
            if (!Array.isArray(page.data) || page.data.length < pageSize) break;
          }
          return {
            data: rankScopedChunkRows(
              scopedRows,
              scopedArguments.query_embedding,
              scopedArguments.match_count,
              scopedArguments.filter_ordinance
            ),
            error: null,
          };
        }
      );
      municipalRetrievalData = progressiveRetrieval.data;
      municipalRetrievalError = progressiveRetrieval.error;
      municipalRetrievalStrategy = progressiveRetrieval.strategy;
      municipalRetrievalAttemptCount = progressiveRetrieval.attemptCount;
      municipalStrictCandidateCount = progressiveRetrieval.strictCandidateCount;
      municipalDocumentScopeCandidateCount = progressiveRetrieval.documentScopeCandidateCount;
      municipalBroadCandidateCount = progressiveRetrieval.broadCandidateCount;
      municipalFallbackUsed = progressiveRetrieval.fallbackUsed;
      municipalRetrievalStatus = progressiveRetrieval.status;
      municipalRetrievalSpecificStatus = progressiveRetrieval.specificStatus;
      municipalEvidenceSpecificity = progressiveRetrieval.evidenceSpecificity;
    } else if (shouldRetrieveMunicipal && corpusAvailable) {
      const result = await supabase
        .rpc(rpcName, {
          query_embedding,
          match_count: 8,
          filter_municipio_codigo: municipioCodigo,
        })
        .abortSignal(signal);
      municipalRetrievalData = (Array.isArray(result.data) ? result.data : []) as V1Chunk[];
      municipalRetrievalError = result.error;
      municipalRetrievalStrategy = 'municipal_scope';
      municipalRetrievalAttemptCount = 1;
      municipalBroadCandidateCount = municipalRetrievalData.length;
    }
    const t1_v1 = performance.now();
    const v1_time_ms = Math.round(t1_v1 - t0_v1);
    console.info('[ChatRpcPerf]', {
      expedienteId,
      rpcName: supplementaryScope.retrieveMunicipal ? rpcName : 'not_executed',
      rpcMs: v1_time_ms,
      requestAborted: signal.aborted,
      status: municipalRetrievalError
        ? 'error'
        : municipalRetrievalStatus === 'TIMEOUT'
          ? 'timeout'
          : municipalRetrievalStatus === 'ERROR'
            ? 'error'
            : 'completed',
      municipalRetrievalStrategy,
      municipalRetrievalAttemptCount,
      municipalFallbackUsed,
    });

    if (municipalRetrievalError) {
      const progressiveFailure = municipalRetrievalStatus === 'TIMEOUT' || municipalRetrievalStatus === 'ERROR';
      if (progressiveFailure) {
        // A scoped retrieval failure is a safe, non-fatal lack of evidence.
        // Do not replace it with a broader municipal search or a generic 500.
        console.warn('[MunicipalRetrievalUnavailable]', {
          expedienteId,
          status: municipalRetrievalStatus,
          strategy: municipalRetrievalStrategy,
          failedOperation: municipalRetrievalStatus === 'TIMEOUT' ? 'ordinance_scoped_rpc_timeout' : 'ordinance_scoped_rpc_error',
        });
        municipalRetrievalData = [];
        municipalRetrievalError = null;
      }
    }

    if (municipalRetrievalError) {
      console.error('Supabase RPC error:', {
        expedienteId,
        rpcName,
        requestAborted: signal.aborted,
        errorName:
          typeof municipalRetrievalError === 'object' && municipalRetrievalError && 'name' in municipalRetrievalError
            ? String(municipalRetrievalError.name)
            : 'SupabaseRpcError',
      });
      return NextResponse.json({ error: 'Error querying database' }, { status: 500 });
    }

    const v1Candidates = mapV1Candidates(
      municipalRetrievalData,
      scopedRetrieval ? normativeScope : undefined,
      'municipal',
      municipalEvidenceSpecificity === 'NON_SPECIFIC' ? 'NON_SPECIFIC' : 'SPECIFIC'
    );
    traceCatalogRuntime(expedienteId, 'retrieval-summary', {
      strategy: municipalRetrievalStrategy,
      status: municipalRetrievalStatus,
      attempts: municipalRetrievalAttemptCount,
      exactChunkIdsRequested: identityReferenceChunkIds,
      chunkIdsReturned: municipalRetrievalData.map((chunk) => String(chunk.chunk_id)),
      v1CandidateCount: v1Candidates.length,
      evidenceSpecificity: municipalEvidenceSpecificity,
    })

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
    let v2Citas = '';
    let v2Results: V2SearchResult[] = [];
    let v2Candidates: ChatNormativeCandidate[] = [];

    const cteLayer = supplementaryScope.layers.find((layer) => layer.source === 'v2');
    const v2ScopedIdentity = Boolean(
      normativeScope.municipioCodigo && normativeScope.instrumentId && normativeScope.ordinance,
    );
    const v2CorpusRequested = plan?.corpus === 'v2' || (corpusAvailable && !legacyCorpusAvailable && v2ScopedIdentity);
    const catalogV2Requested = v2CorpusRequested && identityReferenceChunkIds.length > 0;
    const v2Layer = cteLayer ?? (v2CorpusRequested ? { scopes: [], categories: [] } : undefined);
    let v2Entry = Boolean(v2Layer);
    if (v2Entry) {
      traceCatalogRuntime(expedienteId, 'v2-entry', { branch: 'v2' });
    }
    if (v2Layer) {
      try {
        const { searchNormativeV2 } = await import('@/application/knowledge-engine/searchNormativeV2');

        const t0_v2 = performance.now();
        const v2Promise = searchNormativeV2({
          query_embedding,
           scopes: [...(v2Layer.scopes ?? [])],
           categories: [...(v2Layer.categories ?? [])],
           documentCodes: plan?.documentCodes || [],
           municipalityId: v2CorpusRequested ? normativeScope.municipioCodigo : undefined,
           instrumentId: v2CorpusRequested ? normativeScope.instrumentId : undefined,
           parentInstrumentId: v2CorpusRequested ? null : undefined,
           identityChunkIds: catalogV2Requested ? identityReferenceChunkIds : undefined,
           allowProvisional: v2ScopedIdentity,
           limit: 8,
        });

        const timeoutPromise = new Promise<V2SearchResult[]>((_, reject) => setTimeout(() => reject(new Error('Timeout')), 3000));
        v2Results = (await Promise.race([v2Promise, timeoutPromise])) as V2SearchResult[];
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
            v2FinalContext = 'NORMATIVA MUNICIPAL APLICABLE:\n\n';
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
               regimeMetadata: result.metadata?.regime ?? null,
               identityId: normativeScope.identityId ?? null,
               normativeReferences: normativeScope.normativeReferences,
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

    // Retrieval intent cannot select an empty V2 response path.
    v2Entry = usedV2 && v2Candidates.length > 0;
    let applicability: ApplicabilityResult;
    let retrievalApplicability: ApplicabilityResult;
    let answerCandidates: NormativeCandidate[];
    if (v2Entry) {
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
    const isDocumentScope = requestsNormativeDocumentScope(message) || (normativeScope ? shouldUseDocumentScope(message, normativeScope, municipioCodigo) : false);
    if (questionScope === 'mixed') {
      applicability = {
        ...layeredRegimeApplicability,
        status: layeredRetrievalApplicability.status === 'CONFLICTIVO' ? 'CONFLICTIVO' : layeredRetrievalApplicability.applicable.length > 0 ? 'DETERMINADO' : 'NO_DETERMINADO',
        applicable: layeredRetrievalApplicability.applicable,
        rejected: layeredRetrievalApplicability.rejected,
      };
      answerCandidates = layeredRetrievalApplicability.applicable;
    } else if (isDocumentScope && !concreteParameterRequested) {
      applicability = layeredRetrievalApplicability;
      answerCandidates = applicability.applicable.length > 0
        ? applicability.applicable
        : applicability.review;
    } else {
      applicability = layeredRegimeApplicability;
      answerCandidates = applicability.applicable.length > 0
        ? applicability.applicable
        : applicability.review;
    }
    retrievalApplicability = layeredRetrievalApplicability;
    traceCatalogRuntime(expedienteId, 'applicability', {
      answerCandidateIds: answerCandidates.map((candidate) => candidate.id),
      answerCandidateDocuments: answerCandidates.map((candidate) => candidate.documentName ?? null),
      applicabilityStatus: applicability.status,
      retrievalApplicabilityStatus: retrievalApplicability.status,
      missingData: applicability.missingData,
    })

    const hasConditionalRegimeEvidence =
      conditionalViabilityRequested &&
      applicability.canAnswerConditionalViability === true &&
      answerCandidates.length > 0;

    const hasAuthoritativeCanonicalEvidence = Boolean(
      normativeScope.authoritativeSelection &&
      answerCandidates.some((candidate) =>
        candidate.catalogStatus === 'ACCEPTED' &&
        Boolean(candidate.identityId) &&
        (candidate.normativeReferences?.length ?? 0) > 0
      )
    );
    const hasReviewableRegimeEvidence =
      questionScope === 'regime' &&
      applicability.status === 'PARCIAL' &&
      applicability.review.length > 0 &&
      !hasAuthoritativeCanonicalEvidence;

    const hardStopNoCandidates = answerCandidates.length === 0;
    const hardStopRetrievalConflict = retrievalApplicability.status === 'CONFLICTIVO';
    const hasSpecificNormativeEvidenceForIdentity = hasSpecificNormativeEvidence(answerCandidates, normativeScope);
    const hardStopTerritorialConflict =
      questionScope === 'regime' &&
      applicability.status === 'CONFLICTIVO' &&
      !hasSpecificNormativeEvidenceForIdentity;

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
      const deterministicMissingFacts = buildDeterministicMissingFacts(applicability, parcelContext);
      const missingDataCodes = deterministicMissingFacts.map((d: string) => {
        if (d.includes('clasificación')) return 'MISSING_CLASIFICACION';
        if (d.includes('calificación') || d.includes('ordenanza')) return 'MISSING_CALIFICACION';
        if (d.includes('ámbito') || d.includes('zona')) return 'MISSING_AMBITO';
        if (d.includes('categoría')) return 'MISSING_CATEGORIA';
        if (d.includes('evidencia documental suficiente')) return 'MISSING_DOCUMENTARY_EVIDENCE';
        if (d.includes('MISSING_REGIME_VALIDATION')) return 'MISSING_REGIME_VALIDATION';
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
        municipalRetrievalStrategy,
        municipalRetrievalAttemptCount,
        municipalRetrievalStatus,
        municipalRetrievalSpecificStatus,
        municipalEvidenceSpecificity,
        municipalStrictCandidateCount,
        municipalDocumentScopeCandidateCount,
        municipalBroadCandidateCount,
        municipalFallbackUsed,
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
        hasSpecificNormativeEvidenceForIdentity,
        applicableCount: applicability.applicable.length,
        reviewCount: applicability.review.length,
        rejectedCount: applicability.rejected.length,
        missingDataCount: deterministicMissingFacts.length,
        reviewOnlyClaimRejectedCount: Number(extraParams.reviewOnlyClaimRejectedCount ?? 0),
        questionIntent,
        primaryClaimCount: Number(extraParams.primaryClaimCount ?? 0),
        contextClaimCount: Number(extraParams.contextClaimCount ?? 0),
        irrelevantClaimCount: Number(extraParams.irrelevantClaimCount ?? 0),
        semanticFallbackUsed: Boolean(extraParams.semanticFallbackUsed ?? false),
        semanticFallbackReason: extraParams.semanticFallbackReason ?? null,
        conflictCount: applicability.conflicts.length, ...extraParams, });
    }

    if (mustAbstain && !v2Entry) {
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

    if (v2Entry) {
      const classification = parcelContext.urbanisticFacts?.classification?.value;
      const category = parcelContext.urbanisticFacts?.category?.value;
      const municipality = parcelContext.municipality?.value;
      const facts = [
        municipality?.name ? `Municipio: ${municipality.name}${municipality.ineCode ? ` (INE ${municipality.ineCode})` : ''}.` : '',
        parcelContext.planningInstrument?.value ? `Instrumento de planeamiento: ${parcelContext.planningInstrument.value}.` : '',
        parcelContext.cadastralReference?.value ? `Parcela: ${parcelContext.cadastralReference.value}.` : '',
        parcelContext.parcelSurfaceSquareMetres ? `Superficie de parcela: ${parcelContext.parcelSurfaceSquareMetres} m².` : '',
        parcelContext.actionArea?.value.surfaceSquareMetres ? `Superficie del área de actuación: ${parcelContext.actionArea.value.surfaceSquareMetres} m².` : '',
        classification ? `Clasificación: ${typeof classification === 'string' ? classification : `${classification.code ?? ''}${classification.label ? ` — ${classification.label}` : ''}`}.` : '',
        category ? `Categoría: ${typeof category === 'string' ? category : `${category.code ?? ''}${category.label ? ` — ${category.label}` : ''}`}.` : '',
      ];
      const confirmedCandidate = parcelContext.ordinanceCandidates?.find((candidate) => candidate.status === 'user_confirmed' && candidate.identity.trim());
      const confirmedCode = normativeScope.ordinance ?? confirmedCandidate?.identity ?? (parcelContext.qualification?.verification === 'confirmed' ? parcelContext.qualification.value : undefined);
      const confirmedOrdinance = confirmedCode && (confirmedCandidate || parcelContext.qualification?.verification === 'confirmed' || normativeScope.catalogStatus === 'ACCEPTED')
        ? { code: confirmedCode, name: normativeScope.identityName }
        : undefined;
      const canonicalNormativeIdentityEstablished = Boolean(
        normativeScope.authoritativeSelection &&
        normativeScope.catalogStatus === 'ACCEPTED' &&
        normativeScope.identityId &&
        (normativeScope.normativeReferences?.length ?? 0) > 0
      );
      const uncertainties = [
        applicability.status === 'CONFLICTIVO' ? 'La parcela presenta heterogeneidad territorial. Esta circunstancia puede limitar conclusiones que dependan de la distribución espacial exacta dentro de la parcela, pero no invalida una ordenanza confirmada ni la normativa oficial.' : '',
        ...(buildDeterministicMissingFacts(applicability, parcelContext).filter((fact) => !/^MISSING_|^NO_/.test(fact))),
      ];
      const v2Prompt = buildV2EffectivePrompt({
        facts,
        confirmedOrdinance,
        normativeIdentityAuthority: canonicalNormativeIdentityEstablished ? 'ESTABLISHED' : 'UNKNOWN',
        spatialExtentAuthority: canonicalNormativeIdentityEstablished ? 'UNKNOWN' : undefined,
        normativeReferences: normativeScope.normativeReferences ?? [],
        normativeContext: v2FinalContext,
        uncertainties,
      });
      contextText = v2Prompt.contextText;
      systemPrompt = v2Prompt.systemPrompt;
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
    let semanticComposition: SemanticCompositionResult | null = null;

    let directedRetrievalUsed = false;
    const recoverableNormativeMissingFacts = (facts: string[]) => facts.filter((fact) =>
      /\b(?:ordenanza|normativ|art[ií]culo|ficha|compatib|edificaci[oó]n|edificabilidad|uso|parcela|posici[oó]n|zona|r[eé]gimen|planeamiento|document|regulaci[oó]n)\b/i.test(fact)
    )

    const runDirectedNormativeRetrieval = async (missingFacts: string[]) => {
      if (
        directedRetrievalUsed ||
        !municipioCodigo ||
        !normativeScope.instrumentId ||
        !normativeScope.documentNames?.length
      ) return false

      const directedFacts = recoverableNormativeMissingFacts(missingFacts).slice(0, 8)
      if (directedFacts.length === 0) return false
      directedRetrievalUsed = true
      const directedQuery = [
        message,
        `Ordenanza o identidad normativa autoritativa: ${normativeScope.ordinance ?? 'no determinada'}.`,
        'Investigar específicamente estas carencias normativas:',
        ...directedFacts.map((fact) => `- ${fact}`),
      ].join('\n')
      const mentionedIdentities = resolveMentionedAcceptedIdentities(
        `${message}\n${directedFacts.join('\n')}`,
        getInstrumentIdentityCatalog(normativeScope.municipioCodigo, normativeScope.instrumentId),
      )
      const initialIdentity = normativeScope.identityId
        ? getInstrumentIdentityCatalog(normativeScope.municipioCodigo, normativeScope.instrumentId)?.identities.find((identity) => identity.id === normativeScope.identityId)
        : undefined
      const canonicalIdentities = [...new Map(
        [initialIdentity, ...mentionedIdentities]
          .filter((identity): identity is NonNullable<typeof identity> => Boolean(identity))
          .map((identity) => [identity.id, identity])
      ).values()]
      const widenIdentityScope = shouldWidenDirectedNormativeScope(
        message,
        directedFacts,
        normativeScope.identityId ? normativeScope.ordinance : null,
      )

      const exactIdentityReferences = canonicalIdentities.length > 1
        ? [...new Map(canonicalIdentities.flatMap((identity) => identity.normativeReferences.flatMap((reference) =>
          reference.chunkIds.map((chunkId) => [chunkId, identity] as const)
        ))).entries()]
        : []
      if (widenIdentityScope && exactIdentityReferences.length > 0) {
        const exactChunkIds = exactIdentityReferences.map(([chunkId]) => chunkId)
        const exactRows = await supabase
          .from('normativa_chunks')
          .select(EXACT_CHUNK_SELECT)
          .eq('municipio_codigo', municipioCodigo)
          .in('chunk_id', exactChunkIds)
        const scopedRows = (Array.isArray(exactRows.data) ? exactRows.data as ScopedChunkRow[] : []).filter((row) => {
          const metadata = row.metadata && typeof row.metadata === 'object' ? row.metadata as Record<string, unknown> : undefined
          const metadataInstrument = typeof metadata?.instrumentId === 'string' ? metadata.instrumentId : undefined
          return (!metadataInstrument || metadataInstrument === normativeScope.instrumentId) &&
            (!normativeScope.documentNames?.length || normativeScope.documentNames.includes(String(row.nombre_pdf ?? '')))
        })
        const exactData = rankScopedChunkRows(scopedRows, query_embedding, 8, null) as V1Chunk[]
        const additionalCandidates = mapV1Candidates(exactData, normativeScope, 'municipal', 'SPECIFIC', false).map((candidate) => {
          const identity = exactIdentityReferences.find(([chunkId]) => chunkId === candidate.id)?.[1]
          return identity
            ? {
                ...candidate,
                ordinance: identity.officialCode,
                identityId: identity.id,
                catalogStatus: 'ACCEPTED' as const,
                normativeReferences: identity.normativeReferences,
              }
            : candidate
        })
        traceCatalogRuntime(expedienteId, 'directed-retrieval', {
          retrievalNumber: 2,
          strategy: 'canonical_multi_identity',
          query: directedQuery,
          missingFacts: directedFacts,
          municipalityCode: municipioCodigo,
          instrumentId: normativeScope.instrumentId,
          identities: canonicalIdentities.map((identity) => ({
            identityId: identity.id,
            officialCode: identity.officialCode,
            semanticDimension: identity.semanticDimension,
            status: identity.status,
            normativeReferences: identity.normativeReferences,
          })),
          exactChunkIdsRequested: exactChunkIds,
          filterOrdinance: 'multi_identity_exact_references',
          widenedIdentityScope: true,
          status: exactRows.error ? 'ERROR' : exactData.length > 0 ? 'MATCHES' : 'NO_MATCHES',
          attemptCount: 1,
          chunkIdsReturned: exactData.map((chunk) => String(chunk.chunk_id)),
        })
        if (exactRows.error || exactData.length === 0) return false
        const candidateById = new Map(answerCandidates.map((candidate) => [candidate.id, candidate]))
        for (const candidate of additionalCandidates) candidateById.set(candidate.id, candidate)
        answerCandidates = [...candidateById.values()]
        sources = mapVisibleSources(answerCandidates)
        const additionalEvidence = additionalCandidates.map((candidate) => {
          const sourceIndex = answerCandidates.findIndex((item) => item.id === candidate.id) + 1
          return `[Fuente ${sourceIndex}]\nDocumento: ${candidate.documentName ?? 'Documento'}\n` +
            `Identidad normativa: ${candidate.identityId ?? 'no demostrada'}\n` +
            `Código oficial: ${candidate.ordinance ?? 'no determinado'}\n` +
            `Dimensión semántica: ${candidate.regimeMetadata?.kind ?? 'no determinada'}\n` +
            `Instrumento: ${normativeScope.instrumentId}\n` +
            `Fragmento:\n${candidate.content}`
        }).join('\n\n')
        systemPrompt += `\n\nEVIDENCIA NORMATIVA ADICIONAL RECUPERADA TRAS REVISAR LAS CARENCIAS DEL PRIMER RAZONAMIENTO\n${additionalEvidence}`
        if (v2Entry) contextText += `\n\nEVIDENCIA NORMATIVA ADICIONAL\n${additionalEvidence}`
        return true
      }
      const directedEmbeddingResult = await embeddingModel.embedContent({
        content: { role: 'user', parts: [{ text: directedQuery }] },
        taskType: TaskType.RETRIEVAL_QUERY,
      }, { timeout: CHAT_REQUEST_TIMEOUT_MS, signal });
      recordRuntimeCall({
        requestId,
        provider: 'gemini',
        model: 'gemini-embedding-001',
        callType: 'embedding',
      });
      const directedEmbedding = Array.from(directedEmbeddingResult.embedding.values).slice(0, 768);
      if (directedEmbedding.length < 768) return false

      const directedRetrieval = await retrieveMunicipalProgressively(
        {
          query_embedding: directedEmbedding,
          match_count: 8,
          filter_municipio_codigo: municipioCodigo,
          // Keep the canonical ordinance boundary unless the question or the
          // missing facts explicitly require another identity/cross-zone rule.
          filter_document_names: normativeScope.documentNames,
          filter_ordinance: widenIdentityScope ? null : normativeScope.ordinance,
          allowDocumentScopeFallback: widenIdentityScope,
          retrieveMunicipal: true,
          hasMunicipalCorpus: true,
        },
        async (rpcArguments) => {
          const result = await supabase
            .rpc('match_normativa_chunks_scoped', rpcArguments)
            .abortSignal(signal);
          return {
            data: (Array.isArray(result.data) ? result.data : []) as V1Chunk[],
            error: result.error,
          };
        }
      );
      traceCatalogRuntime(expedienteId, 'directed-retrieval', {
        retrievalNumber: 2,
        query: directedQuery,
        missingFacts: directedFacts,
        municipalityCode: municipioCodigo,
        instrumentId: normativeScope.instrumentId,
        documentNames: normativeScope.documentNames,
        filterOrdinance: widenIdentityScope ? null : normativeScope.ordinance,
        widenedIdentityScope: widenIdentityScope,
        status: directedRetrieval.status,
        attemptCount: directedRetrieval.attemptCount,
        chunkIdsReturned: directedRetrieval.data.map((chunk) => String(chunk.chunk_id)),
      });
      if (directedRetrieval.error || directedRetrieval.data.length === 0) return false

      const additionalCandidates = mapV1Candidates(
        directedRetrieval.data,
        normativeScope,
        'municipal',
        'SPECIFIC',
        false
      );
      const candidateById = new Map(answerCandidates.map((candidate) => [candidate.id, candidate]));
      for (const candidate of additionalCandidates) candidateById.set(candidate.id, candidate);
      answerCandidates = [...candidateById.values()];
      sources = mapVisibleSources(answerCandidates);
      const additionalEvidence = additionalCandidates.map((candidate) => {
        const sourceIndex = answerCandidates.findIndex((item) => item.id === candidate.id) + 1;
        return `[Fuente ${sourceIndex}]\nDocumento: ${candidate.documentName ?? 'Documento'}\n` +
          `Identidad normativa: ${candidate.identityId ?? 'no demostrada'}\n` +
          `Código oficial: ${candidate.ordinance ?? 'no determinado'}\n` +
          `Dimensión semántica: ${candidate.regimeMetadata?.kind ?? 'no determinada'}\n` +
          `Instrumento: ${normativeScope.instrumentId}\n` +
          `Fragmento:\n${candidate.content}`;
      }).join('\n\n');
      systemPrompt += `\n\nEVIDENCIA NORMATIVA ADICIONAL RECUPERADA TRAS REVISAR LAS CARENCIAS DEL PRIMER RAZONAMIENTO\n${additionalEvidence}`;
      if (v2Entry) contextText += `\n\nEVIDENCIA NORMATIVA ADICIONAL\n${additionalEvidence}`;
      return true
    };

    const maxRetries = 1;
    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      const reasonerRequest: ReasonerRequest = {
        systemPrompt,
        userPrompt: v2Entry
          ? `CONTEXTO RECUPERADO:\n${contextText}\n\nPregunta: ${message}`
          : attempt > 0 ? `Tu respuesta anterior fue vacía o un JSON inválido. Por favor, corrige el formato y responde OBLIGATORIAMENTE con el schema JSON provisto.\n\nPregunta: ${message}` : message,
        signal,
        timeoutMs: CHAT_REQUEST_TIMEOUT_MS,
      };
      traceCatalogRuntime(expedienteId, 'prompt-boundary', {
        attempt,
        answerCandidateIds: answerCandidates.map((candidate) => candidate.id),
        sourceCountBeforeLlm: sources.length,
        promptHasR2: /R-2/i.test(`${reasonerRequest.systemPrompt}\n${reasonerRequest.userPrompt}`),
        promptHasArt130: /Art\.?\s*130/i.test(`${reasonerRequest.systemPrompt}\n${reasonerRequest.userPrompt}`),
        identityId: normativeScope.identityId ?? null,
        normativeReferences: normativeScope.normativeReferences ?? [],
      })

      const provider = getReasonerProvider();
      assertRuntimeBudgetAvailable(provider.name);
      const result = await provider.generate(reasonerRequest);
      const runtimeCall = recordRuntimeCall({
        requestId,
        provider: result.provider,
        model: result.model,
        callType: 'reasoning',
        inputTokens: result.inputTokens,
        outputTokens: result.outputTokens,
        totalTokens: result.totalTokens,
        cachedTokens: result.cachedInputTokens,
        reasoningTokens: result.reasoningTokens,
        retryAttempt: attempt,
      });
      recordLLMUsage({ operationType: 'chat_query', operationId: requestId, requestId, expedienteId, stage: v2Entry ? 'chat-v2' : 'chat', inferenceIndex: attempt + 1, provider: result.provider, model: result.model, inputTokens: result.inputTokens ?? null, cachedInputTokens: result.cachedInputTokens ?? null, outputTokens: result.outputTokens ?? null, reasoningTokens: result.reasoningTokens ?? null, totalTokens: result.totalTokens ?? null, durationMs: result.latencyMs ?? null, toolCallsRequested: 0, finishReason: null });
      traceCatalogRuntime(expedienteId, 'runtime-call', runtimeCall as unknown as Record<string, unknown>);
      const rawContent = result.rawContent;
      traceCatalogRuntime(expedienteId, 'model-raw', {
        attempt,
        rawLength: rawContent.length,
        rawContent,
      })

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

      if (process.env.NODE_ENV !== 'production' && (process.env.URBANBRAIN_CAPTURE_REASONER_OUTPUT === '1' || process.env.URBANBRAIN_CAPTURE_REASONER_REQUEST === '1')) {
        try {
          const captureData = {
            answerMode: parsed.answerMode,
            claims: parsed.claims.map(c => ({
              id: c.id,
              type: c.type,
              text: c.text,
              sourceRefs: c.sourceRefs,
              appliesToParcel: c.appliesToParcel,
              numericTokens: c.numericTokens
            })),
            missingFacts: parsed.missingFacts
          };
          fs.writeFileSync(
            path.join(process.cwd(), '.reasoner_output_capture.json'),
            JSON.stringify(captureData, null, 2)
          );
        } catch (e) {
          console.error('Failed to capture reasoner output:', e);
        }
      }

      outputParsed = true;
      if (attempt === 0 && parsed.missingFacts.length > 0) {
        const addedEvidence = await runDirectedNormativeRetrieval(parsed.missingFacts);
        if (addedEvidence) {
          reasonerRetryUsed = true;
          continue;
        }
      }
      validation = validateReasonerOutput(parsed, answerCandidates, applicability, parcelContext, undefined, v2Entry);
      traceStage = 'post-validation';
      traceCatalogRuntime(expedienteId, 'validation', {
        validClaims: validation.validClaims.length,
        invalidClaimCount: validation.invalidClaimCount,
        invalidClaimReasonCounts: validation.invalidClaimReasonCounts,
        citations: validation.citations,
      })

      if (validation.validClaims.length === 0) {
        // Structured reasoner output always stays on the direct beta path.
        // With no mechanically valid claims there is no evidence to render,
        // so return the minimal technical fallback rather than invoking the
        // legacy semantic/template compositor.
        decision = 'abstain';
        traceStage = 'v2-technical-fallback';
        const failedApplicability: ApplicabilityResult = {
          ...applicability,
          missingData: [
            ...applicability.missingData,
            'evidencia documental suficiente para respaldar las afirmaciones normativas solicitadas',
          ],
          canAnswerConcreteParameters: false,
        };
        answer = buildV2TechnicalFallback();
        applicability = failedApplicability;
        sources = [];
      } else {
        // Once the structured reasoner has produced mechanically valid claims,
        // preserve them verbatim through the neutral renderer. The legacy
        // semantic compositor is intentionally unreachable from this route.
        traceStage = 'v2-neutral-composer';
        answer = renderValidatedClaimsNeutral(validation.validClaims);
        traceAnswerStage(requestId, expedienteId, 'v2-neutral-composer', 'v2-neutral-composer', answer, validation.validClaims.length);
      }

      traceAnswerStage(requestId, expedienteId, 'post-validation', 'v2', answer, validation.validClaims.length);
      traceStage = 'post-validation-marker';

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

    answer = sanitizePresentationText(answer);

    traceAnswerStage(requestId, expedienteId, 'before-http-response', 'final-response', answer, validation?.validClaims.length ?? 0);

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
        reviewOnlyClaimRejectedCount: validation?.invalidClaimReasonCounts.REVIEW_ONLY_PARCEL_CLAIM ?? 0,
        renderedFromClaims: outputParsed && validation && validation.validClaims.length > 0,
        reasonerRetryUsed,
        reasonerParseFailureCode,
        primaryClaimCount: 0,
        contextClaimCount: 0,
        irrelevantClaimCount: 0,
        semanticFallbackUsed: false,
        semanticFallbackReason: null,
      }
    );

    return jsonWithRequestId(requestId, {
      answer,
      sources,
      safety: contract,
    });
  } catch (error) {
    traceCatalogRuntime(tracedExpedienteId, 'route-error', {
      stage: traceStage,
      errorName: error instanceof Error ? error.name : 'UnknownError',
      errorMessage: error instanceof Error ? error.message : String(error),
      errorStack: error instanceof Error ? error.stack ?? null : null,
    });
    if (signal.aborted || (error instanceof Error && error.name === 'AbortError')) {
      return jsonWithRequestId(requestId, { error: 'La consulta ha tardado demasiado. Inténtelo de nuevo.' }, { status: 504 });
    }
    if (error instanceof Error && error.name === 'RuntimeBudgetExceeded') {
      return jsonWithRequestId(requestId, { error: 'Presupuesto de IA agotado temporalmente.' }, { status: 429 });
    }
    console.error('ROUTE_TS_ERROR', error);
    return jsonWithRequestId(requestId, { error: 'Internal Server Error' }, { status: 500 });
  } finally {
    releaseChatSlot?.();
  }
}

export async function POST(req: NextRequest) {
  const requestId = randomUUID();
  const controller = new AbortController();
  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  const timeoutResponse = new Promise<NextResponse>((resolve) => {
    timeoutId = setTimeout(() => {
      controller.abort();
      resolve(jsonWithRequestId(requestId,
        { error: 'La consulta ha tardado demasiado. Inténtelo de nuevo.' },
        { status: 504 }
      ));
    }, CHAT_REQUEST_TIMEOUT_MS);
  });

  try {
    return await Promise.race([handlePost(req, controller.signal, requestId), timeoutResponse]);
  } finally {
    if (timeoutId) clearTimeout(timeoutId);
  }
}
