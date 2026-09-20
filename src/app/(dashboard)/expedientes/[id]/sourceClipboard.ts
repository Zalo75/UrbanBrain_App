import { buildSafeHttpUrl } from './chatCitations'

export interface SourceCopyInput {
  fragmento_completo?: unknown
  fragmento_corto?: unknown
  content?: unknown
  texto?: unknown
  text?: unknown
  nombre_pdf?: unknown
  titulo_detectado?: unknown
  pagina_detectada?: unknown
  official_url?: unknown
  original_path?: unknown
}

function isTechnicalMarker(value: string) {
  const normalized = value.trim().toLocaleLowerCase('es-ES')
  const unwrapped = normalized.startsWith('[') && normalized.endsWith(']')
    ? normalized.slice(1, -1).trim()
    : normalized
  return /^(?:null|undefined|nan|fuente\s+(?:null|undefined|nan))$/u.test(unwrapped)
}

export function normalizeFragment(value: unknown): string | null {
  if (typeof value !== 'string') {
    if (value && typeof value === 'object') {
      try {
        const stringified = JSON.stringify(value, null, 2).trim()
        return isTechnicalMarker(stringified) ? null : stringified
      } catch {
        return null
      }
    }
    return null
  }

  const normalized = value.trim()
  if (!normalized) return null

  return isTechnicalMarker(normalized) ? null : normalized
}

export function normalizeDetectedReference(value: unknown): string | null {
  if (typeof value !== 'string') return null

  const normalized = value.trim()
  if (!normalized) return null

  const technicalMarker = normalized.toLocaleLowerCase('es-ES')
  if (isTechnicalMarker(normalized) || ['n/a', 'na', 'ninguno', 'sin determinar', '-'].includes(technicalMarker)) {
    return null
  }

  return normalized
}

function normalizeDocumentName(value: unknown): string | null {
  if (typeof value !== 'string') return null

  const normalized = value.trim()
  if (!normalized) return null

  const technicalMarker = normalized.toLocaleLowerCase('es-ES')
  if (isTechnicalMarker(normalized) || ['n/a', 'na', 'ninguno', 'sin determinar', '-', 'documento'].includes(technicalMarker)) {
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
  return (
    normalizeFragment(source.fragmento_completo) ??
    normalizeFragment(source.fragmento_corto) ??
    normalizeFragment(source.content) ??
    normalizeFragment(source.texto) ??
    normalizeFragment(source.text)
  )
}

export interface BuildSourceCitationOptions {
  activeViewMode?: 'original' | 'ocr' | 'translation'
  targetLanguage?: string | null
  derivedText?: string | null
}

export function buildSourceCitationText(
  source: SourceCopyInput,
  options?: BuildSourceCitationOptions
): string | null {
  const isDerivedOcr = options?.activeViewMode === 'ocr' && Boolean(normalizeFragment(options.derivedText))
  const isDerivedTranslation = options?.activeViewMode === 'translation' && Boolean(normalizeFragment(options.derivedText))

  let fragment: string | null = null
  if (isDerivedOcr || isDerivedTranslation) {
    fragment = normalizeFragment(options?.derivedText)
  } else {
    fragment = getCopyableSourceFragment(source)
  }

  if (!fragment) return null

  const metadata: string[] = []

  if (isDerivedOcr) {
    metadata.push('Nota: (Texto derivado por corrección OCR sobre la fuente oficial acreditada)')
  } else if (isDerivedTranslation) {
    const langLabel = options?.targetLanguage?.toLowerCase().startsWith('gl') ? 'gallego' : 'castellano'
    metadata.push(`Nota: (Traducción asistida al ${langLabel} sobre el original acreditado)`)
  }

  const documentName = normalizeDocumentName(source.nombre_pdf)
  const detectedReference = normalizeCitationReference(source.titulo_detectado)
  const page = normalizeSourcePage(source.pagina_detectada)
  const safeUrl =
    buildSafeHttpUrl(typeof source.official_url === 'string' ? source.official_url : null) ??
    buildSafeHttpUrl(typeof source.original_path === 'string' ? source.original_path : null)

  if (documentName) metadata.push(`Fuente: ${documentName}`)
  if (detectedReference) metadata.push(`Referencia detectada: ${detectedReference}`)
  if (page) metadata.push(`Página: ${page}`)
  if (safeUrl) metadata.push(`Origen oficial: ${safeUrl}`)

  const quotedFragment = `«${fragment}»`
  return metadata.length > 0 ? `${quotedFragment}\n\n${metadata.join('\n')}` : quotedFragment
}
