import type {
  FactualComposerEvidence,
  FactualComposerFact,
  FactualComposerPlan,
} from './factualComposerTypes'

function normalized(value: string) {
  return value.trim().replace(/\s+/g, ' ').toLocaleLowerCase('es')
}

function presentableLabel(fact: FactualComposerFact) {
  if (!fact.label || !fact.code) return fact.label
  return normalized(fact.label) === normalized(`Categoría homogénea oficial ${fact.code}`)
    ? undefined
    : fact.label
}

function renderIdentity(fact: FactualComposerFact) {
  const label = presentableLabel(fact)
  if (label && fact.code && normalized(label) !== normalized(fact.code)) {
    return `${label} (${fact.code})`
  }
  return label ?? fact.code ?? 'sin identificación disponible'
}

function formatPercentage(value: number) {
  return new Intl.NumberFormat('es-ES', {
    minimumFractionDigits: Number.isInteger(value) ? 0 : 2,
    maximumFractionDigits: 2,
    useGrouping: false,
  }).format(value)
}

function scopeSubject(scope: FactualComposerEvidence['scope']) {
  return scope === 'actionArea' ? 'El área seleccionada' : 'La parcela completa'
}

function joinSpanish(items: string[]) {
  if (items.length <= 1) return items[0] ?? ''
  return `${items.slice(0, -1).join(', ')} y ${items.at(-1)}`
}

function renderIdentityConclusion(
  evidence: FactualComposerEvidence,
  classification: FactualComposerFact | undefined,
  categories: FactualComposerFact[]
) {
  const subject = scopeSubject(evidence.scope)
  if (evidence.questionIntent === 'classification_identity' && classification) {
    return `${subject} tiene la clasificación ${renderIdentity(classification)}.`
  }
  if (classification && categories.length > 0) {
    const renderedCategories = joinSpanish(categories.map(renderIdentity))
    return `${subject} está identificada como ${renderIdentity(classification)}, categoría ${renderedCategories}.`
  }
  if (categories.length > 0) {
    return `${subject} tiene la categoría ${joinSpanish(categories.map(renderIdentity))}.`
  }
  return ''
}

function renderDistribution(
  categories: FactualComposerFact[],
  scope: FactualComposerEvidence['scope'],
  dominant?: FactualComposerFact
) {
  const shares = categories
    .filter((fact) => fact.percentage !== undefined || fact.coverage !== undefined)
    .sort((left, right) => (right.percentage ?? 0) - (left.percentage ?? 0))
    .map((fact) => {
      if (fact.percentage !== undefined) {
        return `un ${formatPercentage(fact.percentage)} % como ${renderIdentity(fact)}`
      }
      if (fact.coverage === 'full') {
        return scope === 'parcel'
          ? `un 100 % como ${renderIdentity(fact)}, que afecta a toda la parcela`
          : `un 100 % como ${renderIdentity(fact)}, que afecta a toda el área seleccionada`
      }
      if (fact.coverage === 'partial') return `${renderIdentity(fact)} solo en una parte`
      return `${renderIdentity(fact)} con extensión aún no determinada`
    })
  if (shares.length === 0) return ''
  const dominance = dominant
    ? `, por lo que ${renderIdentity(dominant)} es claramente la categoría predominante`
    : ''
  return `El análisis territorial identifica ${joinSpanish(shares)}${dominance}.`
}

function renderStateCaveat(plan: FactualComposerPlan, evidence: FactualComposerEvidence) {
  const kinds = new Set(plan.caveats.map((item) => item.kind))
  const conflict = kinds.has('conflict')
  const unresolved = kinds.has('unresolved')
  const manualReview = kinds.has('manual_review_required')
  const manualDetermination = kinds.has('manual_determination')
  const automaticStatus = kinds.has('automatic_status')
  const automaticDetermination = kinds.has('automatic_determination')

  if (conflict && unresolved) {
    return 'La información territorial presenta un conflicto y la determinación global permanece pendiente de resolución.'
  }
  if (conflict) return 'La información territorial presenta un conflicto pendiente de resolución.'
  if (manualReview && manualDetermination) {
    return 'La determinación procede de revisión manual y todavía requiere revisión o confirmación.'
  }
  if (manualReview) return 'El estado factual todavía requiere revisión o confirmación.'
  if (manualDetermination) return 'La determinación procede de revisión manual.'
  if (unresolved) return 'La determinación permanece pendiente de resolución.'
  if (automaticStatus && automaticDetermination) {
    const facts = new Map(evidence.validatedFacts.map((fact) => [fact.id, fact]))
    const automaticStatusFacts = plan.caveats
      .filter((item) => item.kind === 'automatic_status')
      .map((item) => facts.get(item.factId))
      .filter((fact): fact is FactualComposerFact => Boolean(fact))
    if (
      automaticStatusFacts.length > 0 &&
      automaticStatusFacts.every((fact) => fact.status === 'automatic_confirmed')
    ) {
      return 'La determinación se obtuvo automáticamente y consta confirmada.'
    }
    return 'La determinación se obtuvo automáticamente y todavía requiere confirmación.'
  }
  if (automaticDetermination) return 'La determinación se obtuvo automáticamente.'
  if (automaticStatus) return 'El estado procede de una determinación automática.'
  return ''
}

export function renderFactualComposerPlan(
  plan: FactualComposerPlan,
  evidence: FactualComposerEvidence
): string {
  const facts = new Map(evidence.validatedFacts.map((fact) => [fact.id, fact]))
  const categories = evidence.validatedFacts.filter((fact) => fact.type === 'category')
  const classification = evidence.validatedFacts.find((fact) => fact.type === 'classification')
  const dominant = evidence.validatedFacts.find((fact) => fact.geometricDominance)
  const paragraphs: string[] = []

  if (plan.conclusion.kind === 'not_strictly_homogeneous') {
    const target = plan.conclusion.targetFactId
      ? facts.get(plan.conclusion.targetFactId)
      : undefined
    if (target) {
      paragraphs.push(
        `No puede considerarse estrictamente que el 100 % de la parcela sea ${renderIdentity(target)}.`
      )
    }
  } else if (plan.conclusion.kind === 'strictly_homogeneous') {
    const target = plan.conclusion.targetFactId
      ? facts.get(plan.conclusion.targetFactId)
      : undefined
    if (target) paragraphs.push(`Sí. La categoría ${renderIdentity(target)} afecta a toda la parcela.`)
  } else if (plan.conclusion.kind === 'category_distribution') {
    const count = categories.length
    paragraphs.push(
      `${scopeSubject(evidence.scope)} presenta ${count === 1 ? 'una categoría urbanística' : `${count} categorías urbanísticas`}.`
    )
  } else if (
    plan.conclusion.kind === 'category_identity' ||
    plan.conclusion.kind === 'classification_identity'
  ) {
    paragraphs.push(renderIdentityConclusion(evidence, classification, categories))
  } else if (plan.conclusion.kind === 'state_summary') {
    paragraphs.push(`El estado territorial de ${scopeSubject(evidence.scope).toLocaleLowerCase('es')} requiere una lectura matizada.`)
  }

  if (
    plan.conclusion.kind === 'not_strictly_homogeneous' ||
    plan.conclusion.kind === 'strictly_homogeneous' ||
    plan.conclusion.kind === 'category_distribution'
  ) {
    paragraphs.push(renderDistribution(categories, evidence.scope, dominant))
  }

  const stateCaveat = renderStateCaveat(plan, evidence)
  paragraphs.push(stateCaveat)
  if (plan.recommendedChecks.includes('verify_minority_area')) {
    paragraphs.push('Conviene verificar la porción minoritaria antes de tratar la parcela como urbanísticamente homogénea.')
  } else if (plan.recommendedChecks.includes('confirm_pending_determination') && !stateCaveat) {
    paragraphs.push('Conviene confirmar la determinación pendiente antes de adoptar una conclusión definitiva.')
  }

  return paragraphs.map((paragraph) => paragraph.trim()).filter(Boolean).join('\n\n')
}
