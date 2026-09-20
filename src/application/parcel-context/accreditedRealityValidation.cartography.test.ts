import { describe, expect, it } from 'vitest'
import { validateAccreditedRealityOutput } from './accreditedRealityValidation'
import type { AccreditedRealityReasonerOutput } from './accreditedRealityTool'
const id = `cartographic-view:${'a'.repeat(64)}`
const sources = [{ id, content: 'Vista WMS: hipótesis', evidenceSpecificity: 'NON_SPECIFIC' as const }]
const applicability = { status: 'PARCIAL' as const, applicable: sources, review: [], rejected: [], warnings: [], missingData: [], conflicts: [], canAnswerConcreteParameters: false }
describe('images do not grant normative authority', () => {
  it('allows cited hypothesis limitations and blocks graphic-backed normative/parcel facts', () => {
    const output: AccreditedRealityReasonerOutput = { answerMode: 'partial', missingFacts: [], claims: [
      { id: 'hypothesis', type: 'limitation', text: 'La hipótesis requiere comprobación independiente.', sourceRefs: [id], appliesToParcel: 'unknown', numericTokens: [] },
      { id: 'normative', type: 'normative_fact', text: 'Ordenanza industrial.', sourceRefs: [id], appliesToParcel: 'unknown', numericTokens: [] },
      { id: 'parcel', type: 'parcel_conclusion', text: 'La parcela tiene ordenanza industrial.', sourceRefs: [id], appliesToParcel: true, numericTokens: [] },
    ] }
    const result = validateAccreditedRealityOutput(output, sources, applicability)
    expect(result.validClaims.map(claim => claim.id)).toEqual(['hypothesis'])
    expect(result.invalidClaimReasonCounts.GRAPHIC_NOT_NORMATIVE_EVIDENCE).toBe(2)
    expect(result.invalidClaimCount).toBe(2)
  })
})
