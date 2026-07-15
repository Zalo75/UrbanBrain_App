import { afterEach, describe, expect, it, vi } from 'vitest'

import type { ContextDetectionResult, Expediente } from '@/domain/context-engine/types'
import { CatastroDetector } from './CatastroDetector'

describe('CatastroDetector', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('resuelve municipio, provincia y dirección desde una referencia catastral usando un mock', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        text: vi.fn().mockResolvedValue(`
          <consulta>
            <np>A Coruña</np>
            <nm>Arteixo</nm>
            <tv>RÚA</tv>
            <nv>REAL</nv>
            <cv>1</cv>
          </consulta>
        `),
      })
    )
    const initial: ContextDetectionResult = {
      summary: {},
      rawResponses: {},
      errors: {},
      geometryStored: false,
      sourceApis: [],
    }

    const result = await new CatastroDetector().detect(
      { refCatastral: '1234567NH4913S0001AB' } as Expediente,
      initial
    )

    expect(result.summary).toMatchObject({
      provinceId: 'a_coruna',
      municipalityId: 'arteixo',
      provinceName: 'A Coruña',
      municipalityName: 'Arteixo',
      address: 'RÚA REAL 1',
    })
    expect(result.sourceApis).toEqual(['catastro'])
    expect(result.errors).toEqual({})
  })
})
