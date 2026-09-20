import type { ReasonerProvider } from '@/application/chat/reasonerProvider'
import { recordLLMUsage, type LLMOperationContext } from '@/application/runtime/runtimeAccounting'
import type { CatalogIdentityEvidence, CatalogNormativeReference, InstrumentIdentity, InstrumentIdentityCatalog, CatalogIdentityStatus } from '@/domain/planning-knowledge/identityCatalog'
import type { SemanticCatalogExtraction, SemanticCatalogModel, SemanticEvidencePacket, SemanticCatalogObservation, SemanticPromotionDecision } from '@/domain/planning-knowledge/semanticCatalog'

export const semanticCatalogResponseSchema = {
  type: 'object',
  properties: {
    observations: { type: 'array', items: {
      type: 'object', additionalProperties: false,
      properties: {
        observationId: { type: 'string' }, surfaceForm: { type: 'string' }, code: { anyOf: [{ type: 'string' }, { type: 'null' }] }, name: { anyOf: [{ type: 'string' }, { type: 'null' }] },
        dimension: { type: 'object', additionalProperties: false, properties: { label: { type: 'string' }, normalizedType: { anyOf: [{ type: 'string' }, { type: 'null' }] } }, required: ['label', 'normalizedType'] },
        role: { type: 'string' }, semanticRole: { type: 'string' }, territorialRelation: { type: 'object', additionalProperties: false, properties: { kind: { type: 'string' }, scope: { anyOf: [{ type: 'string' }, { type: 'null' }] } }, required: ['kind', 'scope'] }, identityAssessment: { type: 'object', additionalProperties: false, properties: { isTerritorialIdentity: { type: 'boolean' }, characterization: { type: 'string', enum: ['direct', 'indirect', 'none', 'uncertain'] }, normativeAxis: { type: 'string', enum: ['demonstrated', 'not_demonstrated', 'uncertain'] }, basis: { type: 'string' } }, required: ['isTerritorialIdentity', 'characterization', 'normativeAxis', 'basis'] }, aliases: { type: 'array', items: { type: 'string' } },
        evidence: { type: 'array', minItems: 1, items: { type: 'object', additionalProperties: false, properties: { packetId: { type: 'string' }, quote: { anyOf: [{ type: 'string' }, { type: 'null' }] }, relation: { type: 'string', enum: ['defines', 'regulates', 'mentions', 'maps_to', 'contradicts'] } }, required: ['packetId', 'quote', 'relation'] } },
        relatedObservations: { type: 'array', items: { type: 'string' } }, confidence: { type: 'string', enum: ['high', 'medium', 'low'] }, epistemicStatus: { type: 'string', enum: ['ACCEPTED', 'OBSERVED_NOT_ACREDITED', 'AMBIGUOUS', 'REVIEW_REQUIRED', 'REJECTED'] }, promotionDecision: { type: 'string', enum: ['NORMATIVE_IDENTITY', 'CONCEPT_ONLY', 'UNRESOLVED'] }, reasoning: { type: 'string' },
      }, required: ['observationId', 'surfaceForm', 'code', 'name', 'dimension', 'role', 'semanticRole', 'territorialRelation', 'identityAssessment', 'aliases', 'evidence', 'relatedObservations', 'confidence', 'epistemicStatus', 'promotionDecision', 'reasoning']
    } },
    warnings: { type: 'array', items: { type: 'string' } },
  }, required: ['observations', 'warnings'], additionalProperties: false,
} as const

function prompt(packets: SemanticEvidencePacket[]) {
  return `Discover the broad semantic vocabulary of this single planning instrument from the official evidence packets below. Do not assume that identities are called ordinances, use a known code format, appear in headings, or belong to a fixed dimension list. Discover dimensions and preserve their instrument-specific labels. Preserve concepts, rules, parameters, uses, documents, procedures, references, toponyms and auxiliary figures as observations when the evidence supports them; do not discard them. For every observation, describe semanticRole using an open vocabulary and territorialRelation using an open relation kind and optional scope. Then provide identityAssessment by answering two distinct questions: (1) does the finding itself characterize a territorial regime, area, location or other normative territorial determination, and (2) does the evidence demonstrate that it functions as a reusable normative axis for retrieving a set of applicable determinations for that location or area? Set normativeAxis to demonstrated only for the latter; use not_demonstrated when the finding merely describes, regulates, conditions, measures, groups, documents or affects something territorial, and uncertain when the evidence cannot establish the distinction. A direct characterization or isTerritorialIdentity=true is never sufficient by itself. The promotionDecision is only a proposal, not authorization. Use NORMATIVE_IDENTITY only when the evidence supports normativeAxis=demonstrated, CONCEPT_ONLY for a documented non-identity, and UNRESOLVED when role or evidence conflicts remain. ACCEPTED is only a documentary evidence judgment and never implies NORMATIVE_IDENTITY. A cartographic observation alone is not documentary accreditation. Every evidence item must cite a supplied packetId and a short quote when text exists. Never invent codes, names, relations or evidence.\n\n${packets.map((p) => `[${p.packetId}] ${p.kind} ${p.documentId} ${p.page ?? ''}\n${(p.text ?? '').slice(0, 12000)}`).join('\n\n')}`
}

const CATALOG_STATUSES = new Set(['ACCEPTED', 'OBSERVED_NOT_ACREDITED', 'AMBIGUOUS', 'REVIEW_REQUIRED', 'REJECTED'])

export interface SemanticBatchResult {
  extraction: SemanticCatalogExtraction
  rawContent: string
  rawOriginalContent?: string
  originalValidationErrors?: SemanticValidationFailure[]
  repairValidationErrors?: SemanticValidationFailure[]
  provider: string
  model: string
  latencyMs: number
  inputTokens?: number
  outputTokens?: number
  totalTokens?: number
  cachedInputTokens?: number
  reasoningTokens?: number
  attemptCount: number
  retryCount: number
  structurallyValid: boolean
  repairAttempted: boolean
  repaired: boolean
}

export interface SemanticRetryFailure {
  attemptCount: number
  retryCount: number
  durationMs: number
  lastError: string
  errorCause: string
  isTimeoutOrAbort: boolean
  isTransient: boolean
}

export interface SemanticValidationFailure {
  path: string
  message: string
  received: unknown
  expected: string
}

function validationFailure(path: string, message: string, received: unknown, expected: string): SemanticValidationFailure {
  return { path, message, received, expected }
}

function parseResult(raw: string, packets: SemanticEvidencePacket[]): SemanticCatalogExtraction {
  const allowed = new Set(packets.map((p) => p.packetId))
  try {
    const normalized = raw.trim().startsWith('```') ? raw.trim().split('\n').slice(1, -1).join('\n').trim() : raw.trim()
    const parsed = JSON.parse(normalized) as Partial<SemanticCatalogExtraction>
    const observations = Array.isArray(parsed.observations) ? parsed.observations.flatMap((value) => {
      if (!value || typeof value !== 'object') return []
      const item = value as SemanticCatalogObservation
      const evidence = Array.isArray(item.evidence) ? item.evidence.filter((e) => allowed.has(e.packetId)) : []
      if (!item.surfaceForm || !item.dimension?.label || evidence.length === 0 || !CATALOG_STATUSES.has(item.epistemicStatus)) return []
      if (!['NORMATIVE_IDENTITY', 'CONCEPT_ONLY', 'UNRESOLVED'].includes(item.promotionDecision)) return []
      if (typeof item.semanticRole !== 'string' || typeof item.territorialRelation?.kind !== 'string' || typeof item.identityAssessment?.isTerritorialIdentity !== 'boolean' || !['direct', 'indirect', 'none', 'uncertain'].includes(item.identityAssessment?.characterization) || !['demonstrated', 'not_demonstrated', 'uncertain'].includes(item.identityAssessment?.normativeAxis) || typeof item.identityAssessment?.basis !== 'string') return []
      return [{ ...item, aliases: Array.isArray(item.aliases) ? item.aliases : [], relatedObservations: Array.isArray(item.relatedObservations) ? item.relatedObservations : [], evidence }]
    }) : []
    return { observations, warnings: Array.isArray(parsed.warnings) ? parsed.warnings : [] }
  } catch {
    return { observations: [], warnings: ['Semantic model returned invalid JSON'] }
  }
}

export function validateSemanticResponse(raw: string, packets: SemanticEvidencePacket[]): { valid: true } | { valid: false; errors: SemanticValidationFailure[] } {
  try {
    const normalized = raw.trim().startsWith('```') ? raw.trim().split('\n').slice(1, -1).join('\n').trim() : raw.trim()
    const parsed = JSON.parse(normalized) as Partial<SemanticCatalogExtraction>
    const errors: SemanticValidationFailure[] = []
    if (!Array.isArray(parsed.observations)) errors.push(validationFailure('$.observations', 'Observations must be an array', parsed.observations, 'array'))
    if (!Array.isArray(parsed.warnings)) errors.push(validationFailure('$.warnings', 'Warnings must be an array', parsed.warnings, 'array'))
    if (errors.length) return { valid: false, errors }
    const parsedObservations = parsed.observations as SemanticCatalogObservation[]
    const packetIds = new Set(packets.map((packet) => packet.packetId))
    parsedObservations.forEach((value, index) => {
      if (!value || typeof value !== 'object') { errors.push(validationFailure(`$.observations[${index}]`, 'Observation must be an object', value, 'object')); return }
      const item = value as SemanticCatalogObservation
      if (typeof item.observationId !== 'string') errors.push(validationFailure(`$.observations[${index}].observationId`, 'Observation id must be a string', item.observationId, 'string'))
      if (typeof item.surfaceForm !== 'string') errors.push(validationFailure(`$.observations[${index}].surfaceForm`, 'Surface form must be a string', item.surfaceForm, 'string'))
      if (typeof item.dimension?.label !== 'string') errors.push(validationFailure(`$.observations[${index}].dimension.label`, 'Dimension label must be a string', item.dimension?.label, 'string'))
      if (typeof item.role !== 'string') errors.push(validationFailure(`$.observations[${index}].role`, 'Role must be a string', item.role, 'string'))
      if (!Array.isArray(item.aliases)) errors.push(validationFailure(`$.observations[${index}].aliases`, 'Aliases must be an array', item.aliases, 'array'))
      if (!Array.isArray(item.relatedObservations)) errors.push(validationFailure(`$.observations[${index}].relatedObservations`, 'Related observations must be an array', item.relatedObservations, 'array'))
      if (!Array.isArray(item.evidence) || item.evidence.length === 0) errors.push(validationFailure(`$.observations[${index}].evidence`, 'Evidence must be a non-empty array', item.evidence, 'non-empty array'))
      item.evidence?.forEach((e, evidenceIndex) => {
        if (typeof e?.packetId !== 'string') errors.push(validationFailure(`$.observations[${index}].evidence[${evidenceIndex}].packetId`, 'Evidence packetId must be a string', e?.packetId, 'string'))
        else if (!packetIds.has(e.packetId)) errors.push(validationFailure(`$.observations[${index}].evidence[${evidenceIndex}].packetId`, 'Evidence packetId is not one of the supplied packets', e.packetId, `exactly one of: ${[...packetIds].join(', ')}`))
        if (typeof e?.relation !== 'string') errors.push(validationFailure(`$.observations[${index}].evidence[${evidenceIndex}].relation`, 'Evidence relation must be a string', e?.relation, 'string'))
      })
      if (typeof item.confidence !== 'string') errors.push(validationFailure(`$.observations[${index}].confidence`, 'Confidence must be a string', item.confidence, 'string'))
      if (typeof item.semanticRole !== 'string') errors.push(validationFailure(`$.observations[${index}].semanticRole`, 'Semantic role must be a string', item.semanticRole, 'string'))
      if (typeof item.territorialRelation?.kind !== 'string') errors.push(validationFailure(`$.observations[${index}].territorialRelation.kind`, 'Territorial relation kind must be a string', item.territorialRelation?.kind, 'string'))
      if (!Object.prototype.hasOwnProperty.call(item.territorialRelation ?? {}, 'scope') || (typeof item.territorialRelation?.scope !== 'string' && item.territorialRelation?.scope !== null)) errors.push(validationFailure(`$.observations[${index}].territorialRelation.scope`, 'Territorial relation scope must be present and be a string or null', item.territorialRelation?.scope, 'string or null'))
      if (typeof item.identityAssessment?.isTerritorialIdentity !== 'boolean') errors.push(validationFailure(`$.observations[${index}].identityAssessment.isTerritorialIdentity`, 'Identity assessment flag must be boolean', item.identityAssessment?.isTerritorialIdentity, 'boolean'))
      if (!['direct', 'indirect', 'none', 'uncertain'].includes(item.identityAssessment?.characterization)) errors.push(validationFailure(`$.observations[${index}].identityAssessment.characterization`, 'Identity assessment characterization is invalid', item.identityAssessment?.characterization, 'direct | indirect | none | uncertain'))
      if (!['demonstrated', 'not_demonstrated', 'uncertain'].includes(item.identityAssessment?.normativeAxis)) errors.push(validationFailure(`$.observations[${index}].identityAssessment.normativeAxis`, 'Normative axis assessment is invalid', item.identityAssessment?.normativeAxis, 'demonstrated | not_demonstrated | uncertain'))
      if (typeof item.identityAssessment?.basis !== 'string') errors.push(validationFailure(`$.observations[${index}].identityAssessment.basis`, 'Identity assessment basis must be a string', item.identityAssessment?.basis, 'string'))
      if (!CATALOG_STATUSES.has(item.epistemicStatus)) errors.push(validationFailure(`$.observations[${index}].epistemicStatus`, 'Epistemic status is invalid', item.epistemicStatus, 'known catalog status'))
      if (!['NORMATIVE_IDENTITY', 'CONCEPT_ONLY', 'UNRESOLVED'].includes(item.promotionDecision)) errors.push(validationFailure(`$.observations[${index}].promotionDecision`, 'Promotion decision is invalid', item.promotionDecision, 'NORMATIVE_IDENTITY | CONCEPT_ONLY | UNRESOLVED'))
    })
    return errors.length ? { valid: false, errors } : { valid: true }
  } catch {
    return { valid: false, errors: [validationFailure('$', 'Response is not valid JSON', raw.slice(0, 500), 'valid JSON object')] }
  }
}

function transient(error: unknown) {
  const value = error as { status?: number; code?: string; name?: string; message?: string }
  const status = value?.status
  return status === 408 || status === 409 || status === 429 || (typeof status === 'number' && status >= 500) ||
    ['AbortError', 'ECONNRESET', 'ETIMEDOUT', 'ECONNREFUSED', 'ENETUNREACH'].includes(value?.code ?? value?.name ?? '') ||
    /timeout|timed out|aborted|network|fetch failed|connection reset/i.test(value?.message ?? '')
}

function batchRequest(input: { municipalityCode: string; instrumentId: string; packets: SemanticEvidencePacket[] }, rawContent?: string, validationErrors: SemanticValidationFailure[] = []) {
  const repair = rawContent ? `Repair this model response into the requested JSON schema. Preserve only information present in the response and supplied evidence; do not infer or invent anything. Correct every validation error below exactly. Never delete an observation's evidence or replace it with []; if a provenance error cannot be corrected by a demonstrable match to a supplied packet, leave the response unrepairable rather than inventing provenance.\n\nVALIDATION ERRORS:\n${validationErrors.map((error) => `- path=${error.path}; message=${error.message}; received=${JSON.stringify(error.received)}; expected=${error.expected}`).join('\n')}\n\nFor provenance, every evidence.packetId must be exactly one of these supplied packet IDs: ${input.packets.map((packet) => packet.packetId).join(', ')}. Do not use documentId, do not remove :text:N suffixes, do not invent IDs, and do not turn required evidence into an empty array.\n\nRAW RESPONSE:\n${rawContent}` : prompt(input.packets)
  return {
    systemPrompt: 'You are a conservative planner-document vocabulary extractor. Return only the requested JSON schema.',
    userPrompt: repair,
    responseSchemaName: 'SemanticInstrumentIdentityCatalog',
    responseSchema: semanticCatalogResponseSchema,
  }
}

export async function extractReasonerSemanticCatalogBatch(
  reasoner: ReasonerProvider,
  input: { municipalityCode: string; instrumentId: string; packets: SemanticEvidencePacket[] },
  options: { timeoutMs?: number; maxRetries?: number; operation?: LLMOperationContext } = {},
): Promise<SemanticBatchResult> {
  const timeoutMs = options.timeoutMs ?? 120_000
  const maxRetries = options.maxRetries ?? 1
  let attempt = 0
  let repairAttempted = false
  let totalLatencyMs = 0
  let lastError: unknown
  let inferenceIndex = 0

  const call = async (rawContent?: string, validationErrors: SemanticValidationFailure[] = []) => {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), timeoutMs)
    const started = performance.now()
    try {
      const result = await reasoner.generate({ ...batchRequest(input, rawContent, validationErrors), signal: controller.signal, timeoutMs })
      inferenceIndex += 1
      if (options.operation) recordLLMUsage({ ...options.operation, requestId: options.operation.requestId ?? null, expedienteId: options.operation.expedienteId ?? null, stage: 'semantic-instrument-identity-catalog', inferenceIndex, provider: result.provider, model: result.model, inputTokens: result.inputTokens ?? null, cachedInputTokens: result.cachedInputTokens ?? null, outputTokens: result.outputTokens ?? null, reasoningTokens: result.reasoningTokens ?? null, totalTokens: result.totalTokens ?? null, durationMs: result.latencyMs ?? null, toolCallsRequested: 0, finishReason: null })
      return result
    } finally {
      totalLatencyMs += Math.round(performance.now() - started)
      clearTimeout(timer)
    }
  }

  while (attempt <= maxRetries) {
    try {
      const result = await call()
      const validation = validateSemanticResponse(result.rawContent, input.packets)
      if (validation.valid) return { ...result, extraction: parseResult(result.rawContent, input.packets), latencyMs: totalLatencyMs, structurallyValid: true, repairAttempted, repaired: repairAttempted, attemptCount: attempt + 1, retryCount: attempt }
      if (!repairAttempted && result.rawContent.trim()) {
        repairAttempted = true
        const repaired = await call(result.rawContent, validation.errors)
        const repairedValid = validateSemanticResponse(repaired.rawContent, input.packets)
        if (repairedValid.valid) return { ...repaired, extraction: parseResult(repaired.rawContent, input.packets), rawOriginalContent: result.rawContent, originalValidationErrors: validation.errors, latencyMs: totalLatencyMs, structurallyValid: true, repairAttempted: true, repaired: true, attemptCount: attempt + 1, retryCount: attempt }
        const failure = new Error('Semantic model returned structurally invalid JSON after one repair attempt') as Error & Record<string, unknown>
        failure.rawContent = repaired.rawContent; failure.originalRawContent = result.rawContent; failure.originalValidationErrors = validation.errors; failure.repairValidationErrors = repairedValid.errors; failure.provider = repaired.provider; failure.model = repaired.model; failure.latencyMs = totalLatencyMs; failure.retryCount = attempt; failure.repairAttempted = true
        throw failure
      }
      const failure = new Error('Semantic model returned structurally invalid JSON') as Error & Record<string, unknown>
      failure.rawContent = result.rawContent; failure.repairValidationErrors = validation.errors
      throw failure
    } catch (error) {
      lastError = error
      const isTransient = transient(error)
      if (!isTransient || attempt >= maxRetries) {
        const value = error as { name?: string; code?: string; message?: string }
        const lastErrorMessage = error instanceof Error ? error.message : String(error)
        const isTimeoutOrAbort = value?.name === 'AbortError' || value?.code === 'ETIMEDOUT' || /timeout|timed out|aborted/i.test(lastErrorMessage)
        const failure = error instanceof Error ? error : new Error(lastErrorMessage)
        Object.assign(failure, { attemptCount: attempt + 1, retryCount: attempt, durationMs: totalLatencyMs, lastError: lastErrorMessage, errorCause: lastErrorMessage, isTimeoutOrAbort, isTransient })
        throw failure
      }
      attempt += 1
    }
  }
  throw lastError instanceof Error ? lastError : new Error('Semantic batch failed')
}

export function createReasonerSemanticCatalogModel(reasoner: ReasonerProvider, operation?: LLMOperationContext): SemanticCatalogModel {
  let inferenceIndex = 0
  return {
    async extract(input) {
      const result = await reasoner.generate({ ...batchRequest(input), timeoutMs: 30000 })
      inferenceIndex += 1
      if (operation) recordLLMUsage({ ...operation, requestId: operation.requestId ?? null, expedienteId: operation.expedienteId ?? null, stage: 'semantic-instrument-identity-catalog', inferenceIndex, provider: result.provider, model: result.model, inputTokens: result.inputTokens ?? null, cachedInputTokens: result.cachedInputTokens ?? null, outputTokens: result.outputTokens ?? null, reasoningTokens: result.reasoningTokens ?? null, totalTokens: result.totalTokens ?? null, durationMs: result.latencyMs ?? null, toolCallsRequested: 0, finishReason: null })
      return parseResult(result.rawContent, input.packets)
    },
  }
}

function canonicalDimension(label: string, normalizedType?: string | null) {
  return ((normalizedType || label).trim().toLowerCase() || label.trim()) as InstrumentIdentity['semanticDimension']
}

function stablePart(value: string) { return value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toUpperCase().replace(/[^A-Z0-9]+/g, '_').replace(/^_|_$/g, '') || 'UNKNOWN' }

function looseToken(value: string | null | undefined) {
  return value?.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toUpperCase().replace(/[^A-Z0-9]/g, '') ?? ''
}

function observationTokens(observation: SemanticCatalogObservation) {
  return [observation.code, observation.name, observation.surfaceForm, ...observation.aliases].map(looseToken).filter(Boolean)
}

function evidenceDocuments(observation: SemanticCatalogObservation) {
  return new Set(observation.evidence.map((item) => item.packetId.split(':text:')[0]))
}

function scopeTokens(observation: SemanticCatalogObservation) {
  return new Set((observation.territorialRelation.scope ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toUpperCase().split(/[^A-Z0-9]+/).filter((token) => token.length > 2))
}

function sameIdentityEvidence(a: SemanticCatalogObservation, b: SemanticCatalogObservation) {
  if (a.evidence.some((item) => item.relation === 'contradicts') || b.evidence.some((item) => item.relation === 'contradicts')) return false
  const aCode = looseToken(a.code); const bCode = looseToken(b.code)
  const aName = looseToken(a.name ?? a.surfaceForm); const bName = looseToken(b.name ?? b.surfaceForm)
  const nominallySame = (aCode && bCode && aCode === bCode) || (aName && bName && aName === bName) ||
    (aCode && bName && aCode === bName) || (bCode && aName && bCode === aName) ||
    observationTokens(a).some((token) => observationTokens(b).includes(token))
  if (!nominallySame) return false
  const sharedDocument = [...evidenceDocuments(a)].some((document) => evidenceDocuments(b).has(document))
  const sharedScope = [...scopeTokens(a)].some((token) => scopeTokens(b).has(token))
  const compatibleRelation = a.territorialRelation.kind === b.territorialRelation.kind ||
    ['identifies', 'designates', 'defines', 'maps_to'].includes(a.territorialRelation.kind) && ['identifies', 'designates', 'defines', 'maps_to'].includes(b.territorialRelation.kind)
  // Nominal equality is necessary but not sufficient: require independent documentary
  // or territorial corroboration as well.
  return compatibleRelation && (sharedDocument || sharedScope)
}

function relatedIdentityEvidence(a: SemanticCatalogObservation, b: SemanticCatalogObservation) {
  const aTokens = new Set(observationTokens(a)); const bTokens = new Set(observationTokens(b))
  const sharedToken = [...aTokens].some((token) => bTokens.has(token))
  const sharedScope = [...scopeTokens(a)].some((token) => scopeTokens(b).has(token))
  return sharedToken && (sharedScope || (looseToken(a.code) && looseToken(a.code) === looseToken(b.code))) && !sameIdentityEvidence(a, b)
}

function consolidateObservations(observations: SemanticCatalogObservation[]) {
  const groups: SemanticCatalogObservation[][] = []
  for (const observation of observations) {
    const group = groups.find((candidate) => candidate.some((item) => sameIdentityEvidence(item, observation)))
    if (group) group.push(observation); else groups.push([observation])
  }
  return groups.map((group) => {
    const representative = group[0]
    const aliases = [...new Set(group.flatMap((item) => item.aliases).filter((alias) => alias.trim() !== representative.code?.trim() && alias.trim() !== representative.name?.trim()))]
    const evidence = group.flatMap((item) => item.evidence)
    const statuses: SemanticCatalogObservation['epistemicStatus'][] = group.map((item) => item.epistemicStatus)
    const epistemicStatus: CatalogIdentityStatus = statuses.includes('AMBIGUOUS') ? 'AMBIGUOUS' : statuses.includes('REVIEW_REQUIRED') ? 'REVIEW_REQUIRED' : statuses.includes('OBSERVED_NOT_ACREDITED') ? 'OBSERVED_NOT_ACREDITED' : statuses.includes('REJECTED') ? 'REJECTED' : 'ACCEPTED'
    const promotionDecision: SemanticPromotionDecision = group.every((item) => item.promotionDecision === 'NORMATIVE_IDENTITY') ? 'NORMATIVE_IDENTITY' : group.some((item) => item.promotionDecision === 'UNRESOLVED') ? 'UNRESOLVED' : 'CONCEPT_ONLY'
    return { ...representative, aliases, evidence, epistemicStatus, promotionDecision, relatedObservations: [...new Set(group.flatMap((item) => item.relatedObservations))], sourceObservationIds: group.map((item) => item.observationId) }
  })
}

/**
 * Final publication gate. The model's promotionDecision remains a proposal;
 * publication also requires an explicit territorial scope and documentary
 * evidence that defines or maps the finding as the territorial subject.
 * Semantic roles and dimensions remain open rather than being enumerated here.
 */
export function isFinalNormativeIdentityCandidate(observation: SemanticCatalogObservation): boolean {
  const scope = observation.territorialRelation?.scope
  const hasTerritorialScope = typeof scope === 'string' && scope.trim().length > 0
  const hasIdentityEvidence = observation.evidence.some((item) => item.relation === 'defines' || item.relation === 'maps_to')
  return observation.promotionDecision === 'NORMATIVE_IDENTITY' &&
    observation.epistemicStatus === 'ACCEPTED' &&
    observation.identityAssessment?.isTerritorialIdentity === true &&
    observation.identityAssessment.characterization === 'direct' &&
    observation.identityAssessment.normativeAxis === 'demonstrated' &&
    hasTerritorialScope &&
    hasIdentityEvidence &&
    !observation.evidence.some((item) => item.relation === 'contradicts')
}

export function buildInstrumentIdentityCatalog(input: { municipalityCode: string; instrumentId: string; generatedAt: string; sourceManifest: InstrumentIdentityCatalog['sourceManifest']; packets?: SemanticEvidencePacket[]; modelOutput: SemanticCatalogExtraction }): InstrumentIdentityCatalog {
  const identities = new Map<string, InstrumentIdentity>()
  const packetById = new Map<string, SemanticEvidencePacket>()
  // The extraction output carries packet ids only; resolve them back to the
  // official document before persisting provenance and normative references.
  for (const packet of input.packets ?? []) packetById.set(packet.packetId, packet)
  const candidates = input.modelOutput.observations.filter(isFinalNormativeIdentityCandidate)
  const consolidated = consolidateObservations(candidates)
  const candidateRelations = new Map<string, Array<{ observationId: string; relation: 'RELATED' | 'AMBIGUOUS_EQUIVALENCE' }>>()
  for (let i = 0; i < candidates.length; i += 1) for (let j = i + 1; j < candidates.length; j += 1) {
    const a = candidates[i]; const b = candidates[j]
    if (sameIdentityEvidence(a, b)) continue
    if (relatedIdentityEvidence(a, b)) {
      const relation = observationTokens(a).includes(looseToken(b.code)) || observationTokens(b).includes(looseToken(a.code)) ? 'AMBIGUOUS_EQUIVALENCE' : 'RELATED'
      candidateRelations.set(a.observationId, [...(candidateRelations.get(a.observationId) ?? []), { observationId: b.observationId, relation }])
      candidateRelations.set(b.observationId, [...(candidateRelations.get(b.observationId) ?? []), { observationId: a.observationId, relation }])
    }
  }
  const observationToIdentity = new Map<string, string>()
  for (const observation of consolidated) {
    const dimension = canonicalDimension(observation.dimension.label, observation.dimension.normalizedType)
    const code = observation.code?.trim() || observation.surfaceForm.trim()
    const name = observation.name?.trim() || observation.surfaceForm.trim()
    const baseId = `${input.instrumentId}:${dimension}:${stablePart(code)}`
    const evidence: CatalogIdentityEvidence[] = observation.evidence.map((item) => { const packet = packetById.get(item.packetId); return { sourceId: packet?.officialUrl ?? item.packetId, sourceType: packet?.kind ?? 'semantic-extraction', officialDocumentId: packet?.documentId ?? item.packetId, documentId: packet?.documentId, chunkIds: packet?.chunkIds, officialUrl: packet?.officialUrl, locator: packet?.page ? `page:${packet.page}` : item.packetId, quote: item.quote ?? undefined, relation: item.relation, confidence: observation.confidence } })
    const normativeReferences: CatalogNormativeReference[] = observation.evidence.filter((item) => item.relation === 'defines' || item.relation === 'regulates').map((item) => { const packet = packetById.get(item.packetId); return { documentId: packet?.documentId ?? item.packetId, chunkIds: packet?.chunkIds ?? [], relation: item.relation === 'regulates' ? 'regulates' : 'defines', sourceId: packet?.officialUrl ?? item.packetId } })
    const sourceObservationIds = (observation as SemanticCatalogObservation & { sourceObservationIds?: string[] }).sourceObservationIds ?? [observation.observationId]
    const existingBase = identities.get(baseId)
    const sameSource = existingBase?.sourceObservationIds?.some((sourceId) => sourceObservationIds.includes(sourceId))
    const id = existingBase && !sameSource ? `${baseId}:${stablePart(observation.territorialRelation.scope ?? observation.dimension.label)}` : baseId
    const next: InstrumentIdentity = { id, municipalityCode: input.municipalityCode, instrumentId: input.instrumentId, semanticDimension: dimension, dimensionLabel: observation.dimension.label, officialCode: code, officialName: name, aliases: observation.aliases, status: observation.epistemicStatus, evidence, normativeReferences, promotionDecision: 'NORMATIVE_IDENTITY', sourceObservationIds }
    for (const observationId of sourceObservationIds) observationToIdentity.set(observationId, id)
    const existing = identities.get(id)
    if (!existing) identities.set(id, next)
    else { existing.aliases = [...new Set([...(existing.aliases ?? []), ...(next.aliases ?? [])])]; existing.evidence.push(...next.evidence); existing.normativeReferences.push(...next.normativeReferences); existing.sourceObservationIds = [...new Set([...(existing.sourceObservationIds ?? []), ...(next.sourceObservationIds ?? [])])]; if (existing.status === 'ACCEPTED' && next.status !== 'ACCEPTED') existing.status = next.status }
  }
  for (const [observationId, relations] of candidateRelations) {
    const identity = identities.get(observationToIdentity.get(observationId) ?? '')
    if (!identity) continue
    const current = identity.identityRelations ?? []
    identity.identityRelations = [...current, ...relations.flatMap((relation) => { const identityId = observationToIdentity.get(relation.observationId); return identityId && identityId !== identity.id ? [{ identityId, relation: relation.relation }] : [] })]
      .filter((relation, index, all) => all.findIndex((item) => item.identityId === relation.identityId && item.relation === relation.relation) === index)
  }
  return { schemaVersion: 'instrument-identity-catalog.v2', generatedAt: input.generatedAt, municipalityCode: input.municipalityCode, instrumentId: input.instrumentId, sourceKind: 'SIOTUGA_OFFICIAL_DOCUMENTS_SEMANTIC', sourceManifest: input.sourceManifest, semanticObservations: input.modelOutput.observations, identities: [...identities.values()].sort((a, b) => a.id.localeCompare(b.id)) }
}
