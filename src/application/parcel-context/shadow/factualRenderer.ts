import type { TerritorialFactualContract } from '@/domain/parcel-context/factualContract'
import type { StructuredFactualOutput, StructuredFactRef } from './structuredFactualOutput'
import { resolveFactRef } from './resolveFactRef'

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

export function renderFactualOutput(output: StructuredFactualOutput, contract: TerritorialFactualContract): string[] {
  const lines: string[] = []

  for (const op of output.operations) {
    const resolution = resolveFactRef(op.factRef, contract)

    // Hardening: Operaciones de estado requieren el hecho. Si no hay match (0 o >1), fallamos seguro.
    if (resolution.result !== 'one') {
      throw new Error(`Renderer error: FactRef resolution failed with ${resolution.result} for ${JSON.stringify(op.factRef)}`)
    }

    const fact = resolution.fact

    const factNameCapitalized = getFactName(op.factRef, true)
    const factNameLower = getFactName(op.factRef, false)
    const scopeText = renderScope(op.factRef.scope)

    const code = 'code' in fact && fact.code ? fact.code : undefined
    const isComplete = 'semanticCompleteness' in fact && fact.semanticCompleteness === 'complete'
    const label = 'label' in fact ? fact.label : undefined

    // Hardening: Nunca 'undefined' o 'null'. Si partial, no usamos label.
    const hasLabel = isComplete && typeof label === 'string' && label.length > 0
    const labelText = hasLabel ? `${label} (${code})` : (code ? `(${code})` : '')

    switch (op.operation) {
      case 'reference_code':
        if (!code) throw new Error('Renderer error: code is undefined for reference_code')
        lines.push(`Se ha identificado que ${factNameLower} ${scopeText} incluye el código ${code}.`)
        break
      case 'state_label':
        if (hasLabel) {
          lines.push(`Se ha identificado ${factNameLower} ${labelText} ${scopeText}.`)
        } else if (code) {
          lines.push(`Se ha identificado ${factNameLower} con código ${code} ${scopeText}.`)
        } else {
          lines.push(`Se ha identificado ${factNameLower} ${scopeText}.`) // Fallback si no hay ni code ni label
        }
        break
      case 'state_percentage':
        if ('parcelPercentage' in fact && fact.parcelPercentage !== undefined) {
          const pct = String(fact.parcelPercentage).replace('.', ',')
          if (hasLabel) {
            lines.push(`${factNameCapitalized} ${labelText} representa el ${pct} % del ámbito analizado ${scopeText}.`)
          } else if (code) {
            lines.push(`${factNameCapitalized} con código ${code} representa el ${pct} % del ámbito analizado ${scopeText}.`)
          }
        }
        break
      case 'state_status':
        if ('status' in fact) {
          // Hardening: no producir 'effective' si el fact.status !== effective
          if (op.status === 'effective' && (fact.status as string) !== 'effective') {
            throw new Error(`Renderer error: Cannot render effective status because fact.status is ${fact.status}`)
          }
          // Usar siempre el status real del fact
          const status = fact.status as string
          if (status === 'automatic_confirmed') {
            lines.push(`El estado de ${factNameLower} ${scopeText} está confirmado automáticamente.`)
          } else if (status === 'conflict') {
            lines.push(`El estado de ${factNameLower} ${scopeText} presenta un conflicto pendiente de resolver.`)
          } else if (status === 'unresolved') {
            lines.push(`El estado de ${factNameLower} ${scopeText} no está resuelto.`)
          } else if (status === 'checked') {
            lines.push(`El estado de ${factNameLower} ${scopeText} ha sido verificado.`)
          } else if (status === 'effective') {
            lines.push(`El estado de ${factNameLower} ${scopeText} es efectivo.`)
          } else {
            lines.push(`El estado de ${factNameLower} ${scopeText} es '${status}'.`)
          }
        }
        break
      case 'state_determination':
        if ('determination' in fact) {
          if (op.determination === 'effective' && fact.determination !== 'effective') {
             throw new Error(`Renderer error: Cannot render effective determination because fact.determination is ${fact.determination}`)
          }
          const det = fact.determination as string
          if (det === 'automatic') {
            lines.push(`La determinación de ${factNameLower} ${scopeText} es automática.`)
          } else if (det === 'unresolved') {
            lines.push(`La determinación de ${factNameLower} ${scopeText} no está resuelta.`)
          } else if (det === 'effective') {
            lines.push(`La determinación de ${factNameLower} ${scopeText} es efectiva.`)
          } else {
            lines.push(`La determinación de ${factNameLower} ${scopeText} es '${det}'.`)
          }
        }
        break
      case 'state_geometric_dominance':
        if ('parcelPercentage' in fact && fact.parcelPercentage !== undefined) {
          const pct = String(fact.parcelPercentage).replace('.', ',')
          if (hasLabel) {
            lines.push(`${factNameCapitalized} ${labelText} representa el ${pct} % del ámbito analizado ${scopeText} y es la de mayor presencia geométrica.`)
          } else if (code) {
            lines.push(`${factNameCapitalized} con código ${code} representa el ${pct} % del ámbito analizado ${scopeText} y es la de mayor presencia geométrica.`)
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
        lines.push(`No se registra la presencia de ${factNameLower} ${scopeText}.`)
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
