import { describe, expect, it } from 'vitest'
import {
  parseFactualComposerPlan,
  validateFactualComposerPlan,
} from './factualComposerSafety'
import { sadaEvidence, sadaPlan } from './factualComposer.testFixtures'
import type { FactualComposerEvidence, FactualComposerPlan } from './factualComposerTypes'

describe('factualComposerSafety', () => {
  it('accepts the complete, scoped Sada semantic plan', () => {
    expect(validateFactualComposerPlan(sadaPlan, sadaEvidence)).toEqual({ safe: true })
  })

  it('rejects a categorical 100% conclusion for the 98.53/1.47 distribution', () => {
    expect(validateFactualComposerPlan({
      ...sadaPlan,
      conclusion: { kind: 'strictly_homogeneous', targetFactId: 'category:parcel:SNRC' },
    }, sadaEvidence).safe).toBe(false)
  })

  it('rejects an invented category reference', () => {
    expect(validateFactualComposerPlan({
      ...sadaPlan,
      explanation: [...sadaPlan.explanation, { kind: 'category_share', factId: 'category:parcel:SUR' }],
    }, sadaEvidence).safe).toBe(false)
  })

  it('rejects omission of the residual category', () => {
    expect(validateFactualComposerPlan({
      ...sadaPlan,
      explanation: sadaPlan.explanation.filter((item) => item.factId !== 'category:parcel:SNRT'),
    }, sadaEvidence).safe).toBe(false)
  })

  it.each([
    ['conflict', sadaPlan.caveats.filter((item) => item.kind !== 'conflict')],
    ['unresolved', sadaPlan.caveats.filter((item) => item.kind !== 'unresolved')],
  ])('rejects omission of material %s state', (_state, caveats) => {
    expect(validateFactualComposerPlan({ ...sadaPlan, caveats }, sadaEvidence).safe).toBe(false)
  })

  it('rejects converting geometric dominance into an unsupported claim', () => {
    expect(parseFactualComposerPlan({
      ...sadaPlan,
      explanation: [{ kind: 'effective', factId: 'category:parcel:SNRC' }],
    })).toBeNull()
  })

  it.each(['error cartográfico', 'IVG', 'irrelevancia jurídica', 'retranqueo 3 m'])(
    'rejects free causal, technical or normative content: %s',
    (claim) => {
      expect(parseFactualComposerPlan({ ...sadaPlan, claim })).toBeNull()
    }
  )

  it('rejects a changed percentage because percentages are not model-controlled fields', () => {
    expect(parseFactualComposerPlan({
      ...sadaPlan,
      explanation: [{ kind: 'category_share', factId: 'category:parcel:SNRC', percentage: 100 }],
    })).toBeNull()
  })

  it('rejects actionArea facts inside a parcel plan', () => {
    expect(validateFactualComposerPlan({
      ...sadaPlan,
      explanation: [...sadaPlan.explanation, { kind: 'fact_identity', factId: 'category:actionArea:SNRC' }],
    }, sadaEvidence).safe).toBe(false)
  })

  it.each([
    ['manual_review_required', 'manual', 'manual_review_required', 'manual_determination'],
    ['automatic_confirmed', 'automatic', 'automatic_status', 'automatic_determination'],
  ] as const)('keeps both material state dimensions for %s + %s', (
    status, determination, statusKind, determinationKind
  ) => {
    const evidence: FactualComposerEvidence = {
      schemaVersion: '1', questionIntent: 'classification_identity', scope: 'actionArea',
      requestedFactTypes: ['classification', 'status', 'determination'],
      validatedFacts: [{
        id: 'classification:actionArea', type: 'classification', scope: 'actionArea',
        code: 'SNR', status, determination, geometricDominance: false,
      }],
    }
    const plan: FactualComposerPlan = {
      schemaVersion: '1', conclusion: { kind: 'classification_identity' },
      explanation: [{ kind: 'fact_identity', factId: 'classification:actionArea' }],
      caveats: [
        { kind: statusKind, factId: 'classification:actionArea' },
        { kind: determinationKind, factId: 'classification:actionArea' },
      ],
      recommendedChecks: [],
    }
    expect(validateFactualComposerPlan(plan, evidence)).toEqual({ safe: true })
    expect(validateFactualComposerPlan({ ...plan, caveats: plan.caveats.slice(0, 1) }, evidence).safe)
      .toBe(false)
  })
})
