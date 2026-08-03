import type { NormalizedParcelContext } from '@/domain/parcel-context/types'
import { createEvaluatedSituation, createUrbanisticFact, createEvidence, createValidity, createAssessment } from '@/domain/legal-engine/factory'
import type { EvaluatedUrbanisticSituation, UrbanisticFact, UrbanisticFactKind, Evidence, Validity, ValidityStatus, Assessment, ConfidenceLevel, VerificationStatus } from '@/domain/legal-engine/types'
import type { UrbanisticFact as LegacyUrbanisticFact, TerritorialEvidence } from '@/domain/territorial-resolver/types'

export function adaptLegacyParcelContextToSituation(
  legacyContext: NormalizedParcelContext,
  situationId: string,
  referenceDate: string,
  expedienteId?: string
): EvaluatedUrbanisticSituation {
  const municipalityCode = legacyContext.municipality?.value?.ineCode || 'unknown'
  const cadastralRef = legacyContext.cadastralReference?.value

  return createEvaluatedSituation({
    id: situationId,
    referenceDate,
    expedienteId,
    jurisdiction: {
      municipalityCode,
      provinceCode: legacyContext.province?.value?.id
    },
    territorialScope: {
      id: cadastralRef || 'unknown-scope',
      type: 'parcel',
      cadastralReference: cadastralRef,
      description: legacyContext.address?.value
    }
  })
}

export function adaptLegacyFactToV2(
  legacyFact: LegacyUrbanisticFact<any>,
  factId: string,
  situationId: string,
  property: UrbanisticFactKind,
  createdAt: string
): UrbanisticFact | null {
  if (legacyFact.value === undefined || legacyFact.value === null) return null

  let stringValue = ''
  if (typeof legacyFact.value === 'string' || typeof legacyFact.value === 'number' || typeof legacyFact.value === 'boolean') {
    stringValue = String(legacyFact.value)
  } else if (legacyFact.value.code) {
    stringValue = String(legacyFact.value.code)
  } else {
    stringValue = JSON.stringify(legacyFact.value)
  }

  return createUrbanisticFact({
    id: factId,
    situationId,
    property,
    value: stringValue,
    createdAt
  })
}

export function adaptLegacyEvidenceToV2(
  legacyEvidence: TerritorialEvidence,
  evidenceId: string,
  subjectId: string,
  createdAt: string
): Evidence {
  let kind: Evidence['kind'] = 'official_registry'
  if (legacyEvidence.source === 'urbanbrain') {
    kind = 'document'
  }

  return createEvidence({
    id: evidenceId,
    subjectId,
    kind,
    sourceReference: legacyEvidence.sourceUrl,
    sourceLocation: legacyEvidence.scope,
    description: `Fuente: ${legacyEvidence.source}. Método: ${legacyEvidence.method}`,
    createdAt
  })
}

export function adaptLegacyValidityToV2(legacyValidityString?: string): Validity | null {
  if (!legacyValidityString) return null

  const normalized = legacyValidityString.trim().toLowerCase()
  let status: ValidityStatus

  if (normalized === 'active' || normalized === 'activo' || normalized === 'vigente') {
    status = 'ACTIVE'
  } else if (normalized === 'future' || normalized === 'futuro') {
    status = 'FUTURE'
  } else if (normalized === 'expired' || normalized === 'expirado' || normalized === 'derogado') {
    status = 'EXPIRED'
  } else if (normalized === 'suspended' || normalized === 'suspendido') {
    status = 'SUSPENDED'
  } else {
    return null
  }

  return createValidity({ status })
}

export interface LegacyAssessmentInputs {
  confidence?: string | number | null
  verification?: string | null
  warnings?: any[]
  discrepancies?: any[]
}

export function adaptLegacyAssessmentToV2(inputs?: LegacyAssessmentInputs): Assessment {
  if (!inputs) {
    return createAssessment({
      confidence: 'UNKNOWN',
      verification: 'UNVERIFIED',
      warnings: [],
      discrepancies: []
    })
  }

  let mappedConfidence: ConfidenceLevel = 'UNKNOWN'
  if (typeof inputs.confidence === 'string') {
    const normalized = inputs.confidence.trim().toLowerCase()
    if (normalized === 'high' || normalized === 'alta') {
      mappedConfidence = 'HIGH'
    } else if (normalized === 'medium' || normalized === 'media') {
      mappedConfidence = 'MEDIUM'
    } else if (normalized === 'low' || normalized === 'baja') {
      mappedConfidence = 'LOW'
    }
  }

  let mappedVerification: VerificationStatus = 'UNVERIFIED'
  if (typeof inputs.verification === 'string') {
    const normalized = inputs.verification.trim().toLowerCase()
    if (normalized === 'confirmed' || normalized === 'technician_validated' || normalized === 'verified') {
      mappedVerification = 'VERIFIED'
    } else if (normalized === 'inferred' || normalized === 'probable') {
      mappedVerification = 'INFERRED'
    } else if (normalized === 'conflict' || normalized === 'contested') {
      mappedVerification = 'CONTESTED'
    } else if (normalized === 'unverified' || normalized === 'unresolved' || normalized === 'ambiguous') {
      mappedVerification = 'UNVERIFIED'
    }
  }

  const extractString = (val: any) => {
    if (typeof val === 'string') return val
    if (val && typeof val === 'object') {
      return val.message || val.explanation || val.reason || val.code || JSON.stringify(val)
    }
    return String(val)
  }

  const warnings = Array.isArray(inputs.warnings) ? inputs.warnings.map(extractString) : []
  const discrepancies = Array.isArray(inputs.discrepancies) ? inputs.discrepancies.map(extractString) : []

  return createAssessment({
    confidence: mappedConfidence,
    verification: mappedVerification,
    warnings,
    discrepancies
  })
}
