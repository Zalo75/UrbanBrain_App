import type { MunicipalitySuccessionKnowledge } from './types'

const OZA_CESURAS_SUCCESSION: MunicipalitySuccessionKnowledge = {
  currentMunicipalityCode: '15902',
  currentMunicipalityName: 'Oza-Cesuras',
  constitutedAt: '2013-06-06',
  legalBasis: {
    title:
      'Decreto 83/2013, de 6 de junio, por el que se constituye el municipio de Oza-Cesuras',
    officialUrl:
      'https://www.xunta.gal/dog/Publicados/2013/20130607/AnuncioG0244-060613-0003_es.html',
  },
  predecessors: [
    {
      municipalityCode: '15063',
      municipalityName: 'Oza dos Ríos',
      generalInstrumentId: '22459',
      generalInstrumentApprovalDate: '2001-10-29',
      classificationLayerName: '_15902_PXOM_200110_AD_3CLAS_22459',
      territorialScopeId: 'former-municipality-15063',
    },
    {
      municipalityCode: '15026',
      municipalityName: 'Cesuras',
      generalInstrumentId: '22287',
      generalInstrumentApprovalDate: '1997-03-03',
      classificationLayerName: '_15902_NNSSPP_199703_AD_3CLAS_22287',
      territorialScopeId: 'former-municipality-15026',
    },
  ],
}

const MUNICIPAL_SUCCESSIONS = new Map<string, MunicipalitySuccessionKnowledge>([
  [OZA_CESURAS_SUCCESSION.currentMunicipalityCode, OZA_CESURAS_SUCCESSION],
])

export function getMunicipalitySuccession(municipalityCode: string) {
  return MUNICIPAL_SUCCESSIONS.get(municipalityCode)
}
