import type { TerritorialFactualContract } from '@/domain/parcel-context/factualContract'
import type {
  StructuredFactualOutput,
  StructuredFactRef,
  StructuredFactScope,
  StructuredOperation,
} from './structuredFactualOutput'
import { resolveFactRef } from './resolveFactRef'
import type { ResolvedFact } from './resolveFactRef'

type IdentityOperation = Extract<StructuredOperation, { operation: 'reference_code' | 'state_label' }>

interface ResolvedOperation {
  operation: StructuredOperation
  fact: ResolvedFact
  factKey: string
  index: number
}

interface IdentityGroup {
  scope: StructuredFactScope
  firstIndex: number
  classification?: ResolvedOperation
  categories: Map<string, ResolvedOperation>
}

function getFactName(ref: StructuredFactRef, capitalize = true): string {
  const name = (() => {
    switch (ref.type) {
      case 'classification': return 'la clasificación'
      case 'category': return 'la categoría'
      case 'category_candidate': return 'la subcategoría'
      case 'consolidation': return 'la consolidación'
      case 'planning_area': return 'el ámbito de planeamiento'
      case 'affect': return 'la afección'
      case 'affects_state': return 'las afecciones'
    }
  })()
  return capitalize ? name.charAt(0).toUpperCase() + name.slice(1) : name
}

function renderScope(scope: StructuredFactScope): string {
  return scope === 'parcel' ? 'en toda la parcela' : 'en el área de actuación'
}

function renderPercentageScope(scope: StructuredFactScope): string {
  return scope === 'parcel' ? 'de la parcela' : 'del área de actuación'
}

function getFactKey(ref: StructuredFactRef): string {
  return JSON.stringify(ref)
}

function getFactIdentity(fact: ResolvedFact): { code?: string; label?: string } {
  const code = 'code' in fact && fact.code ? fact.code : undefined
  const isComplete = 'semanticCompleteness' in fact && fact.semanticCompleteness === 'complete'
  const label = 'label' in fact && isComplete && typeof fact.label === 'string' && fact.label.length > 0
    ? fact.label
    : undefined

  return { code, label }
}

function renderLabelAndCode(fact: ResolvedFact): string | undefined {
  const { code, label } = getFactIdentity(fact)
  if (label && code) return `${label} (${code})`
  return label ?? code
}

function renderNamedFact(ref: StructuredFactRef, fact: ResolvedFact, capitalize = true): string {
  const name = getFactName(ref, capitalize)
  const { code, label } = getFactIdentity(fact)
  if (label) return `${name} ${code ? `${label} (${code})` : label}`
  if (code) return `${name} con código ${code}`
  return name
}

function selectIdentityOperation(
  current: ResolvedOperation | undefined,
  candidate: ResolvedOperation
): ResolvedOperation {
  if (!current || candidate.operation.operation === 'state_label') return candidate
  return current
}

function renderStandaloneIdentity(entry: ResolvedOperation): string {
  const operation = entry.operation as IdentityOperation
  const factNameLower = getFactName(operation.factRef, false)
  const scopeText = renderScope(operation.factRef.scope)
  const { code, label } = getFactIdentity(entry.fact)

  if (operation.operation === 'reference_code') {
    if (!code) throw new Error('Renderer error: code is undefined for reference_code')
    return `Se ha identificado que ${factNameLower} ${scopeText} incluye el código ${code}.`
  }
  if (label) {
    return `Se ha identificado ${factNameLower} ${code ? `${label} (${code})` : label} ${scopeText}.`
  }
  if (code) return `Se ha identificado ${factNameLower} con código ${code} ${scopeText}.`
  return `Se ha identificado ${factNameLower} ${scopeText}.`
}

function renderIdentityGroup(group: IdentityGroup): string[] {
  const categories = [...group.categories.values()].sort((left, right) => left.index - right.index)

  if (!group.classification || categories.length === 0) {
    return [group.classification, ...categories]
      .filter((entry): entry is ResolvedOperation => entry !== undefined)
      .sort((left, right) => left.index - right.index)
      .map(renderStandaloneIdentity)
  }

  const subject = group.scope === 'parcel' ? 'La parcela' : 'El área de actuación seleccionada'
  const classificationIdentity = getFactIdentity(group.classification.fact)
  const classificationValue = group.classification.operation.operation === 'state_label' && classificationIdentity.label
    ? renderLabelAndCode(group.classification.fact)!
    : classificationIdentity.code
      ? `clasificación con código ${classificationIdentity.code}`
      : undefined

  const categoryValues = categories.map((entry) => {
    const identity = getFactIdentity(entry.fact)
    if (entry.operation.operation === 'state_label' && identity.label) {
      return renderLabelAndCode(entry.fact)!
    }
    return identity.code ? `con código ${identity.code}` : undefined
  })

  if (!classificationValue || categoryValues.some((value) => value === undefined)) {
    return [group.classification, ...categories]
      .sort((left, right) => left.index - right.index)
      .map(renderStandaloneIdentity)
  }

  const renderedCategoryValues = categoryValues as string[]

  if (renderedCategoryValues.length === 1) {
    return [`${subject} está identificada como ${classificationValue}, categoría ${renderedCategoryValues[0]}.`]
  }

  const lastCategory = renderedCategoryValues.at(-1)!
  const precedingCategories = renderedCategoryValues.slice(0, -1).join(', ')
  return [
    `${subject} está identificada como ${classificationValue}, con las categorías ${precedingCategories} y ${lastCategory}.`,
  ]
}

function getSemanticOperationKey(entry: ResolvedOperation): string {
  const operation = entry.operation
  if (operation.operation === 'state_conflict') return `state:conflict:${entry.factKey}`
  if (operation.operation === 'state_unresolved') return `state:unresolved:${entry.factKey}`
  if (operation.operation === 'state_status' && operation.status === 'conflict') {
    return `state:conflict:${entry.factKey}`
  }
  if (operation.operation === 'state_status' && operation.status === 'unresolved') {
    return `state:unresolved:${entry.factKey}`
  }
  return `${operation.operation}:${entry.factKey}`
}

function renderStatus(status: string, factNameLower: string, scopeText: string): string {
  switch (status) {
    case 'automatic_confirmed':
      return `El estado de ${factNameLower} ${scopeText} está confirmado automáticamente.`
    case 'automatic_probable':
      return `El estado de ${factNameLower} ${scopeText} procede de una determinación automática pendiente de confirmación.`
    case 'manual_review_required':
      return `El estado de ${factNameLower} ${scopeText} requiere revisión manual antes de confirmarse.`
    case 'manual_confirmed':
      return `El estado de ${factNameLower} ${scopeText} ha sido confirmado mediante revisión manual.`
    case 'technician_validated':
      return `El estado de ${factNameLower} ${scopeText} ha sido validado por personal técnico.`
    case 'conflict':
      return `El estado de ${factNameLower} ${scopeText} presenta un conflicto pendiente de resolver.`
    case 'unresolved':
      return `El estado de ${factNameLower} ${scopeText} no está resuelto.`
    case 'checked':
      return `El estado de ${factNameLower} ${scopeText} ha sido verificado.`
    case 'effective':
      return `El estado de ${factNameLower} ${scopeText} es efectivo.`
    case 'not_available':
      return `No hay información disponible sobre el estado de ${factNameLower} ${scopeText}.`
    case 'source_unavailable':
      return `No está disponible la fuente necesaria para determinar el estado de ${factNameLower} ${scopeText}.`
    case 'not_applicable':
      return `El estado de ${factNameLower} ${scopeText} no resulta aplicable.`
    default:
      return `El estado de ${factNameLower} ${scopeText} consta como ${status}.`
  }
}

function renderDetermination(determination: string, factNameLower: string, scopeText: string): string {
  switch (determination) {
    case 'automatic':
      return `La determinación de ${factNameLower} ${scopeText} se ha obtenido automáticamente.`
    case 'manual':
      return `La determinación de ${factNameLower} ${scopeText} procede de revisión manual.`
    case 'unresolved':
      return `La determinación de ${factNameLower} ${scopeText} no está resuelta.`
    case 'effective':
      return `La determinación de ${factNameLower} ${scopeText} es efectiva.`
    default:
      return `La determinación de ${factNameLower} ${scopeText} consta como ${determination}.`
  }
}

export function renderFactualOutput(output: StructuredFactualOutput, contract: TerritorialFactualContract): string[] {
  const lines: string[] = []
  const resolvedOperations: ResolvedOperation[] = output.operations.map((operation, index) => {
    const resolution = resolveFactRef(operation.factRef, contract)

    if (resolution.result !== 'one') {
      throw new Error(`Renderer error: FactRef resolution failed with ${resolution.result} for ${JSON.stringify(operation.factRef)}`)
    }

    return { operation, fact: resolution.fact, factKey: getFactKey(operation.factRef), index }
  })

  const identityGroups = new Map<StructuredFactScope, IdentityGroup>()
  const identityOperationIndexes = new Set<number>()

  for (const entry of resolvedOperations) {
    const { operation } = entry
    const isIdentityOperation = operation.operation === 'reference_code' || operation.operation === 'state_label'
    const isComposableFact = operation.factRef.type === 'classification' || operation.factRef.type === 'category'
    if (!isIdentityOperation || !isComposableFact) continue

    const scope = operation.factRef.scope
    const group = identityGroups.get(scope) ?? {
      scope,
      firstIndex: entry.index,
      categories: new Map<string, ResolvedOperation>(),
    }
    group.firstIndex = Math.min(group.firstIndex, entry.index)
    identityOperationIndexes.add(entry.index)

    if (operation.factRef.type === 'classification') {
      group.classification = selectIdentityOperation(group.classification, entry)
    } else {
      group.categories.set(entry.factKey, selectIdentityOperation(group.categories.get(entry.factKey), entry))
    }
    identityGroups.set(scope, group)
  }

  const identityGroupsByFirstIndex = new Map(
    [...identityGroups.values()].map((group) => [group.firstIndex, group])
  )
  const dominanceFactKeys = new Set(
    resolvedOperations
      .filter((entry) => entry.operation.operation === 'state_geometric_dominance')
      .map((entry) => entry.factKey)
  )
  const emittedSemanticOperations = new Set<string>()
  let renderedActionAreaClarification = false

  const pushOperationLines = (newLines: string[], scope: StructuredFactScope) => {
    lines.push(...newLines)
    if (scope === 'actionArea' && !renderedActionAreaClarification) {
      lines.push('Esta conclusión se refiere al área seleccionada y no implica necesariamente que toda la parcela catastral tenga el mismo régimen.')
      renderedActionAreaClarification = true
    }
  }

  const pushOperationLine = (line: string, scope: StructuredFactScope) => {
    pushOperationLines([line], scope)
  }

  for (const entry of resolvedOperations) {
    const identityGroup = identityGroupsByFirstIndex.get(entry.index)
    if (identityGroup) {
      pushOperationLines(renderIdentityGroup(identityGroup), identityGroup.scope)
    }
    if (identityOperationIndexes.has(entry.index)) continue

    const op = entry.operation
    const fact = entry.fact
    if (op.operation === 'state_percentage' && dominanceFactKeys.has(entry.factKey)) continue

    const semanticKey = getSemanticOperationKey(entry)
    if (emittedSemanticOperations.has(semanticKey)) continue
    emittedSemanticOperations.add(semanticKey)

    const factNameCapitalized = getFactName(op.factRef, true)
    const factNameLower = getFactName(op.factRef, false)
    const scopeText = renderScope(op.factRef.scope)
    const percentageScopeText = renderPercentageScope(op.factRef.scope)
    const { code, label } = getFactIdentity(fact)
    const labelText = renderLabelAndCode(fact)

    switch (op.operation) {
      case 'reference_code':
      case 'state_label':
        pushOperationLine(renderStandaloneIdentity(entry), op.factRef.scope)
        break
      case 'state_percentage':
        if ('parcelPercentage' in fact && fact.parcelPercentage !== undefined) {
          const pct = String(fact.parcelPercentage).replace('.', ',')
          if (label) {
            pushOperationLine(`${factNameCapitalized} ${labelText} representa el ${pct} % ${percentageScopeText}.`, op.factRef.scope)
          } else if (code) {
            pushOperationLine(`${factNameCapitalized} con código ${code} representa el ${pct} % ${percentageScopeText}.`, op.factRef.scope)
          }
        }
        break
      case 'state_status':
        if ('status' in fact) {
          // Hardening: no producir 'effective' si el fact.status !== effective
          if (op.status === 'effective' && (fact.status as string) !== 'effective') {
            throw new Error(`Renderer error: Cannot render effective status because fact.status is ${fact.status}`)
          }
          const status = fact.status as string
          pushOperationLine(renderStatus(status, factNameLower, scopeText), op.factRef.scope)
        }
        break
      case 'state_determination':
        if ('determination' in fact) {
          if (op.determination === 'effective' && fact.determination !== 'effective') {
             throw new Error(`Renderer error: Cannot render effective determination because fact.determination is ${fact.determination}`)
          }
          const det = fact.determination as string
          pushOperationLine(renderDetermination(det, factNameLower, scopeText), op.factRef.scope)
        }
        break
      case 'state_geometric_dominance':
        if ('parcelPercentage' in fact && fact.parcelPercentage !== undefined) {
          const pct = String(fact.parcelPercentage).replace('.', ',')
          if (label) {
            pushOperationLine(`${factNameCapitalized} ${labelText} representa el ${pct} % ${percentageScopeText} y es la de mayor presencia geométrica.`, op.factRef.scope)
          } else if (code) {
            pushOperationLine(`${factNameCapitalized} con código ${code} representa el ${pct} % ${percentageScopeText} y es la de mayor presencia geométrica.`, op.factRef.scope)
          }
        }
        break
      case 'state_conflict':
        pushOperationLine(`${renderNamedFact(op.factRef, fact)} ${scopeText} presenta un conflicto pendiente de resolución.`, op.factRef.scope)
        break
      case 'state_unresolved':
        pushOperationLine(`La información sobre ${renderNamedFact(op.factRef, fact, false)} ${scopeText} no está resuelta.`, op.factRef.scope)
        break
      case 'state_absence':
        // Hardening: Ausencia confirmada
        if ('status' in fact) {
          if (fact.status === 'unresolved' || fact.status === 'conflict') {
            throw new Error(`Renderer error: Cannot state absence for unresolved/conflict status`)
          }
        }
        if ('determination' in fact && fact.determination === 'unresolved') {
          throw new Error(`Renderer error: Cannot state absence for unresolved determination`)
        }
        // Colección explícita vacía para affects
        if (op.factRef.type === 'affects_state') {
          if ('items' in fact && fact.items.length > 0) {
            throw new Error(`Renderer error: Cannot state absence when items exist`)
          }
          if ('status' in fact && fact.status !== 'checked') {
            throw new Error(`Renderer error: Cannot state absence when status is not checked`)
          }
        }
        pushOperationLine(`No se registra la presencia de ${factNameLower} ${scopeText}.`, op.factRef.scope)
        break
    }
  }

  for (const abs of output.abstentions) {
    if (abs.factRef) {
      const resolution = resolveFactRef(abs.factRef, contract)
      if (resolution.result !== 'one') {
        throw new Error(`Renderer error: FactRef resolution failed with ${resolution.result} for ${JSON.stringify(abs.factRef)}`)
      }
    }
    const scopeText = abs.factRef ? renderScope(abs.factRef.scope) : ''
    const factNameLower = abs.factRef ? getFactName(abs.factRef, false) : 'el hecho'

    switch (abs.cause) {
      case 'missing_label':
        lines.push(abs.factRef ? `No se dispone de la denominación completa para ${factNameLower} ${scopeText}.` : `No se dispone de la denominación completa.`)
        break
      case 'unresolved_fact':
        lines.push(abs.factRef ? `No se ha podido determinar con los datos disponibles la información sobre ${factNameLower} ${scopeText}.` : `No se ha podido determinar con los datos disponibles la información solicitada.`)
        break
      case 'conflict':
        lines.push(abs.factRef ? `Existe un conflicto en los datos oficiales respecto a ${factNameLower} ${scopeText}.` : `Existe un conflicto en los datos oficiales.`)
        break
      case 'missing_fact':
        lines.push(abs.factRef ? `Faltan datos en el contrato para ${factNameLower} ${scopeText}.` : `Faltan datos en el contrato.`)
        break
      case 'scope_mismatch':
        lines.push(abs.factRef ? `El alcance territorial proporcionado no coincide para evaluar ${factNameLower} ${scopeText}.` : `No hay información factual suficiente para responder sobre ese ámbito territorial.`)
        break
      case 'unsupported_operation':
        lines.push(abs.factRef ? `La operación solicitada no es compatible con ${factNameLower} ${scopeText}.` : `La operación solicitada no es compatible.`)
        break
    }
  }

  return lines
}
