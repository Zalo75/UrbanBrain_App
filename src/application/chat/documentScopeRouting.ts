import {
  classifyParcelQuestionScope,
} from '@/application/parcel-context/applicabilityEngine'
import {
  canSearchDocumentScope,
  type NormativeSearchScope,
} from '@/application/parcel-context/normativeSearchScope'

export function requestsNormativeDocumentScope(question: string) {
  return /\b(?:normativa|documentos?|fuentes?|regulaci[oó]n|art[ií]culos?|apartados?|planeamiento|instrumentos?)\b/i.test(question)
}

/**
 * General/documentary retrieval may use the canonical instrument corpus
 * without a parcel-specific ordinance. Concrete parcel claims remain gated
 * later by applicability and response safety.
 */
export function shouldUseDocumentScope(
  question: string,
  scope: NormativeSearchScope,
  expectedMunicipalityCode?: string | null,
) {
  if (
    expectedMunicipalityCode &&
    scope.municipioCodigo !== expectedMunicipalityCode
  ) {
    return false
  }

  const questionScope = classifyParcelQuestionScope(question)
  const needsDocumentScope =
    questionScope !== 'independent' || requestsNormativeDocumentScope(question)

  return needsDocumentScope && canSearchDocumentScope(scope)
}
