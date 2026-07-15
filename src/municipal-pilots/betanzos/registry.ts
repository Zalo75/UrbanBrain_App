import type {
  PlanningDocumentReference,
  PlanningInstrumentReference,
} from '@/domain/territorial-resolver/types';

const INVENTORY_URL = 'https://siotuga.xunta.gal/siotuga/inventario.php?inv=1&idconcello=15009';
const DOCUMENT_ROOT = 'https://siotuga.xunta.gal/siotuga/documentos/urbanismo/BETANZOS/documents';

type RegistryInstrument = PlanningInstrumentReference & {
  officialGazetteDate?: string;
  documentIds: string[];
  relationToCurrent:
    | 'base_instrument'
    | 'modifies_current'
    | 'develops_planning'
    | 'predates_current_relation_unverified'
    | 'superseded';
  spatialBinding: 'classification_vector' | 'document_only';
};

function instrument(
  id: string,
  name: string,
  kind: string,
  approvalDate: string,
  relationToCurrent: RegistryInstrument['relationToCurrent'],
  options: {
    normativePublicationDate?: string;
    consolidatedTextDate?: string;
    officialGazetteDate?: string;
    spatialBinding?: RegistryInstrument['spatialBinding'];
    documentIds?: string[];
  } = {}
): RegistryInstrument {
  return {
    id,
    name,
    kind,
    status:
      relationToCurrent === 'base_instrument'
        ? 'current'
        : relationToCurrent === 'superseded'
          ? 'historical'
          : 'catalogued_pending_spatial_validation',
    approvalDate,
    consolidatedTextDate: options.consolidatedTextDate,
    normativePublicationDate: options.normativePublicationDate,
    officialGazetteDate: options.officialGazetteDate,
    documentIds: options.documentIds ?? [],
    sourceUrl: INVENTORY_URL,
    relationToCurrent,
    spatialBinding: options.spatialBinding ?? 'document_only',
  };
}

export const BETANZOS_REGISTRY = {
  schemaVersion: 1,
  registryVersion: '2026-07-14.1',
  auditedAt: '2026-07-14',
  municipality: {
    name: 'Betanzos',
    ineCode: '15009',
    province: 'A Coruña',
    provinceCode: '15',
  },
  sources: {
    planningStatus: 'https://siotuga.xunta.gal/siotuga/urb?lang=es_ES',
    inventory: INVENTORY_URL,
    wms: 'https://siotuga.xunta.gal/siotuga/ws?codine=15009&SERVICE=WMS&REQUEST=GetCapabilities',
    wfs: 'https://siotuga.xunta.gal/siotuga/ws?codine=15009&SERVICE=WFS&VERSION=1.1.0&REQUEST=GetCapabilities',
  },
  layers: {
    boundary: '_15009_NNSSPP_199606_AD_1DEL_22221',
    planningSheetIndex: '_15009_NNSSPP_199606_AD_PORD_02CL_TILEINDEX_22221',
    detailedPlanningWms: '_15009_NNSSPP_199606_AD_PORD_02CL_22221',
    classification: '_15009_NNSSPP_199606_AD_3CLAS_22221',
  },
  limitations: [
    'La clasificación se publica como vector WFS con atributos; la ordenación pormenorizada se publica como WMS/cartografía raster.',
    'Las modificaciones y el planeamiento de desarrollo están inventariados, pero no tienen una capa vectorial oficial común que permita decidir automáticamente su intersección.',
    'Los códigos de clasificación no se vinculan por sí solos a artículos o parámetros urbanísticos concretos.',
  ],
  instruments: [
    instrument(
      '22221',
      'Texto refundido de la revisión de las Normas Subsidiarias de Planeamiento',
      'Normas Subsidiarias de Planeamiento',
      '1996-06-27',
      'base_instrument',
      {
        consolidatedTextDate: '1996-11-28',
        officialGazetteDate: '1996-08-13',
        normativePublicationDate: '1997-01-24',
        spatialBinding: 'classification_vector',
        documentIds: [
          '0060no001.pdf',
          '0060no002.pdf',
          '0060no003.pdf',
          '0060no004.pdf',
          '0060no005.pdf',
          '0060no011.pdf',
          '0060no012.pdf',
          '0060no013.pdf',
          '0060no014.pdf',
          '0060no015.pdf',
        ],
      }
    ),
    instrument(
      '22225',
      'NSP en la UEI-4 Praza do Rollo',
      'Modificación puntual',
      '2004-03-23',
      'modifies_current',
      {
        officialGazetteDate: '2004-04-29',
        normativePublicationDate: '2004-04-29',
        documentIds: ['0064no001.pdf', '0064no002.pdf'],
      }
    ),
    instrument(
      '22224',
      'NSP Centro de Saúde na finca Carregal',
      'Modificación puntual',
      '2002-02-28',
      'modifies_current',
      { officialGazetteDate: '2002-04-08' }
    ),
    instrument(
      '22222',
      'NSP para nuevo vial de conexión en el polígono de Piadela',
      'Modificación puntual',
      '2001-03-23',
      'modifies_current',
      { officialGazetteDate: '2001-05-07', documentIds: ['0061no001.pdf'] }
    ),
    instrument(
      '28550',
      'Cambio de uso dotacional educativo a sanitario-asistencial',
      'Cambio de uso de parcela dotacional',
      '2023-02-13',
      'modifies_current',
      {
        officialGazetteDate: '2023-03-02',
        documentIds: ['28550no001.pdf', '28550no002.pdf', '28550no003.pdf'],
      }
    ),
    instrument(
      '23086',
      'NSP varias',
      'Modificación puntual',
      '1992-06-18',
      'predates_current_relation_unverified',
      { officialGazetteDate: '1992-11-16' }
    ),
    instrument(
      '23087',
      'NSP',
      'Modificación puntual',
      '1989-01-13',
      'predates_current_relation_unverified',
      { officialGazetteDate: '1989-02-06', normativePublicationDate: '1989-02-06' }
    ),
    instrument(
      '26373',
      'Normas Subsidiarias de Planeamiento de 1987',
      'Histórico: NSP',
      '1987-05-18',
      'superseded'
    ),

    instrument('23308', 'SAUI-5 de Piadela', 'Plan parcial', '2002-09-27', 'develops_planning', {
      officialGazetteDate: '2002-11-21',
      normativePublicationDate: '2002-11-21',
      documentIds: ['1268no001.pdf'],
    }),
    instrument(
      '23311',
      'Polígono industrial de Piadela',
      'Plan parcial',
      '1995-02-23',
      'develops_planning',
      {
        consolidatedTextDate: '1995-07-07',
        officialGazetteDate: '1995-08-08',
        normativePublicationDate: '2006-12-12',
        documentIds: ['1271no000.pdf', '1271no001.pdf'],
      }
    ),
    instrument('23309', 'O Pasatempo', 'Plan parcial', '1990-09-11', 'develops_planning', {
      officialGazetteDate: '1990-10-05',
      normativePublicationDate: '1991-02-28',
    }),
    instrument(
      '23312',
      'Polígono industrial 2 de Piadela',
      'Plan parcial',
      '1989-11-30',
      'develops_planning',
      { officialGazetteDate: '1990-01-31', normativePublicationDate: '1990-04-21' }
    ),
    instrument(
      '22174',
      'Polígono industrial 1 de Piadela',
      'Plan parcial',
      '1989-01-13',
      'develops_planning',
      { officialGazetteDate: '1989-07-12', normativePublicationDate: '1989-07-12' }
    ),
    instrument(
      '27795',
      'Infraestructuras para instalación de tanatorio',
      'Plan especial',
      '2013-04-30',
      'develops_planning',
      { officialGazetteDate: '2013-07-09', normativePublicationDate: '2013-07-09' }
    ),
    instrument(
      '26000',
      'Reforma interior de la UEI-7 de las NSP',
      'Plan especial',
      '2005-12-27',
      'develops_planning',
      { officialGazetteDate: '2007-02-07' }
    ),
    instrument(
      '23313',
      'Protección y ordenación del casco histórico',
      'Plan especial',
      '1992-12-02',
      'develops_planning',
      {
        officialGazetteDate: '1992-12-30',
        normativePublicationDate: '2001-04-23',
        documentIds: ['1273no008.pdf'],
      }
    ),
    instrument(
      '23314',
      'Reforma interior de la UA-03 Ambulatorio',
      'Plan especial',
      '1990-11-06',
      'develops_planning',
      { officialGazetteDate: '1990-12-13' }
    ),
    instrument(
      '28306',
      'Modificación del Plan Parcial de Piadela SAUI-5',
      'Modificación puntual',
      '2020-02-27',
      'develops_planning',
      {
        officialGazetteDate: '2020-10-30',
        normativePublicationDate: '2020-10-30',
        documentIds: ['28306no002.pdf'],
      }
    ),
    instrument(
      '28052',
      'Modificación del plan especial de tanatorio-crematorio',
      'Modificación puntual',
      '2016-04-26',
      'develops_planning',
      { officialGazetteDate: '2016-07-04', normativePublicationDate: '2016-07-04' }
    ),
    instrument(
      '26677',
      'PEPOCH en Rúa do Pozo 14',
      'Modificación puntual',
      '2008-10-28',
      'develops_planning'
    ),
    instrument(
      '23331',
      'Plan Parcial Piadela Polígono 1',
      'Modificación puntual',
      '2001-01-16',
      'develops_planning',
      { officialGazetteDate: '2001-03-23' }
    ),
    instrument(
      '23332',
      'Plan Parcial O Pasatempo',
      'Modificación puntual',
      '1992-10-28',
      'develops_planning',
      { officialGazetteDate: '1992-11-16' }
    ),

    instrument(
      '28075',
      'Parcela 19-2 UE-3 Plan Parcial SAUI-7, polígono industrial de Piadela',
      'Estudio de detalle',
      '2016-06-28',
      'develops_planning',
      { officialGazetteDate: '2016-12-22' }
    ),
    instrument(
      '27806',
      'Parcela en avenida Fraga Iribarne',
      'Estudio de detalle',
      '2013-04-30',
      'develops_planning'
    ),
    instrument(
      '27440',
      'Parcela 121 en Plan Parcial Pasatempo-Carregal',
      'Estudio de detalle',
      '2010-06-29',
      'develops_planning'
    ),
    instrument(
      '26359',
      'Avenida Jesús García Naveira 19, 21 y 23',
      'Estudio de detalle',
      '2008-03-31',
      'develops_planning'
    ),
    instrument('25853', 'UEI-19', 'Estudio de detalle', '2005-12-27', 'develops_planning', {
      officialGazetteDate: '2006-04-27',
    }),
    instrument(
      '25854',
      'UEI-22 Barrio da Ponte Vella',
      'Estudio de detalle',
      '2005-12-27',
      'develops_planning'
    ),
    instrument('25852', 'UEI-17 Condesa', 'Estudio de detalle', '2005-08-01', 'develops_planning', {
      officialGazetteDate: '2005-09-01',
    }),
    instrument(
      '23329',
      'UEI-16 Rúa Pintor Seijo Rubio y Rúa do Rollo',
      'Estudio de detalle',
      '2003-09-02',
      'develops_planning'
    ),
    instrument(
      '23315',
      'Rúa Doutor Fleming',
      'Estudio de detalle',
      '2003-04-09',
      'develops_planning',
      { officialGazetteDate: '2003-06-11' }
    ),
    instrument(
      '23326',
      'UEI-08 Rúa Arxentina y Camiño de Acea, casco histórico',
      'Estudio de detalle',
      '2002-11-28',
      'develops_planning'
    ),
    instrument(
      '23317',
      'Paseo da Galera y Carregal',
      'Estudio de detalle',
      '2002-09-27',
      'develops_planning'
    ),
    instrument(
      '23324',
      'UEI-03 Polígono 2',
      'Estudio de detalle',
      '2002-08-30',
      'develops_planning'
    ),
    instrument(
      '23323',
      'UEI-02 Bellavista',
      'Estudio de detalle',
      '2002-03-22',
      'develops_planning',
      { officialGazetteDate: '2002-06-05' }
    ),
    instrument(
      '23322',
      'UEI-01.B Cruz Verde',
      'Estudio de detalle',
      '2001-11-28',
      'develops_planning'
    ),
    instrument('23321', 'UEI-01', 'Estudio de detalle', '2000-03-30', 'develops_planning'),
    instrument(
      '23327',
      'UEI-05-B Avenida García Naveira',
      'Estudio de detalle',
      '2000-02-24',
      'develops_planning'
    ),
    instrument(
      '23325',
      'UEI-05A As Cascas',
      'Estudio de detalle',
      '2000-02-24',
      'develops_planning'
    ),
    instrument('23330', 'UEI-04', 'Estudio de detalle', '1999-02-01', 'develops_planning'),
    instrument(
      '23316',
      'Estrada de Castela',
      'Estudio de detalle',
      '1998-10-01',
      'develops_planning'
    ),
    instrument('23328', 'UEI-14', 'Estudio de detalle', '1998-10-01', 'develops_planning'),
    instrument('23319', 'Rúa Cruz Verde', 'Estudio de detalle', '1998-05-29', 'develops_planning'),
    instrument(
      '23320',
      'UE-18 Camiño do Refoxo',
      'Estudio de detalle',
      '1997-09-19',
      'develops_planning',
      { officialGazetteDate: '1997-10-24' }
    ),
    instrument(
      '23318',
      'Praza Xosé Dapena',
      'Estudio de detalle',
      '1997-03-20',
      'develops_planning'
    ),
  ] satisfies RegistryInstrument[],
  documents: [
    ['22221', '0060no001.pdf', 'Normativa BOP 24/01/1997: anuncio, índice y capítulos 1-2', 'general'],
    ['22221', '0060no002.pdf', 'Normativa BOP 24/01/1997: capítulo 2', 'general'],
    ['22221', '0060no003.pdf', 'Normativa BOP 24/01/1997: capítulo 2 y artículos 1-17', 'general'],
    ['22221', '0060no004.pdf', 'Normativa BOP 24/01/1997: artículos 18-36', 'general'],
    ['22221', '0060no005.pdf', 'Normativa BOP 24/01/1997: artículos 37-50, convenios y anexos', 'general'],
    ['22221', '0060no011.pdf', 'Normas urbanísticas I: parámetros y ordenanzas generales', 'general'],
    ['22221', '0060no012.pdf', 'Normas urbanísticas II: gestión, ejecución y régimen del suelo', 'general'],
    ['22221', '0060no013.pdf', 'Usos y tramitación: tipos, clases y parámetros', 'general'],
    ['22221', '0060no014.pdf', 'Usos y tramitación: regulación', 'general'],
    ['22221', '0060no015.pdf', 'Normas de tramitación', 'general'],
    ['22225', '0064no001.pdf', 'Normativa de la modificación UEI-4 Praza do Rollo', 'unverified_for_detected_area'],
    ['22225', '0064no002.pdf', 'Normativa BOP 29/04/2004 de la modificación UEI-4', 'unverified_for_detected_area'],
    ['22222', '0061no001.pdf', 'Normativa de la modificación del vial de Piadela', 'unverified_for_detected_area'],
    ['28550', '28550no001.pdf', 'Anuncio DOG 21/03/2023 del cambio de uso dotacional', 'unverified_for_detected_area'],
    ['28550', '28550no002.pdf', 'Anuncio BOP 02/03/2023 del cambio de uso dotacional', 'unverified_for_detected_area'],
    ['28550', '28550no003.pdf', 'Normativa urbanística del cambio de uso dotacional', 'unverified_for_detected_area'],
    ['23308', '1268no001.pdf', 'Normativa BOP 21/11/2002 del SAUI-5 de Piadela', 'unverified_for_detected_area'],
    ['23311', '1271no000.pdf', 'Normativa BOP 12/12/2006 del polígono industrial de Piadela', 'unverified_for_detected_area'],
    ['23311', '1271no001.pdf', 'Ordenanzas reguladoras del polígono industrial de Piadela', 'unverified_for_detected_area'],
    ['23313', '1273no008.pdf', 'Normativa urbanística del Plan Especial del casco histórico', 'unverified_for_detected_area'],
    ['28306', '28306no002.pdf', 'Normativa BOP 30/10/2020 de la modificación del SAUI-5', 'unverified_for_detected_area'],
  ].map(
    ([instrumentId, id, title, binding]): PlanningDocumentReference => ({
      id,
      instrumentId,
      title,
      sourceUrl: `${DOCUMENT_ROOT}/${id}`,
      binding: binding as PlanningDocumentReference['binding'],
    })
  ),
} as const;

export const BETANZOS_CURRENT_INSTRUMENT = BETANZOS_REGISTRY.instruments[0];
export const BETANZOS_NON_SPATIALLY_BOUND_INSTRUMENTS = BETANZOS_REGISTRY.instruments.filter(
  (item) =>
    item.status === 'catalogued_pending_spatial_validation' &&
    item.relationToCurrent !== 'predates_current_relation_unverified'
);
