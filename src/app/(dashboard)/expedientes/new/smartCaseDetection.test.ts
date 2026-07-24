import { describe, expect, it } from 'vitest'

import type { TerritorialResolution } from '@/domain/territorial-resolver/types'
import { allMunicipalities } from '@/shared/territory'

import {
  municipalitiesForProvince,
  summarizeSmartCaseDetection,
  validateSmartCaseSubmission,
} from './smartCaseDetection'

function resolution(overrides: Partial<TerritorialResolution> = {}): TerritorialResolution {
  return {
    status: 'confirmed',
    confidence: 'high',
    inputMethod: 'cadastral_reference',
    cadastralReference: '7709702NH4970N0001SZ',
    parcelReference: '7709702NH4970N',
    normalizedAddress: 'LG LEDOÑO CULLEREDO (A CORUÑA)',
    municipality: 'Culleredo',
    municipalityCode: '15031',
    province: 'A Coruña',
    coordinates: { lat: 43.316, lng: -8.336 },
    candidates: [],
    evidence: [{ source: 'catastro', sourceUrl: 'https://official.test', retrievedAt: '2026-07-20T00:00:00.000Z', method: 'fixture' }],
    warnings: [],
    conflicts: [],
    planning: {
      status: 'determined',
      instrument: 'Plan general trazable',
      classification: { code: 'SU', categoryCode: 'SUSC', label: 'Suelo urbano', sourceFeatureIds: ['class-1'] },
      evidence: [
        { source: 'siotuga', sourceUrl: 'https://official.test/instrument', retrievedAt: '2026-07-20T00:00:00.000Z', method: 'catálogo oficial', scope: 'planning_instrument' },
        { source: 'siotuga', sourceUrl: 'https://official.test/classification', retrievedAt: '2026-07-20T00:00:00.000Z', method: 'WFS oficial', scope: 'planning_classification' },
      ],
      warnings: [],
    },
    affects: {
      analysisGeometry: 'parcel',
      detected: [],
      canRuleOutUndetectedAffects: false,
      warnings: [],
      sourceChecks: [{ source: 'ideg', status: 'available', checkedAt: '2026-07-20T00:00:00.000Z', message: 'IDEG consultada' }],
    },
    resolvedAt: '2026-07-20T00:00:00.000Z',
    ...overrides,
  }
}

describe('smart case detection', () => {
  it('autoselecciona Culleredo por INE y mantiene RC completa y parcelaria', () => {
    const detected = summarizeSmartCaseDetection(resolution())

    expect(detected.detected).toMatchObject({
      municipalityId: 'culleredo',
      municipalityCode: '15031',
      cadastralReference: '7709702NH4970N0001SZ',
      parcelReference: '7709702NH4970N',
    })
  })

  it('expone la geometría parcelaria oficial en el modelo de presentación', () => {
    const parcelGeometry: TerritorialResolution['parcelGeometry'] = {
      type: 'MultiPolygon',
      crs: 'EPSG:4326',
      coordinates: [[[[-8.337, 43.315], [-8.336, 43.315], [-8.336, 43.316], [-8.337, 43.315]]]],
    }

    const detected = summarizeSmartCaseDetection(resolution({ parcelGeometry }))

    expect(detected.detected.parcelGeometry).toEqual(parcelGeometry)
  })

  it.each(['15009', '15031'])('confirma A Coruña desde el prefijo del INE %s aunque falte el texto provincial', (municipalityCode) => {
    const detected = summarizeSmartCaseDetection(resolution({
      municipalityCode,
      province: undefined,
    }))

    expect(detected.detected.provinceId).toBe('a_coruna')
    expect(detected.progress.find((item) => item.id === 'province')).toMatchObject({
      status: 'success',
      detail: 'A Coruña',
    })
  })

  it('usa la provincia oficial textual como respaldo cuando el INE no es válido', () => {
    const detected = summarizeSmartCaseDetection(resolution({
      municipality: undefined,
      municipalityCode: '1503',
      province: 'A Coruña',
    }))

    expect(detected.detected.provinceId).toBe('a_coruna')
    expect(detected.progress.find((item) => item.id === 'province')).toMatchObject({ status: 'success' })
  })

  it('filtra el selector municipal por provincia y rechaza combinaciones incompatibles', () => {
    const aCoruna = municipalitiesForProvince(allMunicipalities, 'a_coruna')
    expect(aCoruna.every((municipality) => municipality.provinceId === 'a_coruna')).toBe(true)
    expect(validateSmartCaseSubmission({ provinceId: 'lugo', municipalityId: 'culleredo' })).toBe('municipality_province_mismatch')
  })

  it('no marca como correcto lo no determinado y conserva un error IDEG como comprobación incompleta', () => {
    const detected = summarizeSmartCaseDetection(resolution({
      planning: { status: 'not_determined', evidence: [], warnings: [] },
      affects: {
        analysisGeometry: 'parcel',
        detected: [],
        canRuleOutUndetectedAffects: false,
        warnings: [],
        sourceChecks: [{ source: 'ideg', status: 'timeout', checkedAt: '2026-07-20T00:00:00.000Z', message: 'IDEG no responde' }],
      },
    }))

    expect(detected.progress.find((item) => item.id === 'planning')).toMatchObject({ status: 'not_determined' })
    expect(detected.progress.find((item) => item.id === 'classification')).toMatchObject({ status: 'not_determined' })
    expect(detected.progress.find((item) => item.id === 'affects')).toMatchObject({ status: 'incomplete' })
    expect(detected.progress.find((item) => item.id === 'affects')?.detail).not.toMatch(/sin afecciones/i)
  })

  it('no presenta como validada una ubicación probable resuelta sólo por CartoCiudad', () => {
    const detected = summarizeSmartCaseDetection(resolution({
      status: 'probable',
      confidence: 'medium',
      inputMethod: 'coordinates',
      cadastralReference: undefined,
      evidence: [{ source: 'cartociudad', sourceUrl: 'https://official.test/cartociudad', retrievedAt: '2026-07-20T00:00:00.000Z', method: 'fixture' }],
      planning: { status: 'not_determined', evidence: [], warnings: [] },
    }))

    for (const id of ['address', 'province', 'municipality', 'ine', 'coordinates']) {
      expect(detected.progress.find((item) => item.id === id)).toMatchObject({ status: 'pending' })
    }
    expect(detected.progress.find((item) => item.id === 'coordinates')?.detail).toMatch(/punto aportado/i)
    expect(detected.progress.some((item) => /validada|oficial/i.test(item.label))).toBe(false)
  })

  it('mantiene editables los valores urbanísticos sin permitir alterar la localización resuelta', () => {
    const detected = summarizeSmartCaseDetection(resolution())
    expect(validateSmartCaseSubmission({
      provinceId: 'a_coruna', municipalityId: 'culleredo', cadastralReference: '7709702NH4970N0001SZ',
      address: 'LG LEDOÑO CULLEREDO (A CORUÑA)', lat: 43.316, lng: -8.336,
      planeamiento: 'Plan general trazable', landClass: 'urbano_consolidado',
    }, detected)).toBeNull()
    expect(validateSmartCaseSubmission({
      provinceId: 'a_coruna', municipalityId: 'culleredo', cadastralReference: '7709702NH4970N0001SZ',
      address: 'LG LEDOÑO CULLEREDO (A CORUÑA)', lat: 43.316, lng: -8.336,
      planeamiento: 'Valor alterado', landClass: 'urbano_consolidado',
    }, detected)).toBeNull()
    expect(validateSmartCaseSubmission({
      provinceId: 'a_coruna', municipalityId: 'culleredo', cadastralReference: '7709702NH4970N0001SZ',
      address: 'Otra localización', lat: 43.316, lng: -8.336,
      planeamiento: 'Plan general trazable', landClass: 'urbano_consolidado',
    }, detected)).toBe('detection_mismatch')
  })

  it('muestra por separado el instrumento confirmado y la clasificación pendiente de Betanzos', () => {
    const detected = summarizeSmartCaseDetection(resolution({
      municipality: 'Betanzos',
      municipalityCode: '15009',
      planning: {
        status: 'partial',
        instrument: 'Texto refundido de las Normas Subsidiarias',
        evidence: [{ source: 'siotuga', sourceUrl: 'https://official.test/betanzos', retrievedAt: '2026-07-20T00:00:00.000Z', method: 'registro municipal', scope: 'planning_instrument' }],
        warnings: [],
      },
    }))

    expect(detected.progress.find((item) => item.id === 'planning')).toMatchObject({ status: 'success' })
    expect(detected.progress.find((item) => item.id === 'classification')).toMatchObject({ status: 'not_determined' })
    expect(detected.detected.planeamiento).toBe('Texto refundido de las Normas Subsidiarias')
    expect(detected.detected.landClass).toBeUndefined()
    expect(detected.detected.urbanPlanningZone).toBeUndefined()
  })

  it('mantiene Culleredo confirmado con SU normalizado y el código oficial SUSC trazable', () => {
    const detected = summarizeSmartCaseDetection(resolution())

    expect(detected.progress.find((item) => item.id === 'planning')).toMatchObject({ status: 'success' })
    expect(detected.progress.find((item) => item.id === 'classification')).toMatchObject({ status: 'success' })
    expect(detected.detected.landClass).toBe('urbano_consolidado')
    expect(detected.result.planning.classification?.categoryCode).toBe('SUSC')
  })

  it('confirma sólo el instrumento catalogado de Oleiros y mantiene desactivada la clasificación', () => {
    const detected = summarizeSmartCaseDetection(resolution({
      cadastralReference: '3995302NH5939N0001HQ',
      parcelReference: '3995302NH5939N',
      municipality: 'Oleiros',
      municipalityCode: '15058',
      planning: {
        status: 'determined',
        instrument: 'Plan general de ordenación municipal',
        evidence: [{ source: 'siotuga', sourceUrl: 'https://official.test/oleiros', retrievedAt: '2026-07-20T00:00:00.000Z', method: 'catálogo oficial', scope: 'planning_instrument' }],
        warnings: [{ code: 'planning_classification_pending_traceability', message: 'Capa no activada' }],
      },
    }))

    expect(detected.progress.find((item) => item.id === 'planning')).toMatchObject({ status: 'success' })
    expect(detected.progress.find((item) => item.id === 'classification')).toMatchObject({ status: 'not_determined' })
    expect(detected.detected.landClass).toBeUndefined()
  })
})
