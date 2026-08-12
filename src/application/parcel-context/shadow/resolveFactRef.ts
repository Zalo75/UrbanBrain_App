import type {
  FactualAffect,
  FactualAffectsState,
  FactualCandidate,
  FactualCategory,
  FactualClassification,
  FactualConsolidation,
  FactualPlanningArea,
  TerritorialFactualContract,
} from '@/domain/parcel-context/factualContract'
import type { StructuredFactRef } from './structuredFactualOutput'

export type ResolvedFact =
  | FactualAffect
  | FactualAffectsState
  | FactualCandidate
  | FactualCategory
  | FactualClassification
  | FactualConsolidation
  | FactualPlanningArea

export type FactResolution =
  | { result: 'none' }
  | { result: 'one'; fact: ResolvedFact }
  | { result: 'ambiguous'; matchCount: number }

export function resolveFactRef(ref: StructuredFactRef, contract: TerritorialFactualContract): FactResolution {
  const scopeFacts = contract.factsByScope?.[ref.scope]
  if (!scopeFacts) return { result: 'none' }

  let matches: ResolvedFact[]

  switch (ref.type) {
    case 'classification':
      matches = scopeFacts.classification ? [scopeFacts.classification] : []
      break
    case 'category':
      matches = (scopeFacts.categories ?? []).filter((category) => category.code === ref.code)
      break
    case 'category_candidate':
      matches = (scopeFacts.categories ?? [])
        .filter((category) => category.code === ref.categoryCode)
        .flatMap((category) => (category.candidates ?? []).filter((candidate) => candidate.code === ref.candidateCode))
      break
    case 'consolidation':
      matches = scopeFacts.consolidation ? [scopeFacts.consolidation] : []
      break
    case 'planning_area':
      matches = (scopeFacts.planningAreas ?? []).filter((planningArea) => planningArea.code === ref.code)
      break
    case 'affect':
      matches = (scopeFacts.affects?.items ?? []).filter((affect) => affect.label === ref.label)
      break
    case 'affects_state':
      matches = scopeFacts.affects ? [scopeFacts.affects] : []
      break
  }

  if (matches.length === 0) return { result: 'none' }
  if (matches.length > 1) return { result: 'ambiguous', matchCount: matches.length }
  return { result: 'one', fact: matches[0] }
}
