import {
  CORUNA_P1_PLANNING_KNOWLEDGE,
  type ActiveP1MunicipalityPlanning,
} from './corunaP1PlanningKnowledge'
import { CORUNA_P1_DOCUMENTS_BY_INSTRUMENT } from './corunaP1PlanningDocuments.generated'
import { BETANZOS_REGISTRY } from '@/municipal-pilots/betanzos/registry'

const MUNICIPAL_PILOTS = [BETANZOS_REGISTRY]

const REQUIRED_CLASSIFICATION_ATTRIBUTES = ['cla_homo', 'cat_homo'] as const

function isSafeOfficialDocumentUrl(value: string) {
  try {
    const url = new URL(value)
    return url.protocol === 'https:' && !url.username && !url.password
  } catch {
    return false
  }
}

function isOperational(entry: ActiveP1MunicipalityPlanning) {
  return (
    entry.activation.status === 'active' &&
    entry.activation.technicalPattern === 'single_current_layer' &&
    entry.coverage.classification &&
    entry.coverage.category &&
    !entry.coverage.endToEndParameters &&
    entry.instrument.inventoryUrl.startsWith('https://siotuga.xunta.gal/siotuga/') &&
    entry.classificationLayer.capabilitiesUrl.startsWith(
      'https://siotuga.xunta.gal/siotuga/'
    ) &&
    REQUIRED_CLASSIFICATION_ATTRIBUTES.every((attribute) =>
      entry.classificationLayer.attributes.includes(attribute)
    ) &&
    entry.documents.every(
      (document) =>
        document.instrumentId === entry.instrument.officialId &&
        isSafeOfficialDocumentUrl(document.sourceUrl)
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

export function getPlanningDocumentsByInstrument(instrumentId?: string) {
  if (!instrumentId) return []
  return [...(CORUNA_P1_DOCUMENTS_BY_INSTRUMENT[instrumentId as keyof typeof CORUNA_P1_DOCUMENTS_BY_INSTRUMENT] ?? [])]
}

export function getMunicipalPilotRegistry(municipalityCode?: string) {
  if (!municipalityCode) return undefined
  return MUNICIPAL_PILOTS.find(
    (pilot) => pilot.municipality.ineCode === municipalityCode
  )
}
