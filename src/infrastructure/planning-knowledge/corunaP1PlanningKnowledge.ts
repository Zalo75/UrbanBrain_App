import type { PlanningDocumentReference } from '@/domain/territorial-resolver/types'

import {
  CORUNA_P1_DOCUMENT_CATALOG_GENERATED_AT,
  CORUNA_P1_DOCUMENT_CATALOG_SOURCE_SHA256,
  CORUNA_P1_DOCUMENTS_BY_INSTRUMENT,
} from './corunaP1PlanningDocuments.generated'

const VERIFIED_AT = '2026-07-29'

export const CORUNA_P1_KNOWLEDGE_VERSION = 'coruna-p1-2026-08-03.2'
export const CORUNA_P1_SOURCE_RELEASE_SHA256 =
  '3221caa2a74f52bd6bf612711bb1976e5aa797dbf1c6961f2c34e1feb3ed9b39'

const P1_RECORDS = [
  ['15002', 'Ames', 'PXOM', 'Plan general de ordenación municipal', '2002-06-28', '22184'],
  ['15008', 'Bergondo', 'NNSSPP', 'Normas subsidiarias de planeamiento', '1992-10-28', '23085'],
  ['15009', 'Betanzos', 'NNSSPP', 'Normas subsidiarias de planeamiento', '1996-06-27', '22221'],
  ['15011', 'Boiro', 'PXOM', 'Plan general de ordenación municipal', '2003-05-20', '22231'],
  ['15013', 'Brión', 'PXOM', 'Plan general de ordenación municipal', '2003-06-26', '22239'],
  ['15014', 'Cabana de Bergantiños', 'PXOM', 'Plan general de ordenación municipal', '1999-06-09', '22242'],
  ['15015', 'Cabanas', 'NNSSPP', 'Normas subsidiarias de planeamiento', '1987-11-13', '22244'],
  ['15016', 'Camariñas', 'PXOM', 'Plan general de ordenación municipal', '2012-12-26', '27721'],
  ['15020', 'Carnota', 'NNSSPP', 'Normas subsidiarias de planeamiento', '1996-06-08', '22269'],
  ['15021', 'Carral', 'NNSSPP', 'Normas subsidiarias de planeamiento', '1993-11-18', '22273'],
  ['15022', 'Cedeira', 'PXOU', 'Plan general de ordenación urbana', '1995-01-25', '22274'],
  ['15023', 'Cee', 'NNSSPP', 'Normas subsidiarias de planeamiento', '1995-02-23', '22279'],
  ['15025', 'Cerdido', 'PXOM', 'Plan general de ordenación municipal', '2006-07-21', '25927'],
  ['15028', 'Corcubión', 'NNSSPP', 'Normas subsidiarias de planeamiento', '1989-01-13', '22293'],
  ['15031', 'Culleredo', 'PXOU', 'Plan general de ordenación urbana', '1987-07-29', '22310'],
  ['15038', 'Frades', 'PXOM', 'Plan general de ordenación municipal', '2018-01-09', '28100'],
  ['15042', 'Lousame', 'PXOM', 'Plan general de ordenación municipal', '2004-12-29', '22366'],
  ['15043', 'Malpica de Bergantiños', 'NNSSPP', 'Normas subsidiarias de planeamiento', '1995-02-23', '22367'],
  ['15044', 'Mañón', 'PXOM', 'Plan general de ordenación municipal', '2016-05-18', '28004'],
  ['15045', 'Mazaricos', 'NNSSPP', 'Normas subsidiarias de planeamiento', '1995-05-04', '22373'],
  ['15046', 'Melide', 'NNSSPP', 'Normas subsidiarias de planeamiento', '1994-04-07', '22375'],
  ['15048', 'Miño', 'PXOM', 'Plan general de ordenación municipal', '2002-08-08', '22383'],
  ['15049', 'Moeche', 'NNSSPP', 'Normas subsidiarias de planeamiento', '1996-10-24', '22385'],
  ['15053', 'Muros', 'PXOM', 'Plan general de ordenación municipal', '2010-12-10', '22396'],
  ['15055', 'Neda', 'NNSSPP', 'Normas subsidiarias de planeamiento', '1992-07-22', '22402'],
  ['15057', 'Noia', 'NNSSPP', 'Normas subsidiarias de planeamiento', '1990-11-06', '22412'],
  ['15061', 'Ortigueira', 'NNSSPP', 'Normas subsidiarias de planeamiento', '1993-05-27', '22456'],
  ['15065', 'Padrón', 'PXOU', 'Plan general de ordenación urbana', '1994-07-27', '22464'],
  ['15072', 'Rianxo', 'NNSSPP', 'Normas subsidiarias de planeamiento', '1985-07-11', '22504'],
  ['15076', 'San Sadurniño', 'NNSSPP', 'Normas subsidiarias de planeamiento', '1992-03-23', '22515'],
  ['15080', 'Sobrado', 'PXOM', 'Plan general de ordenación municipal', '2009-04-08', '26732'],
  ['15085', 'Touro', 'PXOM', 'Plan general de ordenación municipal', '2010-02-09', '27322'],
  ['15087', 'Valdoviño', 'NNSSPP', 'Normas subsidiarias de planeamiento', '1993-10-28', '22544'],
  ['15093', 'Zas', 'PXOM', 'Plan general de ordenación municipal', '2007-09-07', '26250'],
] as const

const CLASSIFICATION_ATTRIBUTES = [
  'cat_homo',
  'cat_ley',
  'cat_plan',
  'cla_homo',
  'cla_ley',
  'denom',
  'edif_ficha',
  'estado',
  'geom_area',
  'id_recinto',
  'sup_ficha',
  'uso',
  'version',
] as const

export interface ActiveP1MunicipalityPlanning {
  municipalityCode: string
  municipalityName: string
  knowledgeVersion: string
  sourceReleaseSha256: string
  instrument: {
    officialId: string
    name: string
    approvalDate: string
    inventoryUrl: string
  }
  classificationLayer: {
    name: string
    attributes: readonly string[]
    capabilitiesUrl: string
  }
  documents: readonly PlanningDocumentReference[]
  documentCatalog: {
    generatedAt: string
    sourceSha256: string
  }
  activation: {
    status: 'active'
    technicalPattern: 'single_current_layer'
    verifiedAt: string
  }
  coverage: {
    classification: true
    category: true
    zoneOrOrdinance: false
    normativeDocument: boolean
    endToEndParameters: false
  }
}

export const CORUNA_P1_PLANNING_KNOWLEDGE: readonly ActiveP1MunicipalityPlanning[] =
  P1_RECORDS.map(([code, municipalityName, figure, instrumentName, approvalDate, officialId]) => {
    const documents = CORUNA_P1_DOCUMENTS_BY_INSTRUMENT[officialId] ?? []
    return {
      municipalityCode: code,
      municipalityName,
      knowledgeVersion: CORUNA_P1_KNOWLEDGE_VERSION,
      sourceReleaseSha256: CORUNA_P1_SOURCE_RELEASE_SHA256,
      instrument: {
        officialId,
        name: instrumentName,
        approvalDate,
        inventoryUrl: `https://siotuga.xunta.gal/siotuga/inventario.php?inv=1&idconcello=${code}`,
      },
      classificationLayer: {
        name: `_${code}_${figure}_${approvalDate.slice(0, 7).replace('-', '')}_AD_3CLAS_${officialId}`,
        attributes: CLASSIFICATION_ATTRIBUTES,
        capabilitiesUrl: `https://siotuga.xunta.gal/siotuga/ws?codine=${code}&SERVICE=WFS&VERSION=1.1.0&REQUEST=GetCapabilities`,
      },
      documents,
      documentCatalog: {
        generatedAt: CORUNA_P1_DOCUMENT_CATALOG_GENERATED_AT,
        sourceSha256: CORUNA_P1_DOCUMENT_CATALOG_SOURCE_SHA256,
      },
      activation: {
        status: 'active',
        technicalPattern: 'single_current_layer',
        verifiedAt: VERIFIED_AT,
      },
      coverage: {
        classification: true,
        category: true,
        zoneOrOrdinance: false,
        normativeDocument: documents.length > 0,
        endToEndParameters: false,
      },
    }
  })
