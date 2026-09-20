import { describe, expect, it } from 'vitest'
import { validateAccreditedRealityOutput } from './accreditedRealityValidation'
import type { AccreditedRealityReasonerOutput } from './accreditedRealityTool'
import type { ApplicabilityResult, NormativeCandidate } from '@/domain/parcel-context/types'

const sources: NormativeCandidate[] = [
  { id: 'planning:evidence', sourceAliases: ['27891'], content: 'Instrumento oficial 27891', evidenceSpecificity: 'SPECIFIC' },
  { id: 'instrument-document:96582', sourceAliases: ['96582'], content: 'Documento oficial 96582', evidenceSpecificity: 'SPECIFIC' },
]
const applicability: ApplicabilityResult = {
  status: 'PARCIAL', applicable: sources, review: [], rejected: [], warnings: [], missingData: [], conflicts: [], canAnswerConcreteParameters: true,
}

function output(sourceRefs: string[], count = 1): AccreditedRealityReasonerOutput {
  return {
    answerMode: 'partial',
    missingFacts: [],
    claims: Array.from({ length: count }, (_, index) => ({
      id: `claim-${index}`,
      type: 'limitation' as const,
      text: 'La evidencia requiere revisión profesional.',
      sourceRefs,
      appliesToParcel: 'conditional' as const,
      numericTokens: [],
    })),
  }
}

describe('accredited reality stable source references', () => {
  it('accepts canonical document and instrument source IDs and preserves them in citations', () => {
    const result = validateAccreditedRealityOutput(output(['instrument-document:96582', 'planning:evidence']), sources, applicability)
    expect(result.invalidClaimReasonCounts.NON_EXISTENT_SOURCE).toBeUndefined()
    expect(result.validClaims).toHaveLength(1)
    expect(result.citations).toEqual(['instrument-document:96582', 'planning:evidence'])
  })

  it('accepts literal official aliases while normalizing them to stable IDs', () => {
    const result = validateAccreditedRealityOutput(output(['96582', '27891']), sources, applicability)
    expect(result.validClaims[0]?.sourceRefs).toEqual(['instrument-document:96582', 'planning:evidence'])
    expect(result.citations).toEqual(['instrument-document:96582', 'planning:evidence'])
  })

  it('rejects an invented source ID', () => {
    const result = validateAccreditedRealityOutput(output(['invented-source']), sources, applicability)
    expect(result.validClaims).toHaveLength(0)
    expect(result.invalidClaimReasonCounts.NON_EXISTENT_SOURCE).toBe(1)
  })

  it('does not make the legacy validator accept out-of-range positional references', () => {
    const result = validateAccreditedRealityOutput(output(['999999']), sources, applicability)
    expect(result.invalidClaimReasonCounts.NON_EXISTENT_SOURCE).toBe(1)
  })

  it('keeps nine equivalent claims out of NON_EXISTENT_SOURCE when all references exist', () => {
    const result = validateAccreditedRealityOutput(output(['instrument-document:96582'], 9), sources, applicability)
    expect(result.invalidClaimReasonCounts.NON_EXISTENT_SOURCE).toBeUndefined()
    expect(result.validClaims).toHaveLength(9)
  })
})
