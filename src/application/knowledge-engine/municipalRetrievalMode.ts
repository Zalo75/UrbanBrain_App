export type MunicipalRetrievalMode = 'v1' | 'v2'

export interface MunicipalRetrievalPilotConfig {
  enabled: boolean
  allowedMunicipalityCodes: readonly string[]
  /** Explicit opt-in for current official documents pending legal review. */
  provisionalEnabled?: boolean
}

export interface MunicipalRetrievalScopeInput {
  municipalityCode?: string | null
  instrumentId?: string | null
  parentInstrumentId?: string | null
  scopeValid: boolean
  corpusAvailable: boolean
}

export interface V2CandidateScope {
  municipalityCode?: string | null
  instrumentId?: string | null
  parentInstrumentId?: string | null
  allowProvisional?: boolean
}

export interface V2ScopedCandidate {
  municipalityCode?: string | null
  instrumentId?: string | null
  parentInstrumentId?: string | null
  officialDocumentId?: string | null
  officialUrl?: string | null
  status?: string | null
  currentVersion?: boolean | null
  legalReviewStatus?: string | null
  /** Consolidation is a higher evidence level, not a prerequisite for an
   * individually reviewed current official document. */
  isConsolidated?: boolean | null
  metadata?: Record<string, unknown> | null
}

function text(value: unknown) {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined
}

export function selectMunicipalRetrievalMode(
  input: MunicipalRetrievalScopeInput,
  config: MunicipalRetrievalPilotConfig,
): MunicipalRetrievalMode {
  const municipalityCode = text(input.municipalityCode)
  if (
    !config.enabled ||
    !municipalityCode ||
    !config.allowedMunicipalityCodes.includes(municipalityCode) ||
    !text(input.instrumentId) ||
    !input.scopeValid ||
    !input.corpusAvailable
  ) {
    return 'v1'
  }
  return 'v2'
}

export function assertV2EmbeddingDimension(vector: unknown): asserts vector is number[] {
  if (!Array.isArray(vector) || vector.length !== 768 || vector.some((value) => typeof value !== 'number' || !Number.isFinite(value))) {
    throw new Error(`V2 embeddings must contain exactly 768 finite numbers (received ${Array.isArray(vector) ? vector.length : 'invalid'})`)
  }
}

function identity(candidateValue: unknown, metadata: Record<string, unknown> | null | undefined, key: string) {
  return text(candidateValue) ?? text(metadata?.[key])
}

export function isV2CandidateInScope(
  candidate: V2ScopedCandidate,
  scope: V2CandidateScope,
): boolean {
  const municipalityCode = text(scope.municipalityCode)
  const instrumentId = text(scope.instrumentId)
  if (!municipalityCode || !instrumentId) return false

  const candidateMunicipality = identity(candidate.municipalityCode, candidate.metadata, 'municipalityCode')
  const candidateInstrument = identity(candidate.instrumentId, candidate.metadata, 'instrumentId')
  const candidateParent = identity(candidate.parentInstrumentId, candidate.metadata, 'parentInstrumentId') ?? null
  const expectedParent = text(scope.parentInstrumentId) ?? null

  if (candidateMunicipality !== municipalityCode || candidateInstrument !== instrumentId) return false
  const metadataMunicipality = text(candidate.metadata?.municipalityCode)
  if (metadataMunicipality && metadataMunicipality !== municipalityCode) return false
  if (candidateParent !== expectedParent) return false
  if (!text(candidate.officialDocumentId) || !text(candidate.officialUrl)) return false
  const reviewAllowed = candidate.legalReviewStatus === 'reviewed' ||
    (scope.allowProvisional === true && candidate.legalReviewStatus === 'pending')
  if (candidate.status !== 'vigente' || candidate.currentVersion !== true || !reviewAllowed) return false

  const metadataInstrument = text(candidate.metadata?.instrumentId)
  if (metadataInstrument && metadataInstrument !== instrumentId) return false
  if (candidate.metadata && Object.prototype.hasOwnProperty.call(candidate.metadata, 'parentInstrumentId')) {
    const metadataParent = text(candidate.metadata.parentInstrumentId) ?? null
    if (metadataParent !== expectedParent) return false
  }
  return true
}

export function v2PilotConfigFromEnv(env: NodeJS.ProcessEnv = process.env): MunicipalRetrievalPilotConfig {
  const allowedMunicipalityCodes = (env.URBANBRAIN_V2_MUNICIPAL_PILOT_CODES ?? '')
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean)
  return {
    enabled: env.URBANBRAIN_V2_MUNICIPAL_RETRIEVAL_ENABLED === 'true',
    allowedMunicipalityCodes,
    provisionalEnabled: env.URBANBRAIN_V2_MUNICIPAL_PROVISIONAL_ENABLED === 'true',
  }
}
