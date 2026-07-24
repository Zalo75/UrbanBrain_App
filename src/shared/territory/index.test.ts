import { describe, expect, it } from 'vitest'

import { getProvinceByMunicipalityIneCode } from './index'

describe('getProvinceByMunicipalityIneCode', () => {
  it.each(['15009', '15031'])('resuelve %s como A Coruña', (municipalityIneCode) => {
    expect(getProvinceByMunicipalityIneCode(municipalityIneCode)?.id).toBe('a_coruna')
  })

  it('no infiere una provincia desde un INE ausente o inválido', () => {
    expect(getProvinceByMunicipalityIneCode(undefined)).toBeUndefined()
    expect(getProvinceByMunicipalityIneCode('1503')).toBeUndefined()
    expect(getProvinceByMunicipalityIneCode('15A31')).toBeUndefined()
  })
})
