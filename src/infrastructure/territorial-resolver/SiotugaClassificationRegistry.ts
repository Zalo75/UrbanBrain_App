import { getActiveP1PlanningMunicipalities } from '@/infrastructure/planning-knowledge/PlanningKnowledgeBase'

/**
 * Capas vectoriales de clasificación autorizadas tras contrastarlas con el
 * inventario documental de SIOTUGA. Las capas pendientes pueden conservarse
 * como evidencia, pero nunca producen una selección automática hasta que el
 * instrumento que identifican coincide con el planeamiento vigente.
 */
export type SiotugaClassificationLayerStatus = 'active' | 'pending_traceability'

export interface SiotugaClassificationLayerRegistration {
  municipalityCode: string
  municipalityName: string
  layerName: string
  status: SiotugaClassificationLayerStatus
  knowledgeVersion?: string
  instrument: {
    siotugaDocumentId: string
    name: string
    approvalDate: string
    inventoryUrl: string
  }
  source: {
    provider: 'siotuga'
    wfsCapabilitiesUrl: string
    verifiedAt: string
  }
  reviewScopes?: readonly {
    id: string
    name: string
    instrumentId: string
    sourceUrl: string
    classificationCodes: readonly string[]
    categoryCodes?: readonly string[]
    explanation: string
  }[]
  note?: string
}

const P1_CLASSIFICATION_LAYERS: readonly SiotugaClassificationLayerRegistration[] =
  getActiveP1PlanningMunicipalities().map((knowledge) => ({
    municipalityCode: knowledge.municipalityCode,
    municipalityName: knowledge.municipalityName,
    layerName: knowledge.classificationLayer.name,
    status: 'active',
    knowledgeVersion: knowledge.knowledgeVersion,
    instrument: {
      siotugaDocumentId: knowledge.instrument.officialId,
      name: knowledge.instrument.name,
      approvalDate: knowledge.instrument.approvalDate,
      inventoryUrl: knowledge.instrument.inventoryUrl,
    },
    source: {
      provider: 'siotuga',
      wfsCapabilitiesUrl: knowledge.classificationLayer.capabilitiesUrl,
      verifiedAt: knowledge.activation.verifiedAt,
    },
  }))

// Fuentes ya auditadas fuera de P1. Se mantienen sin alterar su comportamiento.
const LEGACY_NON_P1_CLASSIFICATION_LAYERS = [
  {
    municipalityCode: '15058',
    municipalityName: 'Oleiros',
    layerName: '_15058_PXOM_200903_AD_3CLAS_26746',
    status: 'pending_traceability',
    instrument: {
      siotugaDocumentId: '26746',
      name: 'Plan general de ordenación municipal',
      approvalDate: '2009-03-11',
      inventoryUrl:
        'https://siotuga.xunta.gal/siotuga/inventario.php?inv=1&idconcello=15058',
    },
    source: {
      provider: 'siotuga',
      wfsCapabilitiesUrl:
        'https://siotuga.xunta.gal/siotuga/ws?codine=15058&SERVICE=WFS&VERSION=1.1.0&REQUEST=GetCapabilities',
      verifiedAt: '2026-07-21',
    },
    note:
      'La capa 26746 corresponde al PXOM de 2009; SIOTUGA identifica como instrumento general actual el documento 27891, de 2014-12-11. No existe todavía una vinculación inequívoca entre esta capa y el instrumento vigente del catálogo.',
  },
  {
    municipalityCode: '15075',
    municipalityName: 'Sada',
    layerName: '_15075_PXOM_201710_AD_3CLAS_28089',
    status: 'active',
    instrument: {
      siotugaDocumentId: '28089',
      name: 'Plan general de ordenación municipal',
      approvalDate: '2017-10-11',
      inventoryUrl:
        'https://siotuga.xunta.gal/siotuga/inventario.php?inv=1&idconcello=15075',
    },
    source: {
      provider: 'siotuga',
      wfsCapabilitiesUrl:
        'https://siotuga.xunta.gal/siotuga/ws?codine=15075&SERVICE=WFS&VERSION=1.1.0&REQUEST=GetCapabilities',
      verifiedAt: '2026-07-29',
    },
    reviewScopes: [
      {
        id: 'APT-UEI-8',
        name: 'Área de planeamento transitorio APT-UEI-8',
        instrumentId: '28651',
        sourceUrl:
          'https://siotuga.xunta.gal/siotuga/documentos/urbanismo/SADA/documents/28651pord001.pdf',
        classificationCodes: ['SU'],
        categoryCodes: ['SUSC'],
        explanation:
          'La capa vectorial 28089 no delimita APT-UEI-8 ni incorpora el instrumento posterior 28651. Los recintos SU/SUSC pueden estar afectados y requieren contrastar la ordenación detallada oficial.',
      },
    ],
  },
] as const satisfies readonly SiotugaClassificationLayerRegistration[]

export const SIOTUGA_CLASSIFICATION_LAYERS = [
  ...P1_CLASSIFICATION_LAYERS,
  ...LEGACY_NON_P1_CLASSIFICATION_LAYERS,
] as const

export function getSiotugaClassificationLayer(
  municipalityCode?: string
): SiotugaClassificationLayerRegistration | undefined {
  return SIOTUGA_CLASSIFICATION_LAYERS.find(
    (layer) => layer.municipalityCode === municipalityCode
  )
}

export function getSiotugaClassificationLayers(
  municipalityCode?: string
): readonly SiotugaClassificationLayerRegistration[] {
  return SIOTUGA_CLASSIFICATION_LAYERS.filter(
    (layer) => layer.municipalityCode === municipalityCode
  )
}
