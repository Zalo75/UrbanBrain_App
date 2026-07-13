import { describe, expect, it } from 'vitest'

import { buildNormalizedParcelContext } from './normalizeParcelContext'

describe('buildNormalizedParcelContext', () => {
  it('normaliza una referencia catastral válida y conserva su procedencia', () => {
    const context = buildNormalizedParcelContext({
      expediente: {
        refCatastral: '1234567-NH-4913-S-0001-AB',
        municipio: 'a_coruna',
        province: 'a_coruna',
        contextoValidadoPorTecnico: true,
      },
    })

    expect(context.cadastralReference).toMatchObject({
      value: '1234567NH4913S0001AB',
      source: 'expediente',
      verification: 'confirmed',
    })
    expect(context.municipality?.value.name).toBe('A Coruña')
  })

  it('conserva dirección y municipio resuelto desde el catálogo territorial', () => {
    const context = buildNormalizedParcelContext({
      expediente: { address: 'Rúa Real 1', municipio: 'arteixo', province: 'a_coruna' },
    })

    expect(context.address?.value).toBe('Rúa Real 1')
    expect(context.municipality?.value).toMatchObject({ name: 'Arteixo', ineCode: '15005' })
  })

  it('acepta coordenadas válidas y rechaza pares fuera de rango', () => {
    const valid = buildNormalizedParcelContext({
      expediente: { lat: 43.3623, lng: -8.4115, municipio: 'a_coruna' },
    })
    const invalid = buildNormalizedParcelContext({
      expediente: { lat: 143, lng: -8.4, municipio: 'a_coruna' },
    })

    expect(valid.coordinates?.value).toEqual({ lat: 43.3623, lng: -8.4115 })
    expect(invalid.coordinates).toBeUndefined()
  })

  it('declara exactamente que falta identificar la parcela', () => {
    const context = buildNormalizedParcelContext({ expediente: { municipio: 'a_coruna' } })

    expect(context.pendingValidation).toContain(
      'Falta identificar la parcela mediante referencia catastral, dirección o coordenadas.'
    )
  })

  it('reutiliza hechos afirmados por el usuario y no convierte preguntas en hechos', () => {
    const context = buildNormalizedParcelContext({
      expediente: { municipio: 'a_coruna' },
      userMessages: [
        'La referencia catastral es 1234567NH4913S0001AB.',
        '¿Puedes ayudarme? La ordenanza es Z-4.',
        '¿La clasificación es suelo urbano consolidado?',
      ],
    })

    expect(context.cadastralReference?.source).toBe('conversation')
    expect(context.qualification?.value).toBe('Z-4')
    expect(context.landClass).toBeUndefined()
  })

  it('marca el conflicto cuando Catastro y el expediente discrepan en municipio', () => {
    const context = buildNormalizedParcelContext({
      expediente: { municipio: 'arteixo', refCatastral: '1234567NH4913S0001AB' },
      detected: { municipalityName: 'A Coruña' },
    })

    expect(context.conflicts).toEqual(
      expect.arrayContaining([expect.objectContaining({ field: 'municipality' })])
    )
  })
})
