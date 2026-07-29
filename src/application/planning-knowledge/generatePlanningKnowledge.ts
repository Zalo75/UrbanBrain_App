import type {
  MunicipalityPlanningKnowledge,
  PlanningInstrumentKnowledge,
  PlanningKnowledgeGenerationInput,
  PlanningLayerKind,
  PlanningLayerKnowledge,
} from '@/domain/planning-knowledge/types'
import { PLANNING_KNOWLEDGE_SCHEMA_VERSION } from '@/domain/planning-knowledge/types'
import { getMunicipalitySuccession } from '@/domain/planning-knowledge/municipalSuccessions'

import { createPlanningKnowledgeRelease } from './versionPlanningKnowledge'

export const CORUNA_PLANNING_KNOWLEDGE_EXPECTED_MUNICIPALITIES = 91
export const CORUNA_PLANNING_KNOWLEDGE_EXCLUSIONS = ['15034', '15050'] as const

const LAYER_PATTERN = /^_(\d{5})_(.*?)_(\d{6})_AD_(1DEL|3CLAS|PORD_02CL_TILEINDEX)_(\d+)$/

function xmlEntities(value: string) {
  return value
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
}

export function extractWfsLayerNames(capabilitiesXml: string, municipalityCode: string) {
  return [
    ...capabilitiesXml.matchAll(/<(?:\w+:)?Name>([^<]+)<\/(?:\w+:)?Name>/gi),
  ]
    .map((match) => xmlEntities(match[1] ?? '').trim())
    .filter((name) => name.startsWith(`_${municipalityCode}_`))
    .filter((name, index, names) => names.indexOf(name) === index)
    .sort()
}

export function extractDescribeFeatureTypeAttributes(xml: string, layerName: string) {
  return [
    ...xml.matchAll(/<(?:\w+:)?element\b[^>]*\bname=["']([^"']+)["']/gi),
  ]
    .map((match) => xmlEntities(match[1] ?? '').trim())
    .filter((attribute) => attribute && attribute !== layerName)
    .filter((attribute, index, attributes) => attributes.indexOf(attribute) === index)
    .sort()
}

function layerKind(code: string): PlanningLayerKind {
  if (code === '3CLAS') return 'classification'
  if (code === '1DEL') return 'delimitation'
  if (code === 'PORD_02CL_TILEINDEX') return 'planning_tile_index'
  return 'other'
}

export function parsePlanningLayer(
  name: string,
  sourceId: string,
  attributes: string[] = []
): PlanningLayerKnowledge {
  const match = name.match(LAYER_PATTERN)
  if (!match) {
    return {
      name,
      kind: name.includes('_3CLAS_') ? 'classification' : 'other',
      attributes: [...attributes].sort(),
      parseStatus: 'malformed',
      sourceId,
    }
  }

  return {
    name,
    kind: layerKind(match[4] ?? ''),
    municipalityCode: match[1],
    instrumentFigure: match[2],
    instrumentApprovalMonth: match[3],
    officialDocumentId: match[5],
    attributes: [...attributes].sort(),
    parseStatus: 'parsed',
    sourceId,
  }
}

function normalizedFigure(figure?: string) {
  return (figure ?? '').normalize('NFD').replace(/[^A-Z0-9]/gi, '').toUpperCase()
}

function isModificationOrDevelopmentLayer(
  layer: PlanningLayerKnowledge,
  instruments: Map<string, PlanningInstrumentKnowledge>
) {
  const inventoryFigure = instruments.get(layer.officialDocumentId ?? '')?.figure ?? ''
  const inventoryKind = instruments.get(layer.officialDocumentId ?? '')?.kind
  const normalizedLayerFigure = normalizedFigure(layer.instrumentFigure)
  return (
    inventoryKind === 'general_modification' ||
    inventoryKind === 'development' ||
    /modificaci[oó]n|plan parcial|plan especial|estudio de detalle/i.test(inventoryFigure) ||
    normalizedLayerFigure === 'MP' ||
    normalizedLayerFigure.startsWith('MP') ||
    ['PE', 'PP', 'PERI', 'PEPRI', 'PEID', 'ED'].includes(normalizedLayerFigure)
  )
}

function classifyPattern(input: {
  currentPlanningCount: number
  layers: PlanningLayerKnowledge[]
  currentClassificationLayers: PlanningLayerKnowledge[]
  instruments: Map<string, PlanningInstrumentKnowledge>
  municipalSuccessionResolved: boolean
}): MunicipalityPlanningKnowledge['technicalPattern'] {
  if (input.layers.some((layer) => layer.parseStatus === 'malformed')) {
    return 'malformed_capabilities'
  }
  if (input.municipalSuccessionResolved) return 'municipal_succession_scoped'
  if (input.currentPlanningCount !== 1) return 'ambiguous_current_planning'
  if (input.currentClassificationLayers.length !== 1) return 'missing_current_layer'

  const classificationLayers = input.layers.filter((layer) => layer.kind === 'classification')
  if (classificationLayers.length === 1) return 'single_current_layer'
  if (
    classificationLayers.some((layer) =>
      isModificationOrDevelopmentLayer(layer, input.instruments)
    )
  ) {
    return 'instrument_composition_required'
  }
  return 'multiple_general_versions'
}

function buildMunicipalityKnowledge(
  input: PlanningKnowledgeGenerationInput,
  municipality: { ineCode: string; name: string }
): MunicipalityPlanningKnowledge {
  const municipalSuccession = getMunicipalitySuccession(municipality.ineCode)
  const currentPlanning = input.currentPlanningRecords
    .filter((record) => record.municipalityId === municipality.ineCode)
    .map((record) => {
      const predecessor = municipalSuccession?.predecessors.find(
        (candidate) => candidate.generalInstrumentApprovalDate === record.approvalDate
      )
      return {
        name: record.name,
        approvalDate: record.approvalDate,
        sourceUrl: record.sourceUrl,
        predecessorMunicipalityCode: predecessor?.municipalityCode,
        territorialScopeId: predecessor?.territorialScopeId,
      }
    })
    .sort((left, right) => left.approvalDate.localeCompare(right.approvalDate))
  const source = input.municipalitySources.find(
    (candidate) => candidate.municipalityCode === municipality.ineCode
  )

  if (!source) {
    return {
      municipalityCode: municipality.ineCode,
      municipalityName: municipality.name,
      provinceCode: '15',
      currentPlanning,
      municipalSuccession,
      instruments: [],
      layers: [],
      instrumentRelations: [],
      regimeIdentifiers: [],
      normativeDocuments: [],
      territorialScopes: [],
      compositionRules: [],
      exceptions: [],
      currentInstrumentCandidates: [],
      technicalPattern: 'missing_current_layer',
      validation: {
        status: 'invalid',
        reasons: ['missing_municipality_sources'],
      },
      activation: {
        status: 'inactive',
        reason: 'lot_0_discovery_only',
      },
      coverage: {
        classification: false,
        category: false,
        zoneOrOrdinance: false,
        normativeDocument: false,
        endToEndParameters: false,
        blockers: ['missing_municipality_sources', 'lot_0_not_activated'],
      },
      sourceIds: [],
    }
  }

  const instruments = source.inventory.map((instrument) => ({
    ...instrument,
    predecessorMunicipalityCode: municipalSuccession?.predecessors.find(
      (predecessor) => predecessor.generalInstrumentId === instrument.officialId
    )?.municipalityCode,
  }))
  const instrumentById = new Map(
    instruments.map((instrument) => [instrument.officialId, instrument])
  )
  const layers = extractWfsLayerNames(source.capabilitiesXml, municipality.ineCode).map(
    (name) => {
      const schema = source.layerSchemas[name]
      return parsePlanningLayer(
        name,
        source.capabilitiesSourceId,
        schema ? extractDescribeFeatureTypeAttributes(schema.xml, name) : []
      )
    }
  )
  const municipalSuccessionResolved = Boolean(
    municipalSuccession &&
      currentPlanning.length === municipalSuccession.predecessors.length &&
      currentPlanning.every((planning) => planning.predecessorMunicipalityCode) &&
      municipalSuccession.predecessors.every((predecessor) =>
        layers.some(
          (layer) =>
            layer.name === predecessor.classificationLayerName &&
            layer.officialDocumentId === predecessor.generalInstrumentId &&
            layer.kind === 'classification' &&
            layer.parseStatus === 'parsed'
        )
      )
  )
  const currentApprovalMonth =
    currentPlanning.length === 1
      ? currentPlanning[0]?.approvalDate.slice(0, 7).replace('-', '')
      : undefined
  const currentClassificationLayers = municipalSuccessionResolved
    ? layers.filter((layer) =>
        municipalSuccession?.predecessors.some(
          (predecessor) => predecessor.classificationLayerName === layer.name
        )
      )
    : layers.filter(
        (layer) =>
          layer.kind === 'classification' &&
          layer.instrumentApprovalMonth === currentApprovalMonth &&
          layer.officialDocumentId &&
          instrumentById.get(layer.officialDocumentId)?.approvalDate ===
            currentPlanning[0]?.approvalDate
      )
  const technicalPattern = classifyPattern({
    currentPlanningCount: currentPlanning.length,
    layers,
    currentClassificationLayers,
    instruments: instrumentById,
    municipalSuccessionResolved,
  })
  const reasons: string[] = []
  if (currentPlanning.length !== 1 && !municipalSuccessionResolved) {
    reasons.push('current_planning_not_unique')
  }
  if (layers.some((layer) => layer.parseStatus === 'malformed')) {
    reasons.push('malformed_layer_metadata')
  }
  if (currentClassificationLayers.length === 0) reasons.push('current_classification_layer_missing')
  if (currentClassificationLayers.length > 1 && !municipalSuccessionResolved) {
    reasons.push('current_classification_layer_ambiguous')
  }
  if (technicalPattern === 'instrument_composition_required') {
    reasons.push('instrument_composition_not_validated')
  }
  if (technicalPattern === 'municipal_succession_scoped') {
    reasons.push('municipal_succession_requires_spatial_scope_resolution')
  }

  const validationStatus = (() => {
    if (technicalPattern === 'malformed_capabilities') return 'invalid' as const
    if (
      technicalPattern === 'ambiguous_current_planning' ||
      technicalPattern === 'missing_current_layer' ||
      technicalPattern === 'instrument_composition_required'
    ) {
      return 'ambiguous' as const
    }
    return 'candidate' as const
  })()

  return {
    municipalityCode: municipality.ineCode,
    municipalityName: municipality.name,
    provinceCode: '15',
    currentPlanning,
    municipalSuccession,
    instruments: instruments.sort((left, right) =>
      left.officialId.localeCompare(right.officialId)
    ),
    layers,
    instrumentRelations: [],
    regimeIdentifiers: [],
    normativeDocuments: [...source.inventory]
      .map((instrument) => ({
        id: `siotuga-document-${instrument.officialId}`,
        officialDocumentId: instrument.officialId,
        instrumentId: instrument.officialId,
        name: instrument.name,
        officialUrl:
          currentPlanning[0]?.sourceUrl ??
          `https://siotuga.xunta.gal/siotuga/inventario.php?inv=1&idconcello=${municipality.ineCode}`,
        documentType: 'other' as const,
        corpusDocumentNames: [],
        validationStatus: 'discovered' as const,
        sourceIds: [instrument.sourceId],
      }))
      .sort((left, right) => left.id.localeCompare(right.id)),
    territorialScopes: municipalSuccessionResolved
      ? municipalSuccession!.predecessors.map((predecessor) => ({
          id: predecessor.territorialScopeId,
          kind: 'instrument' as const,
          municipalityCode: municipality.ineCode,
          predecessorMunicipalityCode: predecessor.municipalityCode,
          instrumentId: predecessor.generalInstrumentId,
          layerName: predecessor.classificationLayerName,
          officialFeatureIds: [],
          description: `Ámbito territorial heredado del antiguo municipio de ${predecessor.municipalityName} (${predecessor.municipalityCode})`,
          validationStatus: 'candidate' as const,
          sourceIds: [source.capabilitiesSourceId],
        }))
      : [],
    compositionRules: [],
    exceptions: [],
    currentInstrumentCandidates: currentClassificationLayers
      .flatMap((layer) => (layer.officialDocumentId ? [layer.officialDocumentId] : []))
      .sort(),
    technicalPattern,
    validation: {
      status: validationStatus,
      reasons,
    },
    activation: {
      status: 'inactive',
      reason: 'lot_0_discovery_only',
    },
    coverage: {
      classification: false,
      category: false,
      zoneOrOrdinance: false,
      normativeDocument: false,
      endToEndParameters: false,
      blockers: ['lot_0_not_activated', ...reasons],
    },
    sourceIds: [...source.sourceIds].sort(),
  }
}

export function generatePlanningKnowledge(input: PlanningKnowledgeGenerationInput) {
  const excluded = new Set(input.excludedMunicipalityCodes)
  const allowedExclusions = new Set<string>(CORUNA_PLANNING_KNOWLEDGE_EXCLUSIONS)
  const targetMunicipalities = input.municipalityCatalog
    .filter((municipality) => !excluded.has(municipality.ineCode))
    .sort((left, right) => left.ineCode.localeCompare(right.ineCode))
  const errors: string[] = []
  const warnings: string[] = []
  const officialSourceIds = new Set(input.rawSources.map((source) => source.id))

  if (targetMunicipalities.length !== CORUNA_PLANNING_KNOWLEDGE_EXPECTED_MUNICIPALITIES) {
    errors.push(
      `expected_${CORUNA_PLANNING_KNOWLEDGE_EXPECTED_MUNICIPALITIES}_municipalities_received_${targetMunicipalities.length}`
    )
  }
  if (new Set(targetMunicipalities.map((municipality) => municipality.ineCode)).size !== targetMunicipalities.length) {
    errors.push('duplicate_municipality_codes')
  }
  if (input.excludedMunicipalityCodes.some((code) => !allowedExclusions.has(code))) {
    errors.push('unexpected_scope_exclusion')
  }
  for (const officialSource of input.rawSources) {
    if (!officialSource.url.startsWith('https://siotuga.xunta.gal/siotuga/')) {
      errors.push(`${officialSource.id}:non_official_source_url`)
    }
  }

  const municipalities = targetMunicipalities.map((municipality) =>
    buildMunicipalityKnowledge(input, municipality)
  )
  for (const municipality of municipalities) {
    const referencedSourceIds = new Set([
      ...municipality.sourceIds,
      ...municipality.instruments.map((instrument) => instrument.sourceId),
      ...municipality.layers.map((layer) => layer.sourceId),
      ...municipality.normativeDocuments.flatMap((document) => document.sourceIds),
    ])
    for (const sourceId of referencedSourceIds) {
      if (!officialSourceIds.has(sourceId)) {
        errors.push(`${municipality.municipalityCode}:missing_source_snapshot:${sourceId}`)
      }
    }
    if (
      municipality.currentPlanning.some(
        (planning) => !planning.sourceUrl.startsWith('https://siotuga.xunta.gal/siotuga/')
      )
    ) {
      errors.push(`${municipality.municipalityCode}:non_official_planning_url`)
    }
    if (municipality.validation.reasons.includes('missing_municipality_sources')) {
      errors.push(`${municipality.municipalityCode}:missing_municipality_sources`)
    }
    if (municipality.validation.reasons.includes('current_planning_not_unique')) {
      warnings.push(`${municipality.municipalityCode}:current_planning_not_unique`)
    }
    if (municipality.technicalPattern === 'municipal_succession_scoped') {
      warnings.push(`${municipality.municipalityCode}:municipal_succession_requires_spatial_scope_resolution`)
    }
    if (municipality.validation.status === 'invalid') {
      warnings.push(`${municipality.municipalityCode}:invalid_discovery`)
    }
    if (municipality.activation.status !== 'inactive') {
      errors.push(`${municipality.municipalityCode}:lot_0_must_not_activate_municipalities`)
    }
  }

  return createPlanningKnowledgeRelease({
    schemaVersion: PLANNING_KNOWLEDGE_SCHEMA_VERSION,
    scope: {
      country: 'ES',
      autonomousCommunity: 'Galicia',
      provinceCode: '15',
      excludedMunicipalityCodes: [...input.excludedMunicipalityCodes],
    },
    generatedAt: input.generatedAt,
    rawSources: input.rawSources,
    municipalities,
    validation: {
      status: errors.length > 0 ? 'blocked' : 'draft',
      errors,
      warnings,
    },
  })
}
