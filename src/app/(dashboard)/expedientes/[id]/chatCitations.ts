export type CitationToken =
  | { type: 'text'; value: string }
  | { type: 'citation'; sourceIndex: number; originalText: string }
  | { type: 'context'; originalText: string }

export interface CitationPresentation {
  tokens: CitationToken[]
  showContextIndicator: boolean
}

const EXPLICIT_CONTEXT_SECTION_PATTERN =
  /(?:^|\n)[ \t]*(?:CONTEXTO DE PARCELA UTILIZADO|HECHOS ESTRUCTURADOS DEL EXPEDIENTE)[ \t]*(?:\r?\n|$)/iu

function isTechnicalPlaceholder(label: string) {
  return /^(?:undefined|null|nan|fuente\s+(?:undefined|null|nan))$/iu.test(label.trim())
}

function positiveInteger(value: string): number | null {
  if (!value) return null

  for (const character of value) {
    if (character < '0' || character > '9') return null
  }

  const parsed = Number(value)
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null
}

function citationIndex(label: string): number | null {
  const trimmed = label.trim()
  const separator = trimmed.indexOf(' ')
  if (separator < 0) return null

  const keyword = trimmed.slice(0, separator)
  const value = trimmed.slice(separator).trim()
  if (keyword.toLocaleLowerCase('es-ES') !== 'fuente') return null

  return positiveInteger(value)
}

/**
 * Tokenizes only the citation syntax emitted by the chat contract: [Fuente N].
 * It deliberately leaves Markdown and malformed bracketed text untouched.
 */
export function parseCitations(content: string): CitationToken[] {
  if (!content) return []

  const tokens: CitationToken[] = []
  let cursor = 0
  let textStart = 0
  let transformed = false

  while (cursor < content.length) {
    const openingBracket = content.indexOf('[', cursor)
    if (openingBracket < 0) break

    const closingBracket = content.indexOf(']', openingBracket + 1)
    if (closingBracket < 0) break

    const originalText = content.slice(openingBracket, closingBracket + 1)
    const label = content.slice(openingBracket + 1, closingBracket)
    const sourceIndex = citationIndex(label)
    const isContext = label.trim().toLocaleLowerCase('es-ES') === 'contexto'
    const isInvalidTechnicalPlaceholder = isTechnicalPlaceholder(label)
    if (
      (!isContext && !isInvalidTechnicalPlaceholder && sourceIndex === null) ||
      (sourceIndex !== null && content[closingBracket + 1] === '(')
    ) {
      cursor = closingBracket + 1
      continue
    }

    if (openingBracket > textStart) {
      tokens.push({ type: 'text', value: content.slice(textStart, openingBracket) })
    }
    transformed = true
    if (isContext) tokens.push({ type: 'context', originalText })
    else if (sourceIndex !== null) tokens.push({ type: 'citation', sourceIndex, originalText })
    cursor = closingBracket + 1
    textStart = cursor
  }

  if (textStart < content.length) {
    tokens.push({ type: 'text', value: content.slice(textStart) })
  }

  return transformed ? tokens : [{ type: 'text', value: content }]
}

/** Keeps context provenance machine-readable while presenting it only once when needed. */
export function prepareCitationPresentation(content: string): CitationPresentation {
  const tokens = parseCitations(content)
  const hasContext = tokens.some((token) => token.type === 'context')

  return {
    tokens,
    showContextIndicator: hasContext && !EXPLICIT_CONTEXT_SECTION_PATTERN.test(content),
  }
}

export function extractValidPageNumber(pageDetected?: string | number | null): number | null {
  if (pageDetected == null) return null
  return positiveInteger(String(pageDetected).trim())
}

export function buildSafeHttpUrl(url?: string | null): string | null {
  if (!url) return null

  try {
    const parsed = new URL(url)
    if (
      (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') ||
      parsed.username ||
      parsed.password
    ) {
      return null
    }

    return parsed.toString()
  } catch {
    return null
  }
}

export function buildPdfUrl(url?: string | null): string | null {
  const safeUrl = buildSafeHttpUrl(url)
  if (!safeUrl) return null

  const parsed = new URL(safeUrl)
  if (!parsed.pathname.toLocaleLowerCase('en-US').endsWith('.pdf')) return null

  parsed.hash = ''
  return parsed.toString()
}

export function buildPdfPageUrl(
  url?: string | null,
  pageDetected?: string | number | null
): string | null {
  const pdfUrl = buildPdfUrl(url)
  const page = extractValidPageNumber(pageDetected)
  if (!pdfUrl || page === null) return null

  const parsed = new URL(pdfUrl)
  parsed.hash = `page=${page}`
  return parsed.toString()
}
