import type { ReasonerProvider, ReasonerRequest, ReasonerResult } from '@/application/chat/reasonerProvider'
import { recordLLMUsage, type LLMOperationContext } from '@/application/runtime/runtimeAccounting'
import { getReasonerProvider } from '@/application/chat/reasonerProvider'
import {
  buildTerritorialSemanticInputFingerprint,
  parseAndValidateTerritorialSemanticResolution,
  territorialSemanticResolutionJsonSchema,
  type TerritorialSemanticEvidenceInput,
  type TerritorialSemanticResolutionV1,
  type SemanticValidationError,
} from './territorialSemanticResolution'

export interface TerritorialSemanticOfficialSnapshot {
  municipalityCode: string
  instrumentId?: string
  candidates: TerritorialSemanticEvidenceInput['candidates']
  evidencePackets: TerritorialSemanticEvidenceInput['evidencePackets']
  catalogIdentities: TerritorialSemanticEvidenceInput['catalogIdentities']
  existingContradictions: string[]
}

export interface TerritorialSemanticShadowDiagnostics {
  status: 'validated' | 'validation_failed' | 'llm_failed'
  inputFingerprint: string
  input: TerritorialSemanticEvidenceInput
  request: Pick<ReasonerRequest, 'responseSchemaName' | 'responseSchema' | 'timeoutMs'>
  rawContent?: string
  resolution?: TerritorialSemanticResolutionV1
  errors?: SemanticValidationError[]
  provider?: string
  model?: string
  latencyMs?: number
  inputTokens?: number
  outputTokens?: number
  totalTokens?: number
  cachedInputTokens?: number
  reasoningTokens?: number
  error?: string
}

/** Builds the shadow input exclusively from the already extracted official snapshot. */
export function buildTerritorialSemanticEvidenceInput(snapshot: TerritorialSemanticOfficialSnapshot): TerritorialSemanticEvidenceInput {
  return {
    municipalityCode: snapshot.municipalityCode,
    instrumentId: snapshot.instrumentId,
    candidates: structuredClone(snapshot.candidates),
    evidencePackets: structuredClone(snapshot.evidencePackets),
    catalogIdentities: structuredClone(snapshot.catalogIdentities),
    existingContradictions: [...snapshot.existingContradictions],
  }
}

export function buildTerritorialSemanticShadowPrompt(input: TerritorialSemanticEvidenceInput) {
  const fingerprint = buildTerritorialSemanticInputFingerprint(input)
  return `You are a conservative territorial-evidence reconciler running in SHADOW mode. Return only the supplied JSON Schema.

Your task is semantic interpretation of supplied official evidence, not geometry calculation. The official attributes are observations, not answers. Keep these dimensions separate: homogeneous classification, homogeneous category, legal classification, legal category, planning category, use, denomination/territorial area, operational classification, and normative identity/ordinance. Preserve every official literal exactly. Evaluate each dimension only with the evidence relevant to that dimension. An absent ACCEPTED normative identity does not by itself invalidate a supported territorial classification or area. An unknown dimension must not erase another supported dimension. A contradiction must affect only the conclusions to which it relates; preserve unaffected conclusions and describe the affected dimension in contradictions. Coverage only limits spatial reach and must not be interpreted as semantics.

You may propose an operational classification or planning area only when the supplied official evidence reasonably supports a real semantic value. Never use status words such as unknown, review_required, conflict, or abstained as the value of a semantic field; omit that field when there is no defensible value. Do not assume any code equivalence and do not use a fixed urbanistic vocabulary. Do not invent identities, ordinances, aliases, documents, source attributes, candidate ids, feature ids, packet ids, coverage, surfaces, percentages, or geometries.

Every evidenceRefs entry must be an existing packetId from the input and must support the referenced candidate/instrument. Any normativeIdentity must be an exact identity from the supplied ACCEPTED catalog for the current instrument. Do not reason from geometry: coverage is contextual evidence only and must never appear in your output. If evidence is insufficient or contradictory, abstain or return the corresponding non-accepted status. This result is diagnostic only and must never be treated as operational authority.

The global status describes the whole reconciliation. Per-dimension status belongs on each observation. canonical.classification, canonical.planningArea, and canonical.normativeIdentityId may contain only conclusions represented by the corresponding observation and compatible with its dimension status. If the whole result is unknown, conflict, or abstained, leave canonical conclusions empty unless the contract explicitly supports an unaffected accepted dimension; never combine an unknown global result with an unsupported canonical claim.

Use this exact inputFingerprint: ${fingerprint}

OFFICIAL EVIDENCE INPUT:
${JSON.stringify(input, null, 2)}`
}

export function buildTerritorialSemanticShadowRequest(input: TerritorialSemanticEvidenceInput, timeoutMs = 120_000): ReasonerRequest {
  return {
    systemPrompt: 'You reconcile territorial semantics conservatively from official evidence. Never invent provenance or facts.',
    userPrompt: buildTerritorialSemanticShadowPrompt(input),
    timeoutMs,
    responseSchemaName: 'TerritorialSemanticResolutionV1',
    responseSchema: territorialSemanticResolutionJsonSchema,
  }
}

function providerDiagnostics(result: ReasonerResult) {
  return {
    provider: result.provider,
    model: result.model,
    latencyMs: result.latencyMs,
    inputTokens: result.inputTokens,
    outputTokens: result.outputTokens,
    totalTokens: result.totalTokens,
    cachedInputTokens: result.cachedInputTokens,
    reasoningTokens: result.reasoningTokens,
  }
}

/**
 * Executes one removable diagnostic call. It has no persistence and returns no
 * fallback interpretation when the provider or validator fails.
 */
export async function runTerritorialSemanticShadow(
  input: TerritorialSemanticEvidenceInput,
  options: { provider?: ReasonerProvider; timeoutMs?: number; operation?: LLMOperationContext } = {},
): Promise<TerritorialSemanticShadowDiagnostics> {
  const inputFingerprint = buildTerritorialSemanticInputFingerprint(input)
  const request = buildTerritorialSemanticShadowRequest(input, options.timeoutMs)
  const provider = options.provider ?? getReasonerProvider()
  try {
    const result = await provider.generate(request)
    if (options.operation) recordLLMUsage({ ...options.operation, requestId: options.operation.requestId ?? null, expedienteId: options.operation.expedienteId ?? null, stage: 'territorial-semantic-shadow', inferenceIndex: 1, provider: result.provider, model: result.model, inputTokens: result.inputTokens ?? null, cachedInputTokens: result.cachedInputTokens ?? null, outputTokens: result.outputTokens ?? null, reasoningTokens: result.reasoningTokens ?? null, totalTokens: result.totalTokens ?? null, durationMs: result.latencyMs ?? null, toolCallsRequested: 0, finishReason: null })
    const validation = parseAndValidateTerritorialSemanticResolution(result.rawContent, input)
    if (!validation.valid) {
      return {
        status: 'validation_failed',
        inputFingerprint,
        input,
        request,
        rawContent: result.rawContent,
        errors: validation.errors,
        ...providerDiagnostics(result),
      }
    }
    return {
      status: 'validated',
      inputFingerprint,
      input,
      request,
      rawContent: result.rawContent,
      resolution: validation.value,
      ...providerDiagnostics(result),
    }
  } catch (cause) {
    return {
      status: 'llm_failed',
      inputFingerprint,
      input,
      request,
      error: cause instanceof Error ? cause.message : String(cause),
    }
  }
}
