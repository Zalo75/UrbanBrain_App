import { describe, expect, it } from 'vitest'
import { renderFactualComposerPlan } from './factualComposerRenderer'
import type { FactualComposerEvidence, FactualComposerPlan } from './factualComposerTypes'
import { sadaEvidence, sadaPlan } from './factualComposer.testFixtures'

describe('factualComposerRenderer', () => {
  it('renders Valdoviño full as totality without internal jargon', () => {
    const evidence: FactualComposerEvidence = {
      schemaVersion: '1', questionIntent: 'strict_homogeneity', scope: 'parcel',
      requestedFactTypes: ['category', 'coverage'],
      validatedFacts: [{
        id: 'category:parcel:SNRSC', type: 'category', scope: 'parcel', code: 'SNRSC',
        coverage: 'full', geometricDominance: false,
      }],
    }
    const plan: FactualComposerPlan = {
      schemaVersion: '1',
      conclusion: { kind: 'strictly_homogeneous', targetFactId: 'category:parcel:SNRSC' },
      explanation: [{ kind: 'territorial_coverage', factId: 'category:parcel:SNRSC' }],
      caveats: [], recommendedChecks: [],
    }

    const answer = renderFactualComposerPlan(plan, evidence)

    expect(answer).toContain('Sí. La categoría SNRSC afecta a toda la parcela.')
    expect(answer).toContain('100 %')
    expect(answer).not.toMatch(/scope|actionArea|coverage|factRef|automatic_confirmed|determination/i)
  })

  it('renders the Sada conclusion first, exact shares, dominance and one synthesized state caveat', () => {
    const answer = renderFactualComposerPlan(sadaPlan, sadaEvidence)

    expect(answer).toMatch(/^No puede considerarse/)
    expect(answer).toContain('98,53 %')
    expect(answer).toContain('1,47 %')
    expect(answer).toContain('claramente la categoría predominante')
    expect(answer.toLocaleLowerCase('es')).toContain('no puede considerarse estrictamente')
    expect(answer).not.toContain('toda la parcela es SNRC')
    expect(answer.match(/conflicto/g)).toHaveLength(1)
    expect(answer.match(/pendiente de resolución/g)).toHaveLength(1)
    expect(answer).not.toContain('efectiv')
  })

  it('renders actionArea identity and manual review without parcel leakage', () => {
    const evidence: FactualComposerEvidence = {
      schemaVersion: '1', questionIntent: 'category_identity', scope: 'actionArea',
      requestedFactTypes: ['classification', 'category', 'status', 'determination'],
      validatedFacts: [
        { id: 'classification:actionArea', type: 'classification', scope: 'actionArea', code: 'SNR', label: 'Suelo de Núcleo Rural', geometricDominance: false },
        { id: 'category:actionArea:SNRC', type: 'category', scope: 'actionArea', code: 'SNRC', label: 'Núcleo Rural Común', status: 'manual_review_required', determination: 'manual', geometricDominance: false },
      ],
    }
    const plan: FactualComposerPlan = {
      schemaVersion: '1', conclusion: { kind: 'category_identity' },
      explanation: [
        { kind: 'fact_identity', factId: 'classification:actionArea' },
        { kind: 'fact_identity', factId: 'category:actionArea:SNRC' },
      ],
      caveats: [
        { kind: 'manual_review_required', factId: 'category:actionArea:SNRC' },
        { kind: 'manual_determination', factId: 'category:actionArea:SNRC' },
      ],
      recommendedChecks: ['confirm_pending_determination'],
    }

    const answer = renderFactualComposerPlan(plan, evidence)
    expect(answer).toContain('El área seleccionada')
    expect(answer).toContain('Suelo de Núcleo Rural (SNR)')
    expect(answer).toContain('Núcleo Rural Común (SNRC)')
    expect(answer).toContain('revisión manual')
    expect(answer.match(/revisión manual/g)).toHaveLength(1)
    expect(answer).not.toContain('Conviene confirmar')
    expect(answer).not.toContain('SNRT')
    expect(answer).not.toContain('parcela completa')
  })

  it('renders parcel multicategory distribution without actionArea facts', () => {
    const evidence = { ...sadaEvidence, questionIntent: 'category_distribution' as const }
    const plan = { ...sadaPlan, conclusion: { kind: 'category_distribution' as const } }
    const answer = renderFactualComposerPlan(plan, evidence)
    expect(answer).toContain('La parcela completa presenta 2 categorías')
    expect(answer).toContain('98,53 %')
    expect(answer).toContain('1,47 %')
    expect(answer).not.toContain('área seleccionada')
  })

  it('renders classification-only without adding categories', () => {
    const evidence: FactualComposerEvidence = {
      schemaVersion: '1', questionIntent: 'classification_identity', scope: 'actionArea',
      requestedFactTypes: ['classification', 'status', 'determination'],
      validatedFacts: [{
        id: 'classification:actionArea', type: 'classification', scope: 'actionArea',
        code: 'SNR', label: 'Suelo de Núcleo Rural', status: 'manual_review_required',
        determination: 'manual', geometricDominance: false,
      }],
    }
    const plan: FactualComposerPlan = {
      schemaVersion: '1', conclusion: { kind: 'classification_identity' },
      explanation: [{ kind: 'fact_identity', factId: 'classification:actionArea' }],
      caveats: [
        { kind: 'manual_review_required', factId: 'classification:actionArea' },
        { kind: 'manual_determination', factId: 'classification:actionArea' },
      ],
      recommendedChecks: ['confirm_pending_determination'],
    }
    const answer = renderFactualComposerPlan(plan, evidence)
    expect(answer).toContain('clasificación Suelo de Núcleo Rural (SNR)')
    expect(answer).toContain('procede de revisión manual y todavía requiere revisión o confirmación')
    expect(answer.match(/revisión manual/g)).toHaveLength(1)
    expect(answer).not.toContain('Conviene confirmar')
    expect(answer).not.toContain('categoría')
  })

  it.each([
    ['automatic_confirmed', 'consta confirmada'],
    ['automatic_probable', 'todavía requiere confirmación'],
  ])('synthesizes automatic status + determination without duplication: %s', (status, expected) => {
    const evidence: FactualComposerEvidence = {
      schemaVersion: '1', questionIntent: 'classification_identity', scope: 'actionArea',
      requestedFactTypes: ['classification', 'status', 'determination'],
      validatedFacts: [{
        id: 'classification:actionArea', type: 'classification', scope: 'actionArea',
        code: 'SNR', status, determination: 'automatic', geometricDominance: false,
      }],
    }
    const plan: FactualComposerPlan = {
      schemaVersion: '1', conclusion: { kind: 'classification_identity' },
      explanation: [{ kind: 'fact_identity', factId: 'classification:actionArea' }],
      caveats: [
        { kind: 'automatic_status', factId: 'classification:actionArea' },
        { kind: 'automatic_determination', factId: 'classification:actionArea' },
      ],
      recommendedChecks: [],
    }
    const answer = renderFactualComposerPlan(plan, evidence)
    expect(answer).toContain(expected)
    expect(answer.match(/automáticamente/g)).toHaveLength(1)
    expect(answer).not.toContain('effective')
    expect(answer).not.toContain('verificada')
    if (status === 'automatic_probable') expect(answer).not.toContain('consta confirmada')
  })
})
