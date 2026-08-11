import { buildSafeHttpUrl } from './chatCitations'

export interface SourceCopyInput {
  fragmento_completo?: unknown
  fragmento_corto?: unknown
  nombre_pdf?: unknown
  titulo_detectado?: unknown
  pagina_detectada?: unknown
  original_path?: unknown
}

export function normalizeFragment(value: unknown): string | null {
  if (typeof value !== 'string') return null

  const normalized = value.trim()
  if (!normalized) return null

  const technicalMarker = normalized.toLocaleLowerCase('es-ES')
  return technicalMarker === 'null' || technicalMarker === 'undefined' ? null : normalized
}

export function normalizeDetectedReference(value: unknown): string | null {
  if (typeof value !== 'string') return null

  const normalized = value.trim()
  if (!normalized) return null

  const technicalMarker = normalized.toLocaleLowerCase('es-ES')
  if (['n/a', 'na', 'ninguno', 'sin determinar', '-'].includes(technicalMarker)) {
    return null
  }

  return normalized
}

function normalizeDocumentName(value: unknown): string | null {
  if (typeof value !== 'string') return null

  const normalized = value.trim()
  if (!normalized) return null

  const technicalMarker = normalized.toLocaleLowerCase('es-ES')
  if (['null', 'undefined', 'n/a', 'na', 'ninguno', 'sin determinar', '-', 'documento'].includes(technicalMarker)) {
    return null
  }

  return normalized
}

function normalizeCitationReference(value: unknown): string | null {
  const normalized = normalizeDetectedReference(value)
  if (!normalized) return null

  const technicalMarker = normalized.toLocaleLowerCase('es-ES')
  return technicalMarker === 'null' || technicalMarker === 'undefined' ? null : normalized
}

export function normalizeSourcePage(value: unknown): string | null {
  if (typeof value === 'number') {
    return Number.isSafeInteger(value) && value > 0 ? String(value) : null
  }
  if (typeof value !== 'string') return null

  const trimmed = value.trim()
  if (!trimmed) return null

  const withoutLabel = trimmed.replace(/^(?:p(?:á|a)g(?:ina)?\.?)\s*/iu, '')
  const match = /^([1-9]\d*)(?:\s*[-–]\s*([1-9]\d*))?$/.exec(withoutLabel)
  if (!match) return null

  const first = Number(match[1])
  const last = match[2] === undefined ? null : Number(match[2])
  if (!Number.isSafeInteger(first) || (last !== null && !Number.isSafeInteger(last))) return null
  if (last !== null && last < first) return null

  return last === null ? String(first) : `${first}-${last}`
}

export function getCopyableSourceFragment(source: SourceCopyInput): string | null {
  return normalizeFragment(source.fragmento_completo) ?? normalizeFragment(source.fragmento_corto)
}

export function buildSourceCitationText(source: SourceCopyInput): string | null {
  const fragment = getCopyableSourceFragment(source)
  if (!fragment) return null

  const metadata: string[] = []
  const documentName = normalizeDocumentName(source.nombre_pdf)
  const detectedReference = normalizeCitationReference(source.titulo_detectado)
  const page = normalizeSourcePage(source.pagina_detectada)
  const safeUrl = buildSafeHttpUrl(typeof source.original_path === 'string' ? source.original_path : null)

  if (documentName) metadata.push(`Fuente: ${documentName}`)
  if (detectedReference) metadata.push(`Referencia detectada: ${detectedReference}`)
  if (page) metadata.push(`Página: ${page}`)
  if (safeUrl) metadata.push(`Origen oficial: ${safeUrl}`)

  const quotedFragment = `«${fragment}»`
  return metadata.length > 0 ? `${quotedFragment}\n\n${metadata.join('\n')}` : quotedFragment
}
