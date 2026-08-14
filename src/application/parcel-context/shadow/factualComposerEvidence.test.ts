import { describe, expect, it } from 'vitest'
import { buildFactualComposerEvidence } from './factualComposerEvidence'
import { createSadaContract } from './factualComposer.testFixtures'
import type { StructuredFactualOutput } from './structuredFactualOutput'

function dualScopeContract() {
  const contract = createSadaContract()
  const classification = {
    code: 'SNR', label: 'Suelo de Núcleo Rural', semanticCompleteness: 'complete' as const,
    status: 'automatic_confirmed' as const, determination: 'automatic' as const,
  }
  const category = {
    code: 'SNRC', label: 'Núcleo Rural Común', semanticCompleteness: 'complete' as const,
    status: 'manual_review_required' as const, determination: 'manual' as const,
  }
  contract.scopes.actionArea = { hasGeometry: true }
  contract.factsByScope!.actionArea = {
    classification,
    categories: [category],
    consolidation: { status: 'unresolved', determination: 'unresolved' },
    planningAreas: [],
    affects: { status: 'checked', items: [] },
  }
  return contract
}

describe('buildFactualComposerEvidence', () => {
  it('builds actionArea category evidence without parcel facts', () => {
    const output: StructuredFactualOutput = {
      operations: [
        { operation: 'state_label', factRef: { type: 'classification', scope: 'actionArea' }, label: 'Suelo de Núcleo Rural' },
        { operation: 'state_label', factRef: { type: 'category', scope: 'actionArea', code: 'SNRC' }, label: 'Núcleo Rural Común' },
        { operation: 'state_status', factRef: { type: 'category', scope: 'actionArea', code: 'SNRC' }, status: 'manual_review_required' },
        { operation: 'state_determination', factRef: { type: 'category', scope: 'actionArea', code: 'SNRC' }, determination: 'manual' },
      ],
      abstentions: [],
    }
    const evidence = buildFactualComposerEvidence(
      '¿Qué categoría tiene el área seleccionada?', dualScopeContract(), output
    )
    expect(evidence?.scope).toBe('actionArea')
    expect(evidence?.validatedFacts.map((fact) => fact.id)).toEqual([
      'classification:actionArea', 'category:actionArea:SNRC',
    ])
    expect(JSON.stringify(evidence)).not.toContain('SNRT')
  })

  it('builds parcel distribution evidence without actionArea facts', () => {
    const output: StructuredFactualOutput = {
      operations: [
        { operation: 'state_percentage', factRef: { type: 'category', scope: 'parcel', code: 'SNRC' }, percentage: 98.53 },
        { operation: 'state_geometric_dominance', factRef: { type: 'category', scope: 'parcel', code: 'SNRC' } },
        { operation: 'state_percentage', factRef: { type: 'category', scope: 'parcel', code: 'SNRT' }, percentage: 1.47 },
      ],
      abstentions: [],
    }
    const evidence = buildFactualComposerEvidence(
      '¿Qué categorías existen en la parcela completa?', dualScopeContract(), output
    )
    expect(evidence?.scope).toBe('parcel')
    expect(evidence?.validatedFacts.map((fact) => fact.id)).toEqual([
      'category:parcel:SNRC', 'category:parcel:SNRT',
    ])
    expect(JSON.stringify(evidence)).not.toContain('actionArea')
  })

  it('classification-only excludes category operations even in the same scope', () => {
    const output: StructuredFactualOutput = {
      operations: [
        { operation: 'state_label', factRef: { type: 'classification', scope: 'actionArea' }, label: 'Suelo de Núcleo Rural' },
        { operation: 'state_label', factRef: { type: 'category', scope: 'actionArea', code: 'SNRC' }, label: 'Núcleo Rural Común' },
      ],
      abstentions: [],
    }
    const evidence = buildFactualComposerEvidence(
      '¿Qué clasificación tiene el área seleccionada?', dualScopeContract(), output
    )
    expect(evidence?.questionIntent).toBe('classification_identity')
    expect(evidence?.validatedFacts.map((fact) => fact.id)).toEqual(['classification:actionArea'])
    expect(JSON.stringify(evidence)).not.toContain('SNRC')
  })

  it('fails closed when validated operations mix scopes', () => {
    const output: StructuredFactualOutput = {
      operations: [
        { operation: 'state_label', factRef: { type: 'category', scope: 'actionArea', code: 'SNRC' }, label: 'Núcleo Rural Común' },
        { operation: 'state_percentage', factRef: { type: 'category', scope: 'parcel', code: 'SNRC' }, percentage: 98.53 },
      ],
      abstentions: [],
    }
    expect(buildFactualComposerEvidence(
      '¿Qué categoría tiene el área seleccionada?', dualScopeContract(), output
    )).toBeNull()
  })
})
