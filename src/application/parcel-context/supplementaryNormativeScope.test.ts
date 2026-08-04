import { describe, expect, it } from 'vitest'

import type { NormalizedParcelContext } from '@/domain/parcel-context/types'
import { resolveSupplementaryNormativeScope } from './supplementaryNormativeScope'

const context: NormalizedParcelContext = {
  knownConstraints: [
    {
      value: 'Carreteras: zona de protección',
      source: 'ideg',
      confidence: 0.95,
      verification: 'confirmed',
    },
  ],
  conflicts: [],
  pendingValidation: [],
}

describe('resolveSupplementaryNormativeScope', () => {
  it('limita una pregunta autonómica a documentos gallegos del catálogo global', () => {
    const scope = resolveSupplementaryNormativeScope(
      '¿Qué normativa autonómica resulta aplicable en Galicia?',
      context
    )

    expect(scope.retrieveMunicipal).toBe(false)
    expect(scope.layers).toEqual([
      expect.objectContaining({
        hierarchy: 'autonomico',
        source: 'v1_global_catalog',
        documentNames: expect.arrayContaining(['LSG CONSOLIDADA ENERO 2026- V2.pdf']),
      }),
    ])
  })

  it('dirige una pregunta CTE al corpus estatal V2 sin filtro municipal', () => {
    const scope = resolveSupplementaryNormativeScope(
      '¿Qué exigencias del CTE podrían afectar al proyecto?',
      context
    )

    expect(scope.retrieveMunicipal).toBe(false)
    expect(scope.layers).toEqual([
      expect.objectContaining({ hierarchy: 'estatal', source: 'v2', categories: ['CTE'] }),
    ])
  })

  it('activa normativa sectorial sólo cuando la afección correspondiente está confirmada', () => {
    const scope = resolveSupplementaryNormativeScope(
      '¿Qué régimen de carreteras resulta aplicable?',
      context
    )

    expect(scope.retrieveMunicipal).toBe(false)
    expect(scope.layers).toEqual([
      expect.objectContaining({ hierarchy: 'sectorial', source: 'v1_global_catalog' }),
    ])
  })

  it('no sustituye el bloque municipal en una pregunta paramétrica', () => {
    const scope = resolveSupplementaryNormativeScope(
      '¿Qué edificabilidad permite la normativa autonómica?',
      context
    )

    expect(scope.retrieveMunicipal).toBe(true)
    expect(scope.layers[0]?.hierarchy).toBe('autonomico')
  })
})
