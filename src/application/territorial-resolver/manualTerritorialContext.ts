import type {
  ManualAffectDecision,
  ManualTerritorialContext,
  TerritorialAffect,
  UrbanisticRegimeFacts,
} from '@/domain/territorial-resolver/types'

function normalized(value: string) {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLocaleLowerCase('es-ES')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
}

export function territorialAffectKey(
  affect: Pick<TerritorialAffect, 'category' | 'name' | 'featureId' | 'evidence'>
) {
  return affect.featureId
    ? `${affect.evidence.source}:${affect.featureId}`
    : `${affect.evidence.source}:${normalized(affect.category)}:${normalized(affect.name)}`
}

export function applyManualAffectDecisions(
  automatic: TerritorialAffect[],
  decisions: ManualAffectDecision[] = []
) {
  const latestByTarget = new Map<string, ManualAffectDecision>()
  for (const decision of decisions) {
    latestByTarget.set(decision.targetKey ?? decision.id, decision)
  }

  const effectiveAutomatic = automatic.filter((affect) => {
    const decision = latestByTarget.get(territorialAffectKey(affect))
    return decision?.action !== 'exclude'
  })
  const manualAdditions = [...latestByTarget.values()]
    .filter((decision) => decision.action === 'add')
    .map((decision): TerritorialAffect => ({
      category: decision.category,
      name: decision.name,
      featureId: decision.id,
      attributes: {
        manualDecisionId: decision.id,
        verification: decision.verification,
        reason: decision.reason,
      },
      evidence: {
        source: 'urbanbrain',
        sourceUrl: 'manual://territorial-context',
        retrievedAt: decision.recordedAt,
        method: 'selección manual del técnico',
        scope: 'affect',
      },
      confidence: decision.verification === 'technician_validated' ? 'high' : 'low',
    }))

  return {
    automatic,
    decisions: [...latestByTarget.values()],
    effective: [...effectiveAutomatic, ...manualAdditions],
  }
}

export function applyManualFactDecisions(
  automatic: UrbanisticRegimeFacts,
  manualContext?: ManualTerritorialContext
): {
  automatic: UrbanisticRegimeFacts
  decisions: NonNullable<ManualTerritorialContext['urbanisticFacts']>
  effective: UrbanisticRegimeFacts
} {
  const decisions = manualContext?.urbanisticFacts ?? {}
  const hasV2Decisions = Boolean(
    decisions.classification || decisions.category || decisions.consolidation
  )

  if (!hasV2Decisions) {
    return {
      automatic,
      decisions: {},
      effective: automatic,
    }
  }

  const effective: UrbanisticRegimeFacts = {
    classification: { ...automatic.classification },
    category: { ...automatic.category },
    consolidation: { ...automatic.consolidation },
  }

  // 1. Classification
  if (decisions.classification) {
    const mState = decisions.classification
    const label = mState.value.label ?? automatic.classification.label ?? mState.value.code
    effective.classification = {
      ...automatic.classification,
      value: { code: mState.value.code, label },
      label,
      status:
        mState.verification === 'technician_validated'
          ? 'technician_validated'
          : 'manual_review_required',
      origin: mState.origin,
      confidence: mState.verification === 'technician_validated' ? 'high' : 'medium',
      warnings: [
        ...automatic.classification.warnings,
        `Decisión manual (${mState.origin}): ${mState.reason}`,
      ],
    }
  }

  // 2. Category
  if (decisions.category) {
    const mState = decisions.category
    effective.category = {
      ...automatic.category,
      value: mState.value,
      label: mState.value.label ?? automatic.category.label,
      status:
        mState.verification === 'technician_validated'
          ? 'technician_validated'
          : 'manual_review_required',
      origin: mState.origin,
      confidence: mState.verification === 'technician_validated' ? 'high' : 'medium',
      warnings: [
        ...automatic.category.warnings,
        `Decisión manual (${mState.origin}): ${mState.reason}`,
      ],
    }
  }

  // 3. Consolidation
  if (decisions.consolidation) {
    const mState = decisions.consolidation
    const defaultLabel =
      mState.value.code === 'consolidated'
        ? 'Suelo urbano consolidado'
        : mState.value.code === 'unconsolidated'
          ? 'Suelo urbano no consolidado'
          : 'No aplicable'
    effective.consolidation = {
      ...automatic.consolidation,
      value: mState.value,
      label: mState.value.label ?? defaultLabel,
      status:
        mState.verification === 'technician_validated'
          ? 'technician_validated'
          : 'manual_review_required',
      origin: mState.origin,
      confidence: mState.verification === 'technician_validated' ? 'high' : 'medium',
      warnings: [
        ...automatic.consolidation.warnings,
        `Decisión manual (${mState.origin}): ${mState.reason}`,
      ],
    }
  }

  return {
    automatic,
    decisions,
    effective,
  }
}
