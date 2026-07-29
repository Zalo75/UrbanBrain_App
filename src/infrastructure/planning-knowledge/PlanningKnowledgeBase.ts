import {
  CORUNA_P1_PLANNING_KNOWLEDGE,
  type ActiveP1MunicipalityPlanning,
} from './corunaP1PlanningKnowledge'

const REQUIRED_CLASSIFICATION_ATTRIBUTES = ['cla_homo', 'cat_homo'] as const

function isOperational(entry: ActiveP1MunicipalityPlanning) {
  return (
    entry.activation.status === 'active' &&
    entry.activation.technicalPattern === 'single_current_layer' &&
    entry.coverage.classification &&
    entry.coverage.category &&
    !entry.coverage.normativeDocument &&
    !entry.coverage.endToEndParameters &&
    entry.instrument.inventoryUrl.startsWith('https://siotuga.xunta.gal/siotuga/') &&
    entry.classificationLayer.capabilitiesUrl.startsWith(
      'https://siotuga.xunta.gal/siotuga/'
    ) &&
    REQUIRED_CLASSIFICATION_ATTRIBUTES.every((attribute) =>
      entry.classificationLayer.attributes.includes(attribute)
    )
  )
}

const ACTIVE_P1_BY_CODE = new Map(
  CORUNA_P1_PLANNING_KNOWLEDGE.filter(isOperational).map((entry) => [
    entry.municipalityCode,
    entry,
  ])
)

export function getActiveP1PlanningKnowledge(municipalityCode?: string) {
  return municipalityCode ? ACTIVE_P1_BY_CODE.get(municipalityCode) : undefined
}

export function getActiveP1PlanningMunicipalities() {
  return [...ACTIVE_P1_BY_CODE.values()]
}
