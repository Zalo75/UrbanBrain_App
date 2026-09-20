import { createHash } from 'node:crypto'

export type TerritorialSemanticStatus =
  | 'accepted'
  | 'review_required'
  | 'unknown'
  | 'conflict'
  | 'abstained'

export interface TerritorialSemanticEvidencePacket {
  packetId: string
  source: string
  sourceUrl: string
  instrumentId?: string
  candidateIds?: string[]
  sourceFeatureIds?: string[]
  kind: 'wfs_attributes' | 'document' | 'legend' | 'metadata' | 'table' | 'map'
  text?: string
}

export interface TerritorialSemanticCandidateInput {
  candidateId: string
  instrumentId?: string
  sourceFeatureIds: string[]
  literals: {
    homogeneousClassification?: string
    homogeneousCategory?: string
    legalClassification?: string
    legalCategory?: string
    planningCategory?: string
    use?: string
    denomination?: string
  }
  coverage: {
    parcelAreaSquareMetres: number
    intersectionAreaSquareMetres: number
    parcelPercentage: number
    geometryPresent: boolean
  }
}

export interface TerritorialSemanticCatalogIdentity {
  identityId: string
  instrumentId: string
  officialCode: string
  officialName: string
  semanticDimension: string
  catalogStatus: 'ACCEPTED' | 'REVIEW_REQUIRED' | 'REJECTED'
}

export interface TerritorialSemanticEvidenceInput {
  municipalityCode: string
  instrumentId?: string
  candidates: TerritorialSemanticCandidateInput[]
  evidencePackets: TerritorialSemanticEvidencePacket[]
  catalogIdentities: TerritorialSemanticCatalogIdentity[]
  existingContradictions: string[]
}

export interface TerritorialSemanticResolutionObservation {
  candidateId: string
  sourceFeatureIds: string[]
  literals: TerritorialSemanticCandidateInput['literals']
  operationalClassification?: {
    value: string
    confidence: 'high' | 'medium' | 'low'
    status: Exclude<TerritorialSemanticStatus, 'conflict' | 'abstained'>
  }
  planningArea?: {
    value: string
    confidence: 'high' | 'medium' | 'low'
    status: Exclude<TerritorialSemanticStatus, 'conflict' | 'abstained'>
  }
  normativeIdentity?: {
    identityId: string
    identity: string
    status: 'accepted'
  }
  evidenceRefs: string[]
  contradictions: string[]
}

export interface TerritorialSemanticResolutionV1 {
  schemaVersion: 1
  inputFingerprint: string
  status: TerritorialSemanticStatus
  observations: TerritorialSemanticResolutionObservation[]
  canonical: {
    classification?: string
    planningArea?: string
    normativeIdentityId?: string
  }
  evidenceRefs: string[]
  contradictions: string[]
  abstentionReason?: string
  provenance: {
    source: 'official_evidence' | 'manual_confirmation' | 'legacy_reconciliation'
    provider?: string
    model?: string
    generatedAt?: string
  }
}

export interface SemanticValidationError {
  path: string
  code:
    | 'malformed'
    | 'unknown_field'
    | 'invalid_value'
    | 'unknown_candidate'
    | 'unknown_feature'
    | 'unknown_evidence'
    | 'evidence_mismatch'
    | 'unknown_identity'
    | 'identity_not_accepted'
    | 'identity_instrument_mismatch'
    | 'invented_literal'
    | 'coverage_mutation'
    | 'contradiction_status'
  message: string
}

export interface SemanticValidationResult {
  valid: boolean
  errors: SemanticValidationError[]
  value?: TerritorialSemanticResolutionV1
}

const strictSemanticValueSchema = {
  type: 'object' as const,
  additionalProperties: false,
  required: ['value', 'confidence', 'status'],
  properties: {
    value: { type: 'string' as const, minLength: 1 },
    confidence: { type: 'string' as const, enum: ['high', 'medium', 'low'] as const },
    status: { type: 'string' as const, enum: ['accepted', 'review_required', 'unknown'] as const },
  },
}

const strictLiteralsSchema = {
  type: 'object' as const,
  additionalProperties: false,
  required: ['homogeneousClassification', 'homogeneousCategory', 'legalClassification', 'legalCategory', 'planningCategory', 'use', 'denomination'],
  properties: {
    homogeneousClassification: { anyOf: [{ type: 'string' as const }, { type: 'null' as const }] },
    homogeneousCategory: { anyOf: [{ type: 'string' as const }, { type: 'null' as const }] },
    legalClassification: { anyOf: [{ type: 'string' as const }, { type: 'null' as const }] },
    legalCategory: { anyOf: [{ type: 'string' as const }, { type: 'null' as const }] },
    planningCategory: { anyOf: [{ type: 'string' as const }, { type: 'null' as const }] },
    use: { anyOf: [{ type: 'string' as const }, { type: 'null' as const }] },
    denomination: { anyOf: [{ type: 'string' as const }, { type: 'null' as const }] },
  },
}

export const territorialSemanticResolutionJsonSchema = {
  type: 'object',
  additionalProperties: false,
  // DeepSeek/OpenAI strict structured outputs require every declared property
  // to be required. Optional TypeScript fields are represented as explicit
  // nulls and are removed structurally by the validator before use.
  required: ['schemaVersion', 'inputFingerprint', 'status', 'observations', 'canonical', 'evidenceRefs', 'contradictions', 'abstentionReason', 'provenance'],
  properties: {
    schemaVersion: { type: 'integer', const: 1 },
    inputFingerprint: { type: 'string', minLength: 1 },
    status: { type: 'string', enum: ['accepted', 'review_required', 'unknown', 'conflict', 'abstained'] },
    observations: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
          required: ['candidateId', 'sourceFeatureIds', 'literals', 'operationalClassification', 'planningArea', 'normativeIdentity', 'evidenceRefs', 'contradictions'],
        properties: {
          candidateId: { type: 'string', minLength: 1 },
          sourceFeatureIds: { type: 'array', items: { type: 'string' } },
          literals: strictLiteralsSchema,
          operationalClassification: { anyOf: [strictSemanticValueSchema, { type: 'null' as const }] },
          planningArea: { anyOf: [strictSemanticValueSchema, { type: 'null' as const }] },
          normativeIdentity: {
            anyOf: [{ type: 'object', additionalProperties: false,
            required: ['identityId', 'identity', 'status'],
            properties: {
              identityId: { type: 'string', minLength: 1 },
              identity: { type: 'string', minLength: 1 },
              status: { type: 'string', const: 'accepted' },
            } }, { type: 'null' }],
          },
          evidenceRefs: { type: 'array', items: { type: 'string', minLength: 1 } },
          contradictions: { type: 'array', items: { type: 'string' } },
        },
      },
    },
    canonical: {
      type: 'object', additionalProperties: false,
      required: ['classification', 'planningArea', 'normativeIdentityId'],
      properties: {
        classification: { anyOf: [{ type: 'string', minLength: 1 }, { type: 'null' }] },
        planningArea: { anyOf: [{ type: 'string', minLength: 1 }, { type: 'null' }] },
        normativeIdentityId: { anyOf: [{ type: 'string', minLength: 1 }, { type: 'null' }] },
      },
    },
    evidenceRefs: { type: 'array', items: { type: 'string', minLength: 1 } },
    contradictions: { type: 'array', items: { type: 'string' } },
    abstentionReason: { anyOf: [{ type: 'string', minLength: 1 }, { type: 'null' }] },
    provenance: {
      type: 'object', additionalProperties: false,
      required: ['source', 'provider', 'model', 'generatedAt'],
      properties: {
        source: { type: 'string', enum: ['official_evidence', 'manual_confirmation', 'legacy_reconciliation'] },
        provider: { anyOf: [{ type: 'string' }, { type: 'null' }] },
        model: { anyOf: [{ type: 'string' }, { type: 'null' }] },
        generatedAt: { anyOf: [{ type: 'string' }, { type: 'null' }] },
      },
    },
  },
} as const

function stableValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stableValue)
  if (!value || typeof value !== 'object') return value
  return Object.fromEntries(Object.entries(value as Record<string, unknown>)
    .sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0)
    .map(([key, item]) => [key, stableValue(item)]))
}

export function buildTerritorialSemanticInputFingerprint(input: TerritorialSemanticEvidenceInput) {
  const canonical = stableValue({
    municipalityCode: input.municipalityCode,
    instrumentId: input.instrumentId,
    candidates: input.candidates,
    evidencePackets: input.evidencePackets,
    catalogIdentities: input.catalogIdentities,
    existingContradictions: input.existingContradictions,
  })
  return createHash('sha256').update(JSON.stringify(canonical)).digest('hex')
}

function error(code: SemanticValidationError['code'], path: string, message: string): SemanticValidationError {
  return { code, path, message }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value))
}

const strictNullableKeys = new Set([
  'classification', 'planningArea', 'normativeIdentityId', 'abstentionReason',
  'provider', 'model', 'generatedAt', 'operationalClassification',
  'normativeIdentity', 'homogeneousClassification', 'homogeneousCategory',
  'legalClassification', 'legalCategory', 'planningCategory', 'use', 'denomination',
])

/** Converts strict-output nulls back to the optional TypeScript representation
 * without hiding unknown fields or accepting null in required fields. */
function removeStrictOptionalNulls(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(removeStrictOptionalNulls)
  if (!isRecord(value)) return value
  return Object.fromEntries(Object.entries(value)
    .filter(([key, item]) => !(strictNullableKeys.has(key) && item === null))
    .map(([key, item]) => [key, removeStrictOptionalNulls(item)]))
}

function ownKeysOnly(value: Record<string, unknown>, allowed: string[], path: string, errors: SemanticValidationError[]) {
  for (const key of Object.keys(value)) {
    if (!allowed.includes(key)) errors.push(error('unknown_field', `${path}.${key}`, 'Campo no permitido por el contrato canónico.'))
  }
}

function hasForbiddenCoverage(value: unknown): boolean {
  if (Array.isArray(value)) return value.some(hasForbiddenCoverage)
  if (!isRecord(value)) return false
  if (['coverage', 'intersectionGeometry', 'parcelAreaSquareMetres', 'intersectionAreaSquareMetres', 'parcelPercentage', 'geometry'].some((key) => key in value)) return true
  return Object.values(value).some(hasForbiddenCoverage)
}

function parseShape(value: unknown): { value?: TerritorialSemanticResolutionV1; errors: SemanticValidationError[] } {
  const errors: SemanticValidationError[] = []
  if (!isRecord(value)) return { errors: [error('malformed', '$', 'La salida no es un objeto JSON.')] }
  ownKeysOnly(value, ['schemaVersion', 'inputFingerprint', 'status', 'observations', 'canonical', 'evidenceRefs', 'contradictions', 'abstentionReason', 'provenance'], '$', errors)
  if (value.schemaVersion !== 1) errors.push(error('invalid_value', '$.schemaVersion', 'schemaVersion debe ser 1.'))
  if (typeof value.inputFingerprint !== 'string' || !value.inputFingerprint) errors.push(error('malformed', '$.inputFingerprint', 'Falta inputFingerprint.'))
  if (!['accepted', 'review_required', 'unknown', 'conflict', 'abstained'].includes(value.status as string)) errors.push(error('invalid_value', '$.status', 'Estado semántico inválido.'))
  if (!Array.isArray(value.observations)) errors.push(error('malformed', '$.observations', 'observations debe ser un array.'))
  if (!isRecord(value.canonical)) errors.push(error('malformed', '$.canonical', 'canonical debe ser un objeto.'))
  else {
    ownKeysOnly(value.canonical, ['classification', 'planningArea', 'normativeIdentityId'], '$.canonical', errors)
    for (const key of ['classification', 'planningArea', 'normativeIdentityId']) {
      if (value.canonical[key] !== undefined && (typeof value.canonical[key] !== 'string' || !value.canonical[key])) errors.push(error('malformed', `$.canonical.${key}`, 'El valor canónico debe ser un string no vacío.'))
    }
  }
  if (!Array.isArray(value.evidenceRefs) || !value.evidenceRefs.every((item) => typeof item === 'string')) errors.push(error('malformed', '$.evidenceRefs', 'evidenceRefs debe ser un array de strings.'))
  if (!Array.isArray(value.contradictions) || !value.contradictions.every((item) => typeof item === 'string')) errors.push(error('malformed', '$.contradictions', 'contradictions debe ser un array de strings.'))
  if (!isRecord(value.provenance)) errors.push(error('malformed', '$.provenance', 'Falta provenance.'))
  else {
    ownKeysOnly(value.provenance, ['source', 'provider', 'model', 'generatedAt'], '$.provenance', errors)
    if (!['official_evidence', 'manual_confirmation', 'legacy_reconciliation'].includes(value.provenance.source as string)) errors.push(error('invalid_value', '$.provenance.source', 'Origen de provenance inválido.'))
    for (const key of ['provider', 'model', 'generatedAt']) if (value.provenance[key] !== undefined && typeof value.provenance[key] !== 'string') errors.push(error('malformed', `$.provenance.${key}`, 'El campo debe ser string.'))
  }
  if (Array.isArray(value.observations)) {
    for (const [index, observation] of value.observations.entries()) {
      const path = `$.observations[${index}]`
      if (!isRecord(observation)) { errors.push(error('malformed', path, 'La observación debe ser un objeto.')); continue }
      ownKeysOnly(observation, ['candidateId', 'sourceFeatureIds', 'literals', 'operationalClassification', 'planningArea', 'normativeIdentity', 'evidenceRefs', 'contradictions'], path, errors)
      if (typeof observation.candidateId !== 'string' || !observation.candidateId) errors.push(error('malformed', `${path}.candidateId`, 'Falta candidateId.'))
      if (!Array.isArray(observation.sourceFeatureIds) || !observation.sourceFeatureIds.every((item) => typeof item === 'string')) errors.push(error('malformed', `${path}.sourceFeatureIds`, 'sourceFeatureIds debe ser un array de strings.'))
      if (!isRecord(observation.literals)) errors.push(error('malformed', `${path}.literals`, 'Falta literals.'))
      if (!Array.isArray(observation.evidenceRefs) || !observation.evidenceRefs.every((item) => typeof item === 'string')) errors.push(error('malformed', `${path}.evidenceRefs`, 'evidenceRefs debe ser un array de strings.'))
      if (!Array.isArray(observation.contradictions) || !observation.contradictions.every((item) => typeof item === 'string')) errors.push(error('malformed', `${path}.contradictions`, 'contradictions debe ser un array de strings.'))
      for (const key of ['operationalClassification', 'planningArea']) {
        const semantic = observation[key]
        if (semantic !== undefined && (!isRecord(semantic) || typeof semantic.value !== 'string' || !semantic.value || ['unknown', 'review_required', 'conflict', 'abstained'].includes(semantic.value) || !['high', 'medium', 'low'].includes(semantic.confidence as string) || !['accepted', 'review_required', 'unknown'].includes(semantic.status as string))) errors.push(error('malformed', `${path}.${key}`, 'Valor semántico inválido: el valor debe ser una conclusión, no una etiqueta de estado.'))
      }
      if (observation.normativeIdentity !== undefined) {
        const identity = observation.normativeIdentity
        if (!isRecord(identity) || typeof identity.identityId !== 'string' || !identity.identityId || typeof identity.identity !== 'string' || !identity.identity || identity.status !== 'accepted') errors.push(error('malformed', `${path}.normativeIdentity`, 'Identidad normativa inválida.'))
      }
    }
  }
  if (hasForbiddenCoverage(value)) errors.push(error('coverage_mutation', '$', 'La resolución semántica no puede contener geometría ni superficies.'))
  if (errors.length) return { errors }
  return { value: value as unknown as TerritorialSemanticResolutionV1, errors }
}

export function parseAndValidateTerritorialSemanticResolution(raw: string, input: TerritorialSemanticEvidenceInput): SemanticValidationResult {
  let parsed: unknown
  try { parsed = JSON.parse(raw) } catch { return { valid: false, errors: [error('malformed', '$', 'La respuesta no es JSON válido.')] } }
  return validateTerritorialSemanticResolution(removeStrictOptionalNulls(parsed), input)
}

export function validateTerritorialSemanticResolution(value: unknown, input: TerritorialSemanticEvidenceInput): SemanticValidationResult {
  const shape = parseShape(value)
  if (!shape.value) return { valid: false, errors: shape.errors }
  const resolution = shape.value
  const errors = [...shape.errors]
  const expectedFingerprint = buildTerritorialSemanticInputFingerprint(input)
  if (resolution.inputFingerprint !== expectedFingerprint) errors.push(error('invalid_value', '$.inputFingerprint', 'El fingerprint no corresponde a la evidencia suministrada.'))

  const candidates = new Map(input.candidates.map((candidate) => [candidate.candidateId, candidate]))
  const packets = new Map(input.evidencePackets.map((packet) => [packet.packetId, packet]))
  const identities = new Map(input.catalogIdentities.map((identity) => [identity.identityId, identity]))
  const inputLiteralValues = (candidate: TerritorialSemanticCandidateInput) => new Set(Object.values(candidate.literals).filter((item): item is string => typeof item === 'string'))
  const literalKeys = ['homogeneousClassification', 'homogeneousCategory', 'legalClassification', 'legalCategory', 'planningCategory', 'use', 'denomination'] as const

  const validateRefs = (refs: unknown, path: string, candidate: TerritorialSemanticCandidateInput) => {
    if (!Array.isArray(refs) || !refs.every((item) => typeof item === 'string')) {
      errors.push(error('malformed', path, 'Las referencias deben ser strings.')); return
    }
    for (const ref of refs) {
      const packet = packets.get(ref)
      if (!packet) { errors.push(error('unknown_evidence', `${path}[${refs.indexOf(ref)}]`, `No existe el packetId ${ref}.`)); continue }
      if (packet.instrumentId && input.instrumentId && packet.instrumentId !== input.instrumentId) errors.push(error('evidence_mismatch', `${path}[${refs.indexOf(ref)}]`, 'La evidencia pertenece a otro instrumento.'))
      if (packet.candidateIds && !packet.candidateIds.includes(candidate.candidateId)) errors.push(error('evidence_mismatch', `${path}[${refs.indexOf(ref)}]`, 'La evidencia no pertenece al candidato.'))
      if (packet.sourceFeatureIds && !packet.sourceFeatureIds.some((id) => candidate.sourceFeatureIds.includes(id))) errors.push(error('evidence_mismatch', `${path}[${refs.indexOf(ref)}]`, 'La evidencia no pertenece a ninguna feature del candidato.'))
    }
  }

  const validateLiterals = (literals: unknown, path: string, candidate: TerritorialSemanticCandidateInput) => {
    if (!isRecord(literals)) { errors.push(error('malformed', path, 'literals debe ser un objeto.')); return }
    ownKeysOnly(literals, [...literalKeys], path, errors)
    for (const key of literalKeys) {
      const item = literals[key]
      if (item !== undefined && typeof item !== 'string') errors.push(error('malformed', `${path}.${key}`, 'El literal debe ser string.'))
      if (typeof item === 'string' && item !== candidate.literals[key]) errors.push(error('invented_literal', `${path}.${key}`, 'El literal no coincide con el atributo oficial suministrado.'))
    }
  }

  for (const [index, observation] of resolution.observations.entries()) {
    const path = `$.observations[${index}]`
    if (!isRecord(observation)) { errors.push(error('malformed', path, 'La observación debe ser un objeto.')); continue }
    ownKeysOnly(observation, ['candidateId', 'sourceFeatureIds', 'literals', 'operationalClassification', 'planningArea', 'normativeIdentity', 'evidenceRefs', 'contradictions'], path, errors)
    const candidate = candidates.get(observation.candidateId as string)
    if (!candidate) { errors.push(error('unknown_candidate', `${path}.candidateId`, 'candidateId inexistente.')); continue }
    if (!Array.isArray(observation.sourceFeatureIds)) errors.push(error('malformed', `${path}.sourceFeatureIds`, 'sourceFeatureIds debe ser un array.'))
    else for (const featureId of observation.sourceFeatureIds) if (!candidate.sourceFeatureIds.includes(featureId)) errors.push(error('unknown_feature', `${path}.sourceFeatureIds`, `La feature ${featureId} no pertenece al candidato.`))
    validateLiterals(observation.literals, `${path}.literals`, candidate)
    validateRefs(observation.evidenceRefs, `${path}.evidenceRefs`, candidate)
    const semanticValues = [observation.operationalClassification, observation.planningArea]
    for (const semantic of semanticValues) {
      if (semantic === undefined) continue
      if (!isRecord(semantic) || typeof semantic.value !== 'string' || !['high', 'medium', 'low'].includes(semantic.confidence as string) || !['accepted', 'review_required', 'unknown'].includes(semantic.status as string)) errors.push(error('malformed', path, 'Resolución semántica inválida.'))
      if (isRecord(semantic) && semantic.status === 'accepted' && !observation.evidenceRefs?.length) errors.push(error('unknown_evidence', `${path}.evidenceRefs`, 'Toda conclusión aceptada necesita evidencia.'))
    }
    if (isRecord(observation.normativeIdentity)) {
      const identity = identities.get(observation.normativeIdentity.identityId as string)
      if (!identity) errors.push(error('unknown_identity', `${path}.normativeIdentity.identityId`, 'Identidad inexistente en catálogo.'))
      else {
        if (identity.catalogStatus !== 'ACCEPTED') errors.push(error('identity_not_accepted', `${path}.normativeIdentity.identityId`, 'La identidad no está ACCEPTED.'))
        if (input.instrumentId && identity.instrumentId !== input.instrumentId) errors.push(error('identity_instrument_mismatch', `${path}.normativeIdentity.identityId`, 'La identidad pertenece a otro instrumento.'))
        if (observation.normativeIdentity.identity !== identity.officialCode && observation.normativeIdentity.identity !== identity.officialName) errors.push(error('invented_literal', `${path}.normativeIdentity.identity`, 'La identidad no coincide con el catálogo.'))
      }
    }
  }

  for (const ref of resolution.evidenceRefs) if (!packets.has(ref)) errors.push(error('unknown_evidence', '$.evidenceRefs', `No existe el packetId ${ref}.`))
  const observations = resolution.observations.filter(isRecord)
  const classificationValues = observations.map((observation) => isRecord(observation.operationalClassification) ? observation.operationalClassification.value : undefined).filter((value): value is string => typeof value === 'string')
  const planningAreaValues = observations.map((observation) => isRecord(observation.planningArea) ? observation.planningArea.value : undefined).filter((value): value is string => typeof value === 'string')
  if (resolution.canonical.classification !== undefined && !classificationValues.includes(resolution.canonical.classification)) errors.push(error('invalid_value', '$.canonical.classification', 'La clasificación canónica no coincide con ninguna observación operativa.'))
  if (resolution.canonical.planningArea !== undefined && !planningAreaValues.includes(resolution.canonical.planningArea)) errors.push(error('invalid_value', '$.canonical.planningArea', 'El ámbito canónico no coincide con ninguna observación de ámbito.'))
  if (['unknown', 'conflict', 'abstained'].includes(resolution.status) && Object.values(resolution.canonical).some((value) => value !== undefined)) errors.push(error('contradiction_status', '$.canonical', 'Un resultado global no resuelto no puede publicar conclusiones canónicas.'))
  if (resolution.status === 'accepted' && (resolution.contradictions.length > 0 || input.existingContradictions.length > 0)) errors.push(error('contradiction_status', '$.status', 'Una resolución con contradicciones no puede estar accepted.'))
  if (resolution.status === 'accepted' && resolution.observations.length === 0) errors.push(error('invalid_value', '$.observations', 'Una resolución accepted necesita observaciones.'))
  return errors.length ? { valid: false, errors } : { valid: true, errors: [], value: resolution }
}
