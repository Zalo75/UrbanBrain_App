import type { NormalizedParcelContext } from '@/domain/parcel-context/types'
import { createEvaluatedSituation } from '@/domain/legal-engine/factory'
import type { EvaluatedUrbanisticSituation } from '@/domain/legal-engine/types'

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
