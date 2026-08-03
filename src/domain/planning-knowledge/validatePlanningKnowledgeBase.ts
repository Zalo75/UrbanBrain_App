import type { PlanningKnowledgeBase, PlanningKnowledgeValidationError } from './pkbTypes'

export function validatePlanningKnowledgeBase(
  pkb: PlanningKnowledgeBase
): PlanningKnowledgeValidationError[] {
  const errors: PlanningKnowledgeValidationError[] = []

  if (!pkb.municipalityCode || pkb.municipalityCode.trim() === '') {
    errors.push({ code: 'EMPTY_MUNICIPALITY_CODE', path: 'municipalityCode', message: 'Municipality code cannot be empty' })
  }
  if (!pkb.municipalityName || pkb.municipalityName.trim() === '') {
    errors.push({ code: 'EMPTY_MUNICIPALITY_NAME', path: 'municipalityName', message: 'Municipality name cannot be empty' })
  }
  if (!pkb.version || pkb.version.trim() === '') {
    errors.push({ code: 'INVALID_VERSION', path: 'version', message: 'Catalogue version cannot be empty' })
  }

  const instrumentIds = new Set<string>()
  const allEntriesInCatalogue = new Set<string>()
  const instrumentByEntry = new Map<string, string>()

  pkb.instruments.forEach((instrument, iIndex) => {
    const instPath = `instruments[${iIndex}]`

    if (instrumentIds.has(instrument.instrumentId)) {
      errors.push({ code: 'DUPLICATE_INSTRUMENT_ID', path: `${instPath}.instrumentId`, message: `Duplicate instrument ID: ${instrument.instrumentId}` })
    }
    instrumentIds.add(instrument.instrumentId)

    if (instrument.effectiveFrom && instrument.effectiveTo) {
      const from = new Date(instrument.effectiveFrom).getTime()
      const to = new Date(instrument.effectiveTo).getTime()
      if (from > to) {
        errors.push({ code: 'INCOHERENT_DATES', path: `${instPath}.effectiveFrom`, message: 'effectiveFrom cannot be after effectiveTo' })
      }
    }

    instrument.entries.forEach(entry => {
      // duplicates are tracked specifically per instrument later, but globally we track identity
      allEntriesInCatalogue.add(entry.id)
      instrumentByEntry.set(entry.id, instrument.instrumentId)
    })
  })

  pkb.instruments.forEach((instrument, iIndex) => {
    const instPath = `instruments[${iIndex}]`

    const entryIdsInInstrument = new Set<string>()
    const codeByParent = new Map<string | undefined, Set<string>>()
    const parentMap = new Map<string, string | undefined>()

    instrument.entries.forEach((entry, eIndex) => {
      const entryPath = `${instPath}.entries[${eIndex}]`

      if (entryIdsInInstrument.has(entry.id)) {
        errors.push({ code: 'DUPLICATE_ENTRY_ID', path: `${entryPath}.id`, message: `Duplicate entry ID in instrument: ${entry.id}` })
      }
      entryIdsInInstrument.add(entry.id)
      parentMap.set(entry.id, entry.parentId)

      if (pkb.status === 'draft' && entry.status === 'published') {
        errors.push({ code: 'PUBLISHED_ENTRY_IN_DRAFT_CATALOGUE', path: `${entryPath}.status`, message: 'Cannot have a published entry in a draft catalogue' })
      }

      const parentSet = codeByParent.get(entry.parentId) || new Set<string>()
      if (parentSet.has(entry.code)) {
        errors.push({ code: 'DUPLICATE_CODE_IN_SCOPE', path: `${entryPath}.code`, message: `Duplicate code '${entry.code}' under parent '${entry.parentId || 'root'}'` })
      }
      parentSet.add(entry.code)
      codeByParent.set(entry.parentId, parentSet)

      if (entry.binding) {
        if (!entry.binding.documentNames || entry.binding.documentNames.length === 0) {
          errors.push({ code: 'EMPTY_BINDING_DOCUMENTS', path: `${entryPath}.binding.documentNames`, message: 'Binding must have at least one document name' })
        }

        if (entry.binding.pageRanges) {
          entry.binding.pageRanges.forEach((range, rIndex) => {
            const rangePath = `${entryPath}.binding.pageRanges[${rIndex}]`
            if (!entry.binding.documentNames?.includes(range.documentName)) {
              errors.push({ code: 'PAGE_RANGE_DOCUMENT_NOT_BOUND', path: `${rangePath}.documentName`, message: `Page range document '${range.documentName}' is not in documentNames` })
            }
            if (range.fromPage !== undefined && range.toPage !== undefined && range.fromPage > range.toPage) {
              errors.push({ code: 'INVALID_PAGE_RANGE', path: rangePath, message: `fromPage (${range.fromPage}) cannot be greater than toPage (${range.toPage})` })
            }
          })
        }
      }

      if (entry.compatibleLandClasses && entry.compatibleLandClasses.length === 0) {
        errors.push({ code: 'EMPTY_COMPATIBLE_LAND_CLASS', path: `${entryPath}.compatibleLandClasses`, message: 'Array must not be empty if defined' })
      }
      if (entry.compatibleCategories && entry.compatibleCategories.length === 0) {
        errors.push({ code: 'EMPTY_COMPATIBLE_CATEGORY', path: `${entryPath}.compatibleCategories`, message: 'Array must not be empty if defined' })
      }
    })

    // Check parentId exists, cross instrument, and circular dependencies
    instrument.entries.forEach((entry, eIndex) => {
      const entryPath = `${instPath}.entries[${eIndex}]`

      if (entry.parentId) {
        if (!allEntriesInCatalogue.has(entry.parentId)) {
          errors.push({ code: 'INVALID_PARENT_ID', path: `${entryPath}.parentId`, message: `Parent ID '${entry.parentId}' does not exist` })
        } else if (instrumentByEntry.get(entry.parentId) !== instrument.instrumentId) {
          errors.push({ code: 'CROSS_INSTRUMENT_PARENT', path: `${entryPath}.parentId`, message: `Parent ID '${entry.parentId}' belongs to a different instrument` })
        }

        let currentParent = parentMap.get(entry.parentId)
        const visited = new Set<string>([entry.id])
        if (entry.parentId) visited.add(entry.parentId)

        let hasCycle = false
        while (currentParent !== undefined) {
          if (visited.has(currentParent)) {
            hasCycle = true
            break
          }
          visited.add(currentParent)
          currentParent = parentMap.get(currentParent)
        }

        if (hasCycle) {
          errors.push({ code: 'CIRCULAR_DEPENDENCY', path: `${entryPath}.parentId`, message: `Circular dependency detected for entry '${entry.id}'` })
        }
      }
    })
  })

  return errors
}

import type { PlanningKnowledgeGraph } from './pkbTypes'

export function validatePlanningKnowledgeGraph(
  graph: PlanningKnowledgeGraph
): PlanningKnowledgeValidationError[] {
  const errors: PlanningKnowledgeValidationError[] = []

  const instrumentIds = new Set<string>()
  const dispositionIds = new Set<string>()
  const dispositionInstrumentMap = new Map<string, string>()
  const parentMap = new Map<string, string | undefined>()

  for (const inst of graph.instruments) {
    if (instrumentIds.has(inst.id)) {
      errors.push({ code: 'DUPLICATE_INSTRUMENT_ID', path: `instruments[id=${inst.id}]`, message: `Duplicate instrument ID: ${inst.id}` })
    }
    instrumentIds.add(inst.id)
  }

  for (const disp of graph.dispositions) {
    if (dispositionIds.has(disp.id)) {
      errors.push({ code: 'DUPLICATE_DISPOSITION_ID', path: `dispositions[id=${disp.id}]`, message: `Duplicate disposition ID: ${disp.id}` })
    }
    dispositionIds.add(disp.id)
    dispositionInstrumentMap.set(disp.id, disp.instrumentId)
    parentMap.set(disp.id, disp.parentDispositionId)
  }

  for (const disp of graph.dispositions) {
    if (disp.parentDispositionId) {
      if (!dispositionIds.has(disp.parentDispositionId)) {
        errors.push({ code: 'INVALID_PARENT_DISPOSITION_ID', path: `dispositions[id=${disp.id}].parentDispositionId`, message: `Parent disposition ID '${disp.parentDispositionId}' does not exist` })
      } else {
        const parentInst = dispositionInstrumentMap.get(disp.parentDispositionId)
        if (parentInst !== disp.instrumentId) {
          errors.push({ code: 'CROSS_INSTRUMENT_PARENT_DISPOSITION', path: `dispositions[id=${disp.id}].parentDispositionId`, message: `Parent disposition '${disp.parentDispositionId}' belongs to a different instrument` })
        }
      }

      let currentParent = parentMap.get(disp.parentDispositionId)
      const visited = new Set<string>([disp.id])
      visited.add(disp.parentDispositionId)

      let hasCycle = false
      while (currentParent !== undefined) {
        if (visited.has(currentParent)) {
          hasCycle = true
          break
        }
        visited.add(currentParent)
        currentParent = parentMap.get(currentParent)
      }

      if (hasCycle) {
        errors.push({ code: 'CIRCULAR_STRUCTURAL_DEPENDENCY', path: `dispositions[id=${disp.id}]`, message: `Circular structural dependency detected for disposition '${disp.id}'` })
      }
    }
  }

  for (const rel of graph.relationships) {
    if (rel.source.kind === 'instrument') {
      if (!instrumentIds.has(rel.source.id)) {
        errors.push({ code: 'INVALID_RELATION_SOURCE', path: `relationships[id=${rel.id}].source`, message: `Source instrument '${rel.source.id}' not found` })
      }
    } else if (rel.source.kind === 'disposition') {
      if (!dispositionIds.has(rel.source.id)) {
        errors.push({ code: 'INVALID_RELATION_SOURCE', path: `relationships[id=${rel.id}].source`, message: `Source disposition '${rel.source.id}' not found` })
      }
    } else {
       errors.push({ code: 'INVALID_RELATION_SOURCE_KIND', path: `relationships[id=${rel.id}].source`, message: `Invalid source kind '${rel.source.kind}'` })
    }

    if (rel.target.kind === 'instrument') {
      if (!instrumentIds.has(rel.target.id)) {
        errors.push({ code: 'INVALID_RELATION_TARGET', path: `relationships[id=${rel.id}].target`, message: `Target instrument '${rel.target.id}' not found` })
      }
    } else if (rel.target.kind === 'disposition') {
      if (!dispositionIds.has(rel.target.id)) {
        errors.push({ code: 'INVALID_RELATION_TARGET', path: `relationships[id=${rel.id}].target`, message: `Target disposition '${rel.target.id}' not found` })
      }
    } else {
       errors.push({ code: 'INVALID_RELATION_TARGET_KIND', path: `relationships[id=${rel.id}].target`, message: `Invalid target kind '${rel.target.kind}'` })
    }
  }

  return errors
}
