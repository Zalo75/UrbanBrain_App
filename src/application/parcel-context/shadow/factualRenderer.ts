import type { TerritorialFactualContract } from '@/domain/parcel-context/factualContract'
import type { StructuredFactualOutput, StructuredFactRef } from './structuredFactualOutput'

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

function renderScope(scope: 'parcel' | 'actionArea'): string {
  return scope === 'parcel' ? 'en toda la parcela' : 'en el área de actuación'
}

function resolveFactRef(ref: StructuredFactRef, contract: TerritorialFactualContract): any | null {
  const scopeFacts = contract.factsByScope?.[ref.scope]
  if (!scopeFacts) return null

  let matches: any[] = []
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

  if (matches.length === 1) return matches[0]
  return null
}

export function renderFactualOutput(output: StructuredFactualOutput, contract: TerritorialFactualContract): string[] {
  const lines: string[] = []

  for (const op of output.operations) {
    const fact = resolveFactRef(op.factRef, contract)
    if (!fact) continue

    const factNameCapitalized = getFactName(op.factRef, true)
    const factNameLower = getFactName(op.factRef, false)
    const scopeText = renderScope(op.factRef.scope)

    const code = fact.code
    const hasLabel = fact.semanticCompleteness === 'complete' && fact.label
    const labelText = hasLabel ? `${fact.label} (${code})` : `(${code})`

    switch (op.operation) {
      case 'reference_code':
        lines.push(`${factNameCapitalized} aplicable ${scopeText} incluye el código ${code}.`)
        break
      case 'state_label':
        if (hasLabel) {
          lines.push(`${factNameCapitalized} aplicable ${scopeText} es ${labelText}.`)
        } else {
          lines.push(`${factNameCapitalized} aplicable ${scopeText} tiene el código ${code}.`)
        }
        break
      case 'state_percentage':
        if (fact.parcelPercentage !== undefined) {
          if (hasLabel) {
            lines.push(`${factNameCapitalized} ${labelText} representa el ${String(fact.parcelPercentage).replace('.', ',')} % del ámbito analizado ${scopeText}.`)
          } else {
            lines.push(`${factNameCapitalized} con código ${code} representa el ${String(fact.parcelPercentage).replace('.', ',')} % del ámbito analizado ${scopeText}.`)
          }
        }
        break
      case 'state_status':
        lines.push(`El estado de ${factNameLower} ${scopeText} es '${fact.status}'.`)
        break
      case 'state_determination':
        lines.push(`La determinación de ${factNameLower} ${scopeText} es '${fact.determination}'.`)
        break
      case 'state_geometric_dominance':
        if (fact.parcelPercentage !== undefined) {
          if (hasLabel) {
            lines.push(`${factNameCapitalized} ${labelText} representa el ${String(fact.parcelPercentage).replace('.', ',')} % del ámbito analizado ${scopeText} y es la de mayor presencia geométrica.`)
          } else {
            lines.push(`${factNameCapitalized} con código ${code} representa el ${String(fact.parcelPercentage).replace('.', ',')} % del ámbito analizado ${scopeText} y es la de mayor presencia geométrica.`)
          }
        }
        break
      case 'state_conflict':
        lines.push(`${factNameCapitalized} ${scopeText} se encuentra en conflicto.`)
        break
      case 'state_unresolved':
        lines.push(`La información sobre ${factNameLower} ${scopeText} no está resuelta.`)
        break
      case 'state_absence':
        lines.push(`No se registra la presencia de ${factNameLower} ${scopeText}.`)
        break
    }
  }

  for (const abs of output.abstentions) {
    const scopeText = abs.factRef ? renderScope(abs.factRef.scope) : ''
    const factNameLower = abs.factRef ? getFactName(abs.factRef, false) : 'el hecho'

    switch (abs.cause) {
      case 'missing_label':
        lines.push(`No se dispone de la denominación completa para ${factNameLower} ${scopeText}.`)
        break
      case 'unresolved_fact':
        lines.push(`No se ha podido determinar con los datos disponibles la información sobre ${factNameLower} ${scopeText}.`)
        break
      case 'conflict':
        lines.push(`Existe un conflicto en los datos oficiales respecto a ${factNameLower} ${scopeText}.`)
        break
      case 'missing_fact':
        lines.push(`Faltan datos en el contrato para ${factNameLower} ${scopeText}.`)
        break
      case 'scope_mismatch':
        lines.push(`El alcance territorial proporcionado no coincide para evaluar ${factNameLower} ${scopeText}.`)
        break
      case 'unsupported_operation':
        lines.push(`La operación solicitada no es compatible con ${factNameLower} ${scopeText}.`)
        break
    }
  }

  return lines
}
