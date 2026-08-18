import type { NormativeRegimeIdentity } from '@/domain/parcel-context/types'

export interface ChunkForBackfill {
  id: string
  content: string
  page?: number
  chunkIndex?: number
  article?: string | null
  chapter?: string | null
  section?: string | null
  detectedTitle?: string | null
}

export type StructuralHeadingKind = 'title' | 'chapter' | 'section' | 'subsection' | 'article' | 'apartado' | 'general' | 'index' | 'page_marker'

export interface ParsedStructuralHeading {
  kind: StructuralHeadingKind
  raw: string
  identifier?: string
  regime?: NormativeRegimeIdentity
  indexLike?: boolean
}

export interface EnrichedChunkMetadata {
  id: string
  metadata: {
    regime?: NormativeRegimeIdentity
    hierarchy?: {
      title?: string
      chapter?: string
      section?: string
      article?: string
      kind?: StructuralHeadingKind
      heading?: string
    }
  }
}

const STRUCTURAL_HEADING_REGEX = /^\s*(SUBSECCI[ÓO]N|SECCI[ÓO]N|CAP[IÍ]TULO|T[IÍ]TULO|ART(?:[ÍI]CULO|IGO)?\.?|APARTADO)\b[\s.:\-–—]*(.*)$/iu
const STANDALONE_REGIME_HEADING_REGEX = /^\s*(?:ORDENANZA|ZONA|[ÁA]MBITO)\b/i
const GENERAL_HEADING_REGEX = /\b(?:DISPOSICIONES|DISPOSICI[ÓO]NS|NORMAS|CONDICIONES)\s+(?:GENERALES|XERAIS)\b/i
const PAGE_MARKER_REGEX = /^\s*(?:-{2,}\s*)?(?:P[ÁA]GINA|PAGE)\s+\d+\s*(?:-{2,})?\s*$/iu
const INDEX_HEADING_REGEX = /^\s*(?:[ÍI]NDICE|[ÍI]NDICES|SUMARIO|TABLA\s+DE\s+CONTENIDOS)\b/iu
const INDEX_DOT_LEADER_REGEX = /(?:\.{2,}|…{2,})\s*\d{1,4}\s*$/u
const REGIME_REFERENCE_REGEX = /\b(?:ORDENANZA|ZONA|[ÁA]MBITO)\s+(?:N[ºO°.]?\s*)?([A-Z]{1,8}\d{1,8}|[A-Z]{1,8}(?:[._/-]\d{1,8})?|\d+(?:\.\d+)*)\b/giu
const REGIME_STOPWORDS = new Set(['DE', 'DEL', 'LA', 'EL', 'EN', 'Y', 'E', 'SOLO', 'NON', 'NO', 'URBANO', 'RUSTICO', 'RURAL', 'URBANIZABLE', 'REGULADORAS', 'REGULADORA', 'GENERAL', 'GENERALES', 'XERAIS', 'ORDENANZA', 'ORDENANZAS'])

function normalizeSpaces(value: string) {
  return value.replace(/[\u00a0\t]+/g, ' ').replace(/\s{2,}/g, ' ').trim()
}

function normalized(value: string) {
  return value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLocaleUpperCase('es')
}

function isCodeCandidate(value: string) {
  const token = value.replace(/^[([{]+|[)\]},.;:]+$/g, '').toUpperCase()
  if (!token || REGIME_STOPWORDS.has(token)) return false
  return /^[A-Z]{1,8}\d{1,8}$/.test(token) || /^[A-Z]{1,8}(?:[._/-]\d{1,8})?$/.test(token) || /^\d+(?:\.\d+)*$/.test(token)
}

function regimeFromHeading(raw: string): NormativeRegimeIdentity | undefined {
  const text = normalizeSpaces(raw)
  const upper = normalized(text)
  if (GENERAL_HEADING_REGEX.test(text) || /ORDENANZAS?\s+REGULADORAS?\s+EN\s+SOLO\s+(?:URBANO|RUSTICO|RURAL)/iu.test(text)) {
    return { kind: 'general', label: text, provenance: 'explicit_heading', confidence: 'high' }
  }
  const marker = /\b(?:ORDENANZAS?|ZONA|AMBITO)\b/iu.exec(upper)
  if (!marker) return undefined
  const afterMarker = text.slice((marker.index ?? 0) + marker[0].length)
  const parenthesized = [...text.matchAll(/\(([A-Z][A-Z0-9._/-]{0,15})\)/giu)].map((match) => match[1]).filter(isCodeCandidate)
  const tokens = afterMarker.split(/[\s,;:()\[\]]+/).filter(Boolean)
  const code = [...parenthesized, ...tokens].find(isCodeCandidate)
  return {
    kind: 'ordinance',
    ...(code ? { code: code.toUpperCase() } : {}),
    label: text,
    provenance: 'explicit_heading',
    confidence: code ? 'high' : 'low',
  }
}

function extractIdentifier(rest: string) {
  return rest.match(/^([A-Z0-9]+(?:[._/-][A-Z0-9]+)*)/iu)?.[1]
}

function parseHeadingLine(line: string, allowStandaloneRegime = false): ParsedStructuralHeading | undefined {
  const raw = normalizeSpaces(line)
  if (!raw) return undefined
  if (PAGE_MARKER_REGEX.test(raw)) return { kind: 'page_marker', raw }
  if (INDEX_HEADING_REGEX.test(raw) || INDEX_DOT_LEADER_REGEX.test(raw)) return { kind: 'index', raw, indexLike: true }
  if (GENERAL_HEADING_REGEX.test(raw)) return { kind: 'general', raw, regime: regimeFromHeading(raw) }

  const structural = raw.match(STRUCTURAL_HEADING_REGEX)
  if (structural) {
    const keyword = normalized(structural[1])
    const kind: StructuralHeadingKind = keyword.startsWith('ART') ? 'article' : keyword.startsWith('SUBSE') ? 'subsection' : keyword.startsWith('SECC') ? 'section' : keyword.startsWith('CAP') ? 'chapter' : keyword.startsWith('TIT') ? 'title' : 'apartado'
    const parsed: ParsedStructuralHeading = { kind, raw, identifier: extractIdentifier(structural[2] ?? '') }
    const regime = regimeFromHeading(raw)
    if (regime) parsed.regime = regime
    if (regime?.kind === 'general') parsed.kind = 'general'
    return parsed
  }

  if (allowStandaloneRegime && STANDALONE_REGIME_HEADING_REGEX.test(raw)) {
    const regime = regimeFromHeading(raw)
    if (regime) return { kind: regime.kind === 'general' ? 'general' : 'apartado', raw, regime }
  }
  return undefined
}

function firstHeading(chunk: ChunkForBackfill): ParsedStructuralHeading | undefined {
  if (chunk.detectedTitle?.trim()) {
    const parsed = parseHeadingLine(chunk.detectedTitle, true)
    if (parsed) return parsed
  }
  const lines = chunk.content.split(/\r?\n/).map((line) => line.trim()).filter(Boolean)
  for (const line of lines.slice(0, 3)) {
    const parsed = parseHeadingLine(line, true)
    if (parsed) return parsed
  }
  if (chunk.article?.trim()) return { kind: 'article', raw: chunk.article.trim(), identifier: chunk.article.trim() }
  if (chunk.chapter?.trim()) return { kind: 'chapter', raw: chunk.chapter.trim(), identifier: chunk.chapter.trim() }
  return undefined
}

function isIndexOrMarker(chunk: ChunkForBackfill, heading?: ParsedStructuralHeading) {
  if (heading?.kind === 'index' || heading?.kind === 'page_marker') return true
  const firstLine = chunk.content.split(/\r?\n/).map((line) => line.trim()).find(Boolean) ?? ''
  return INDEX_HEADING_REGEX.test(firstLine) || INDEX_DOT_LEADER_REGEX.test(firstLine)
}

function sameKey(left?: string | null, right?: string | null) {
  return Boolean(left && right && normalized(left) === normalized(right))
}

function copyInheritedRegime(regime: NormativeRegimeIdentity, ambiguity?: string[]): NormativeRegimeIdentity {
  return { ...regime, ...(ambiguity && ambiguity.length > 0 ? { ambiguity } : {}), provenance: 'inherited_heading', confidence: ambiguity && ambiguity.length > 0 ? 'low' : regime.confidence === 'high' ? 'medium' : regime.confidence }
}

function bodyRegimeReferences(chunk: ChunkForBackfill) {
  const lines = chunk.content.split(/\r?\n/)
  const first = lines.find((line) => line.trim()) ?? ''
  const body = parseHeadingLine(first, true) ? lines.slice(1).join('\n') : lines.join('\n')
  return [...body.matchAll(REGIME_REFERENCE_REGEX)].map((match) => match[1].toUpperCase())
}

interface HierarchyState {
  title?: string
  chapter?: string
  section?: string
  article?: string
  regime?: NormativeRegimeIdentity
  regimeArticle?: string
  unanchoredContinuations: number
}

export function parseStructuralHeading(line: string, allowStandaloneRegime = true) {
  return parseHeadingLine(line, allowStandaloneRegime)
}

export function processDocumentChunks(chunks: ChunkForBackfill[]): EnrichedChunkMetadata[] {
  const sortedChunks = [...chunks].sort((a, b) => (a.chunkIndex ?? 0) - (b.chunkIndex ?? 0))
  const results: EnrichedChunkMetadata[] = []
  const state: HierarchyState = { unanchoredContinuations: 0 }

  for (const chunk of sortedChunks) {
    const heading = firstHeading(chunk)
    const indexOrMarker = isIndexOrMarker(chunk, heading)
    let chunkRegime: NormativeRegimeIdentity | undefined

    if (heading?.kind === 'page_marker' || indexOrMarker) {
      // Presentation-only chunks neither start nor inherit a regime.
    } else if (heading?.regime) {
      chunkRegime = heading.regime
      state.regime = chunkRegime
      state.regimeArticle = heading.kind === 'article' ? chunk.article ?? heading.identifier : undefined
      state.unanchoredContinuations = 0
    } else if (heading?.kind === 'general') {
      chunkRegime = { kind: 'general', label: heading.raw, provenance: 'explicit_heading', confidence: 'high' }
      state.regime = chunkRegime
      state.regimeArticle = undefined
      state.unanchoredContinuations = 0
    } else if (heading && ['title', 'chapter', 'section', 'subsection', 'apartado', 'article'].includes(heading.kind)) {
      const sameArticle = heading.kind === 'article' && sameKey(chunk.article ?? heading.identifier, state.regimeArticle)
      if (heading.kind === 'article' && sameArticle && state.regime) {
        chunkRegime = copyInheritedRegime(state.regime)
      } else if (state.regime?.kind === 'general' && heading.kind === 'article') {
        chunkRegime = copyInheritedRegime(state.regime)
      } else {
        state.regime = undefined
        state.regimeArticle = undefined
        state.unanchoredContinuations = 0
      }
      if (heading.kind === 'title') state.title = heading.raw
      if (heading.kind === 'chapter') state.chapter = heading.raw
      if (heading.kind === 'section' || heading.kind === 'subsection' || heading.kind === 'apartado') state.section = heading.raw
      if (heading.kind === 'article') state.article = chunk.article ?? heading.identifier ?? heading.raw
    } else if (state.regime) {
      const sameArticle = sameKey(chunk.article, state.regimeArticle)
      if (state.regime.kind === 'general' || sameArticle || state.unanchoredContinuations === 0) {
        const references = bodyRegimeReferences(chunk)
        const conflictingReferences = state.regime.code ? references.filter((reference) => normalized(reference) !== normalized(state.regime?.code ?? '')) : []
        chunkRegime = copyInheritedRegime(state.regime, conflictingReferences.length > 0 ? [...new Set(conflictingReferences.map((value) => `Referencia cruzada: ${value}`))] : undefined)
        state.unanchoredContinuations += sameArticle || state.regime.kind === 'general' ? 0 : 1
      } else {
        state.regime = undefined
        state.regimeArticle = undefined
        state.unanchoredContinuations = 0
      }
    }

    if (chunkRegime?.provenance === 'inherited_heading' && chunkRegime.kind !== 'general' && chunkRegime.code) {
      const conflictingReferences = bodyRegimeReferences(chunk).filter(
        (reference) => normalized(reference) !== normalized(chunkRegime?.code ?? '')
      )
      if (conflictingReferences.length > 0) {
        chunkRegime = copyInheritedRegime(
          chunkRegime,
          [...new Set(conflictingReferences.map((value) => `Referencia cruzada: ${value}`))]
        )
      }
    }

    const hierarchy = {
      title: chunk.detectedTitle ?? state.title,
      chapter: chunk.chapter ?? state.chapter,
      section: chunk.section ?? state.section,
      article: chunk.article ?? state.article,
      kind: heading?.kind,
      heading: heading?.raw,
    }
    results.push({ id: chunk.id, metadata: { ...(chunkRegime ? { regime: chunkRegime } : {}), hierarchy } })
  }
  return results
}
