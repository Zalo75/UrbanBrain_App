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

  if (!graph.municipalityCode || graph.municipalityCode.trim() === '') {
    errors.push({ code: 'EMPTY_MUNICIPALITY_CODE', path: 'municipalityCode', message: 'Municipality code cannot be empty' })
  }

  if (!graph.version || graph.version.trim() === '') {
    errors.push({ code: 'EMPTY_GRAPH_VERSION', path: 'version', message: 'Graph version cannot be empty' })
  }

  const instrumentIds = new Set<string>()
  const dispositionIds = new Set<string>()
  const relationshipIds = new Set<string>()
  const dispositionInstrumentMap = new Map<string, string>()
  const parentMap = new Map<string, string | undefined>()
  const evidenceIds = new Set<string>()
  const evidenceById = new Map<string, any>()

  const nodeEvidenceIds = new Map<string, Set<string>>()
  const addNodeEvidence = (kind: string, id: string, evIds?: string[]) => {
    if (!evIds) return
    const key = `${kind}:${id}`
    const set = nodeEvidenceIds.get(key) || new Set<string>()
    evIds.forEach(eid => set.add(eid))
    nodeEvidenceIds.set(key, set)
  }

  for (const inst of graph.instruments) {
    if (instrumentIds.has(inst.id)) {
      errors.push({ code: 'DUPLICATE_INSTRUMENT_ID', path: `instruments[id=${inst.id}]`, message: `Duplicate instrument ID: ${inst.id}` })
    }
    instrumentIds.add(inst.id)
    addNodeEvidence('instrument', inst.id, inst.evidenceIds)
  }

  for (const disp of graph.dispositions) {
    if (dispositionIds.has(disp.id)) {
      errors.push({ code: 'DUPLICATE_DISPOSITION_ID', path: `dispositions[id=${disp.id}]`, message: `Duplicate disposition ID: ${disp.id}` })
    }
    dispositionIds.add(disp.id)
    dispositionInstrumentMap.set(disp.id, disp.instrumentId)
    parentMap.set(disp.id, disp.parentDispositionId)
    addNodeEvidence('disposition', disp.id, disp.evidenceIds)
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

    relationshipIds.add(rel.id)
    addNodeEvidence('relationship', rel.id, rel.evidenceIds)
  }

  // 1. ID de Evidence duplicado.
  if (graph.evidences) {
    for (const ev of graph.evidences) {
      if (evidenceIds.has(ev.id)) {
        errors.push({ code: 'DUPLICATE_EVIDENCE_ID', path: `evidences[id=${ev.id}]`, message: `Duplicate evidence ID: ${ev.id}` })
      }
      evidenceIds.add(ev.id)
      evidenceById.set(ev.id, ev)
    }
  }

  const linkEvidenceIds = new Map<string, Set<string>>()

  if (graph.evidenceLinks) {
    for (let i = 0; i < graph.evidenceLinks.length; i++) {
      const link = graph.evidenceLinks[i]
      const path = `evidenceLinks[${i}]`

      // 2. evidenceId del link inexistente.
      if (!evidenceIds.has(link.evidenceId)) {
        errors.push({ code: 'INVALID_LINK_EVIDENCE_ID', path: `${path}.evidenceId`, message: `Linked evidence '${link.evidenceId}' does not exist` })
      }

      const { kind, id } = link.subject
      // 3. sujeto instrumento inexistente, 4. sujeto disposición inexistente, 5. sujeto relación inexistente, 6. kind incorrecto
      if (kind === 'instrument' && !instrumentIds.has(id)) {
        errors.push({ code: 'INVALID_LINK_SUBJECT_ID', path: `${path}.subject`, message: `Linked instrument subject '${id}' does not exist` })
      } else if (kind === 'disposition' && !dispositionIds.has(id)) {
        errors.push({ code: 'INVALID_LINK_SUBJECT_ID', path: `${path}.subject`, message: `Linked disposition subject '${id}' does not exist` })
      } else if (kind === 'relationship' && !relationshipIds.has(id)) {
        errors.push({ code: 'INVALID_LINK_SUBJECT_ID', path: `${path}.subject`, message: `Linked relationship subject '${id}' does not exist` })
      }

      // 14. Si Evidence.subjectId está informado, debe coincidir con subject.id del link
      const ev = evidenceById.get(link.evidenceId)
      if (ev && ev.subjectId !== undefined && ev.subjectId !== null && ev.subjectId !== '') {
        if (ev.subjectId !== id) {
          errors.push({ code: 'EVIDENCE_SUBJECT_MISMATCH', path: path, message: `Evidence '${link.evidenceId}' subjectId '${ev.subjectId}' does not match link subject.id '${id}'` })
        }
      }

      const key = `${kind}:${id}`
      const set = linkEvidenceIds.get(key) || new Set<string>()
      set.add(link.evidenceId)
      linkEvidenceIds.set(key, set)
    }
  }

  // Check 7 & 8: evidenceIds en nodos/relaciones coinciden con los links correspondientes
  for (const [key, declaredEvIds] of nodeEvidenceIds.entries()) {
    const linkedEvIds = linkEvidenceIds.get(key) || new Set<string>()
    for (const declaredId of declaredEvIds) {
      // 7. evidenceIds de un nodo sin link correspondiente.
      if (!linkedEvIds.has(declaredId)) {
        errors.push({ code: 'MISSING_EVIDENCE_LINK', path: `[${key}]`, message: `Evidence '${declaredId}' declared in node/relationship but missing corresponding EvidenceLink` })
      }
    }
  }

  for (const [key, linkedEvIds] of linkEvidenceIds.entries()) {
    const declaredEvIds = nodeEvidenceIds.get(key) || new Set<string>()
    for (const linkedId of linkedEvIds) {
      // 8. link cuyo evidenceId no aparece en evidenceIds del sujeto.
      if (!declaredEvIds.has(linkedId)) {
        errors.push({ code: 'UNDECLARED_EVIDENCE_LINK', path: `[${key}]`, message: `EvidenceLink points to '${linkedId}' but subject does not declare it in evidenceIds` })
      }
    }
  }

  return errors
}
