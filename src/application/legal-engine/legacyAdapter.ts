import type { NormalizedParcelContext } from '@/domain/parcel-context/types'
import { createEvaluatedSituation, createUrbanisticFact } from '@/domain/legal-engine/factory'
import type { EvaluatedUrbanisticSituation, UrbanisticFact, UrbanisticFactKind } from '@/domain/legal-engine/types'
import type { UrbanisticFact as LegacyUrbanisticFact } from '@/domain/territorial-resolver/types'

export function adaptLegacyParcelContextToSituation(
  legacyContext: NormalizedParcelContext,
  situationId: string,
  referenceDate: string,
  expedienteId?: string
): EvaluatedUrbanisticSituation {
  const municipalityCode = legacyContext.municipality?.value?.ineCode || 'unknown'
  const cadastralRef = legacyContext.cadastralReference?.value

  return createEvaluatedSituation({
    id: situationId,
    referenceDate,
    expedienteId,
    jurisdiction: {
      municipalityCode,
      provinceCode: legacyContext.province?.value?.id
    },
    territorialScope: {
      id: cadastralRef || 'unknown-scope',
      type: 'parcel',
      cadastralReference: cadastralRef,
      description: legacyContext.address?.value
    }
  })
}

export function adaptLegacyFactToV2(
  legacyFact: LegacyUrbanisticFact<any>,
  factId: string,
  situationId: string,
  property: UrbanisticFactKind,
  createdAt: string
): UrbanisticFact | null {
  if (legacyFact.value === undefined || legacyFact.value === null) return null

  let stringValue = ''
  if (typeof legacyFact.value === 'string' || typeof legacyFact.value === 'number' || typeof legacyFact.value === 'boolean') {
    stringValue = String(legacyFact.value)
  } else if (legacyFact.value.code) {
    stringValue = String(legacyFact.value.code)
  } else {
    stringValue = JSON.stringify(legacyFact.value)
  }

  return createUrbanisticFact({
    id: factId,
    situationId,
    property,
    value: stringValue,
    createdAt
  })
}
