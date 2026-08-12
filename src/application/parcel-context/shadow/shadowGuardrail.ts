import type { TerritorialFactualContract } from '@/domain/parcel-context/factualContract'

export interface GuardrailResult {
  valid: boolean
  reasons: string[]
}

export function validateShadowFactualResponse(
  answer: string,
  contract: TerritorialFactualContract
): GuardrailResult {
  const reasons: string[] = []
  const answerLower = answer.toLowerCase()

  // 1. Verificación de 'effective'
  const hasEffective = [
    contract.classification.determination,
    ...contract.categories.map(c => c.determination),
    contract.consolidation.determination,
    ...contract.planningAreas.map(c => c.determination),
    ...contract.affects.items.map(a => a.determination)
  ].includes('effective')

  const impliesEffective = /\b(efectivo|definitivo|r[eé]gimen aplicable es|legalmente aplicable)\b/i.test(answerLower)
  if (!hasEffective && impliesEffective) {
    reasons.push('FAIL_OVERCLAIM: La respuesta insinúa un régimen efectivo o definitivo cuando el contrato carece de determinación efectiva.')
  }

  // 2. Verificación de porcentajes
  const percentagesInAnswer = [...answer.matchAll(/(\d+(?:[.,]\d+)?)\s*%/g)].map(m => parseFloat(m[1].replace(',', '.')))
  const contractPercentages = contract.categories.map(c => c.parcelPercentage).filter(Boolean) as number[]
  
  for (const p of percentagesInAnswer) {
    const isExact = contractPercentages.includes(p)
    const isRounded = contractPercentages.some(cp => Math.round(cp) === Math.round(p))
    // We allow 100% as a trivial derivation
    if (!isExact && !isRounded && p !== 100) {
      reasons.push(`FAIL_FACTUAL: El porcentaje ${p}% mencionado no se encuentra explícitamente en el contrato factual.`)
    }
  }

  // 3. Evitar convertir 'unresolved' en resuelto
  const isClassificationUnresolved = contract.classification.status === 'unresolved' || contract.classification.determination === 'unresolved'
  if (isClassificationUnresolved) {
    // Regex estructural simple para detectar si de repente afirma "La clasificación es XYZ"
    const affirmsClassification = /clasificaci[oó]n\s+(?:es|:|corresponde a)\s+([A-Z]{2,})/i.test(answer)
    if (affirmsClassification) {
      reasons.push('FAIL_OVERCLAIM: Se afirma una clasificación específica pero el contrato está unresolved.')
    }
  }

  return {
    valid: reasons.length === 0,
    reasons
  }
}
