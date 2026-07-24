import {
  BETANZOS_CURRENT_INSTRUMENT,
  BETANZOS_REGISTRY,
} from '@/municipal-pilots/betanzos/registry';

/**
 * Capas vectoriales de clasificación autorizadas tras contrastarlas con el
 * inventario documental de SIOTUGA. Las capas pendientes pueden conservarse
 * como evidencia, pero nunca producen una selección automática hasta que el
 * instrumento que identifican coincide con municipal_planning.
 */
export type SiotugaClassificationLayerStatus = 'active' | 'pending_traceability';

export interface SiotugaClassificationLayerRegistration {
  municipalityCode: string;
  municipalityName: string;
  layerName: string;
  status: SiotugaClassificationLayerStatus;
  instrument: {
    siotugaDocumentId: string;
    name: string;
    approvalDate: string;
    inventoryUrl: string;
  };
  source: {
    wfsCapabilitiesUrl: string;
    verifiedAt: string;
  };
  note?: string;
}

export const SIOTUGA_CLASSIFICATION_LAYERS = [
  {
    municipalityCode: BETANZOS_REGISTRY.municipality.ineCode,
    municipalityName: BETANZOS_REGISTRY.municipality.name,
    layerName: BETANZOS_REGISTRY.layers.classification,
    status: 'active',
    instrument: {
      siotugaDocumentId: BETANZOS_CURRENT_INSTRUMENT.id,
      name: BETANZOS_CURRENT_INSTRUMENT.name,
      approvalDate: BETANZOS_CURRENT_INSTRUMENT.approvalDate!,
      inventoryUrl: BETANZOS_REGISTRY.sources.inventory,
    },
    source: {
      wfsCapabilitiesUrl: BETANZOS_REGISTRY.sources.wfs,
      verifiedAt: BETANZOS_REGISTRY.auditedAt,
    },
  },
  {
    municipalityCode: '15031',
    municipalityName: 'Culleredo',
    layerName: '_15031_PXOU_198707_AD_3CLAS_22310',
    status: 'active',
    instrument: {
      siotugaDocumentId: '22310',
      name: 'Plan general de ordenación urbana',
      approvalDate: '1987-07-29',
      inventoryUrl: 'https://siotuga.xunta.gal/siotuga/inventario.php?inv=1&idconcello=15031',
    },
    source: {
      wfsCapabilitiesUrl:
        'https://siotuga.xunta.gal/siotuga/ws?codine=15031&SERVICE=WFS&VERSION=1.1.0&REQUEST=GetCapabilities',
      verifiedAt: '2026-07-21',
    },
  },
  {
    municipalityCode: '15058',
    municipalityName: 'Oleiros',
    layerName: '_15058_PXOM_200903_AD_3CLAS_26746',
    status: 'pending_traceability',
    instrument: {
      siotugaDocumentId: '26746',
      name: 'Plan general de ordenación municipal',
      approvalDate: '2009-03-11',
      inventoryUrl: 'https://siotuga.xunta.gal/siotuga/inventario.php?inv=1&idconcello=15058',
    },
    source: {
      wfsCapabilitiesUrl:
        'https://siotuga.xunta.gal/siotuga/ws?codine=15058&SERVICE=WFS&VERSION=1.1.0&REQUEST=GetCapabilities',
      verifiedAt: '2026-07-21',
    },
    note:
      'La capa 26746 corresponde al PXOM de 2009; SIOTUGA identifica como instrumento general actual el documento 27891, de 2014-12-11. No existe todavía una vinculación inequívoca entre esta capa y el instrumento vigente del catálogo.',
  },
] as const satisfies readonly SiotugaClassificationLayerRegistration[];

export function getSiotugaClassificationLayer(
  municipalityCode?: string
): SiotugaClassificationLayerRegistration | undefined {
  return SIOTUGA_CLASSIFICATION_LAYERS.find((layer) => layer.municipalityCode === municipalityCode);
}
