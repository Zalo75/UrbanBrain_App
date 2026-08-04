import type {
  MunicipalityPlanningKnowledge,
  PlanningKnowledgeRelease,
} from '@/domain/planning-knowledge/types'

import { versionPlanningKnowledgePayload } from './versionPlanningKnowledge'

export const CORUNA_P1_EXPECTED_MUNICIPALITIES = 34
export const CORUNA_P1_REQUIRED_ATTRIBUTES = ['cat_homo', 'cla_homo'] as const

function p1ClassificationLayer(municipality: MunicipalityPlanningKnowledge) {
  const candidateId = municipality.currentInstrumentCandidates[0]
  if (
    municipality.technicalPattern !== 'single_current_layer' ||
    municipality.validation.status !== 'candidate' ||
    municipality.currentPlanning.length !== 1 ||
    municipality.currentInstrumentCandidates.length !== 1 ||
    !candidateId
  ) {
    return undefined
  }

  const layer = municipality.layers.find(
    (item) =>
      item.kind === 'classification' &&
      item.parseStatus === 'parsed' &&
      item.officialDocumentId === candidateId
  )
  if (
    !layer ||
    !CORUNA_P1_REQUIRED_ATTRIBUTES.every((attribute) => layer.attributes.includes(attribute))
  ) {
    return undefined
  }
  return layer
}

export function activateP1PlanningKnowledge(
  draft: PlanningKnowledgeRelease
): PlanningKnowledgeRelease {
  const candidates = draft.municipalities.filter(p1ClassificationLayer)
  const errors = draft.validation.errors.filter(
    (error) => !error.startsWith('p1_expected_')
  )

  if (candidates.length !== CORUNA_P1_EXPECTED_MUNICIPALITIES) {
    errors.push(
      `p1_expected_${CORUNA_P1_EXPECTED_MUNICIPALITIES}_municipalities_received_${candidates.length}`
    )
  }

  const candidateCodes =
    errors.length === 0
      ? new Set(candidates.map((municipality) => municipality.municipalityCode))
      : new Set<string>()
  const municipalities = draft.municipalities.map((municipality) => {
    if (!candidateCodes.has(municipality.municipalityCode)) return municipality
    const currentInstrumentId = municipality.currentInstrumentCandidates[0]
    const hasCurrentInstrumentDocuments = municipality.normativeDocuments.some(
      (document) =>
        document.instrumentId === currentInstrumentId &&
        document.validationStatus !== 'invalid' &&
        document.corpusDocumentNames.length > 0
    )
    return {
      ...municipality,
      activation: {
        status: 'active' as const,
        reason: 'lot_1_p1_single_current_layer_verified',
      },
      coverage: {
        classification: true,
        category: true,
        zoneOrOrdinance: false,
        normativeDocument: hasCurrentInstrumentDocuments,
        endToEndParameters: false,
        blockers: hasCurrentInstrumentDocuments
          ? ['zone_or_ordinance_not_resolved']
          : ['instrument_document_inventory_missing'],
      },
    }
  })

  return versionPlanningKnowledgePayload({
    schemaVersion: draft.schemaVersion,
    scope: draft.scope,
    generatedAt: draft.generatedAt,
    sources: draft.sources,
    municipalities,
    validation: {
      status: errors.length > 0 ? 'blocked' : 'ready_for_review',
      errors,
      warnings: draft.validation.warnings,
    },
  })
}
