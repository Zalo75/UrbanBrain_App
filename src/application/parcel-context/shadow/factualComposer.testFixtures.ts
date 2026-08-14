import type { FactualComposerEvidence, FactualComposerPlan } from './factualComposerTypes'
import type { TerritorialFactualContract } from '@/domain/parcel-context/factualContract'
import type { StructuredFactualOutput } from './structuredFactualOutput'

export function createSadaContract(): TerritorialFactualContract {
  const classification = {
    code: 'SNR', label: 'Suelo de Núcleo Rural', semanticCompleteness: 'complete' as const,
    status: 'automatic_confirmed' as const, determination: 'automatic' as const,
  }
  const categories = [
    {
      code: 'SNRC', label: 'Núcleo Rural Común', semanticCompleteness: 'complete' as const,
      parcelPercentage: 98.53, status: 'conflict' as const, determination: 'unresolved' as const,
    },
    {
      code: 'SNRT', label: 'Núcleo Rural Tradicional', semanticCompleteness: 'complete' as const,
      parcelPercentage: 1.47, status: 'conflict' as const, determination: 'unresolved' as const,
    },
  ]
  const consolidation = { status: 'unresolved' as const, determination: 'unresolved' as const }
  const affects = { status: 'checked' as const, items: [] }
  return {
    identity: {}, scopes: { parcel: { hasGeometry: true } },
    factsByScope: { parcel: { classification, categories, consolidation, planningAreas: [], affects } },
    classification, categories, consolidation, planningAreas: [], affects, normativeReferences: {},
  }
}

export const sadaOutput: StructuredFactualOutput = {
  operations: [
    { operation: 'state_percentage', factRef: { type: 'category', scope: 'parcel', code: 'SNRC' }, percentage: 98.53 },
    { operation: 'state_geometric_dominance', factRef: { type: 'category', scope: 'parcel', code: 'SNRC' } },
    { operation: 'state_percentage', factRef: { type: 'category', scope: 'parcel', code: 'SNRT' }, percentage: 1.47 },
    { operation: 'state_conflict', factRef: { type: 'category', scope: 'parcel', code: 'SNRC' } },
    { operation: 'state_determination', factRef: { type: 'category', scope: 'parcel', code: 'SNRC' }, determination: 'unresolved' },
  ],
  abstentions: [],
}

export const sadaEvidence: FactualComposerEvidence = {
  schemaVersion: '1',
  questionIntent: 'strict_homogeneity',
  scope: 'parcel',
  requestedFactTypes: ['category', 'percentage', 'status', 'determination', 'geometricDominance'],
  validatedFacts: [
    {
      id: 'category:parcel:SNRC', type: 'category', scope: 'parcel', code: 'SNRC',
      label: 'Núcleo Rural Común', percentage: 98.53, status: 'conflict',
      determination: 'unresolved', geometricDominance: true,
    },
    {
      id: 'category:parcel:SNRT', type: 'category', scope: 'parcel', code: 'SNRT',
      label: 'Núcleo Rural Tradicional', percentage: 1.47, status: 'conflict',
      determination: 'unresolved', geometricDominance: false,
    },
  ],
}

export const sadaPlan: FactualComposerPlan = {
  schemaVersion: '1',
  conclusion: { kind: 'not_strictly_homogeneous', targetFactId: 'category:parcel:SNRC' },
  explanation: [
    { kind: 'category_share', factId: 'category:parcel:SNRC' },
    { kind: 'category_share', factId: 'category:parcel:SNRT' },
    { kind: 'geometric_dominance', factId: 'category:parcel:SNRC' },
  ],
  caveats: [
    { kind: 'conflict', factId: 'category:parcel:SNRC' },
    { kind: 'unresolved', factId: 'category:parcel:SNRC' },
  ],
  recommendedChecks: ['verify_minority_area'],
}
