import type { PlanningDocumentReference } from '@/domain/territorial-resolver/types'
import type { NormativeCandidate } from '@/domain/parcel-context/types'
import { cartographicArgumentSchemas, parseCartographicArguments, type CartographicViewArguments, type CartographicToolResult } from './cartographicViewTool'
import { buildMinimalContinuationContext, type AccreditedRealityPackage } from './accreditedRealityPackage'

export const accreditedRealityReasonerResponseSchema = {
  type: 'object',
  properties: {
    action: { type: 'string', enum: ['final', 'tool_call'] },
    toolName: { anyOf: [{ type: 'string', enum: ['get_instrument_documents', 'get_instrument_document_content', 'get_cartographic_view'] }, { type: 'null' }] },
    toolArguments: { anyOf: [
      ...cartographicArgumentSchemas,
      { type: 'object', properties: {}, additionalProperties: false },
      { type: 'object', properties: { documentId: { type: 'string' }, query: { type: 'string' } }, required: ['documentId', 'query'], additionalProperties: false },
    ] },
    answerMode: { type: 'string', enum: ['definitive', 'conditional', 'partial', 'abstain'] },
    claims: { type: 'array', items: { type: 'object', properties: {
      id: { type: 'string' },
      type: { type: 'string', enum: ['territorial_fact', 'normative_fact', 'normative_conditional', 'parcel_conclusion', 'limitation'] },
      text: { type: 'string' },
      // Stable IDs are serialized as strings; numeric official IDs are accepted
      // only as a wire-level compatibility form and normalized immediately.
      sourceRefs: { type: 'array', items: { anyOf: [{ type: 'string' }, { type: 'number' }] } },
      appliesToParcel: { anyOf: [{ type: 'boolean' }, { type: 'string', enum: ['conditional', 'unknown'] }] },
      numericTokens: { type: 'array', items: { type: 'string' } },
    }, required: ['id', 'type', 'text', 'sourceRefs', 'appliesToParcel', 'numericTokens'], additionalProperties: false } },
    missingFacts: { type: 'array', items: { type: 'string' } },
  },
  required: ['action', 'toolName', 'toolArguments', 'answerMode', 'claims', 'missingFacts'],
  additionalProperties: false,
} as const

export type AccreditedRealityModelResponse =
  | { action: 'final'; output: AccreditedRealityReasonerOutput }
  | { action: 'tool_call'; toolName: 'get_cartographic_view'; arguments: CartographicViewArguments }
  | { action: 'tool_call'; toolName: 'get_instrument_documents'; arguments: Record<string, never> }
  | { action: 'tool_call'; toolName: 'get_instrument_document_content'; arguments: { documentId: string; query: string } }

export type AccreditedRealityModelResponseSequence = AccreditedRealityModelResponse[]
export type AccreditedRealityToolCall = Extract<AccreditedRealityModelResponse, { action: 'tool_call' }>

function stableToolArguments(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableToolArguments).join(',')}]`
  if (value && typeof value === 'object') {
    return `{${Object.entries(value as Record<string, unknown>).sort(([left], [right]) => left.localeCompare(right)).map(([key, entry]) => `${JSON.stringify(key)}:${stableToolArguments(entry)}`).join(',')}}`
  }
  return JSON.stringify(value)
}

/** Stable identity for deterministic deduplication within one investigation. */
export function accreditedRealityToolRequestKey(request: AccreditedRealityToolCall): string {
  return `${request.toolName}:${stableToolArguments(request.arguments)}`
}

/** Accept only an unambiguous, inventory-backed shorthand for a document id. */
export function normalizeInstrumentDocumentId(
  documentId: string,
  inventory: InstrumentDocumentsToolResult | null,
): string {
  const candidate = documentId.trim()
  if (!inventory || inventory.status !== 'available') return candidate
  if (inventory.documents.some((document) => document.id === candidate)) return candidate
  const prefix = 'instrument-document:'
  if (!candidate.startsWith(prefix)) return candidate
  const bareId = candidate.slice(prefix.length)
  const matches = inventory.documents.filter((document) => document.id === bareId)
  return matches.length === 1 ? bareId : candidate
}

export function normalizeAccreditedRealityToolRequest(
  request: AccreditedRealityToolCall,
  inventory: InstrumentDocumentsToolResult | null,
): AccreditedRealityToolCall {
  if (request.toolName !== 'get_instrument_document_content') return request
  return {
    ...request,
    arguments: {
      ...request.arguments,
      documentId: normalizeInstrumentDocumentId(request.arguments.documentId, inventory),
    },
  }
}

export interface AccreditedRealityReasonerClaim {
  id: string
  type: 'territorial_fact' | 'normative_fact' | 'normative_conditional' | 'parcel_conclusion' | 'limitation'
  text: string
  sourceRefs: string[]
  appliesToParcel: boolean | 'conditional' | 'unknown'
  numericTokens: string[]
}

export interface AccreditedRealityReasonerOutput {
  answerMode: 'definitive' | 'conditional' | 'partial' | 'abstain'
  claims: AccreditedRealityReasonerClaim[]
  missingFacts: string[]
}

function parseAccreditedRealityModelValue(value: unknown): AccreditedRealityModelResponse | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const parsed = value as Record<string, unknown>
  if (parsed.action === 'tool_call' && parsed.toolName === 'get_cartographic_view') {
    const args = parseCartographicArguments(parsed.toolArguments)
    return args ? { action: 'tool_call', toolName: 'get_cartographic_view', arguments: args } : null
  }
  if (parsed.action === 'tool_call' && parsed.toolName === 'get_instrument_documents' && parsed.toolArguments && typeof parsed.toolArguments === 'object' && Object.keys(parsed.toolArguments).length === 0) {
    return { action: 'tool_call', toolName: 'get_instrument_documents', arguments: {} }
  }
  if (parsed.action === 'tool_call' && parsed.toolName === 'get_instrument_document_content' && parsed.toolArguments && typeof parsed.toolArguments === 'object') {
    const args = parsed.toolArguments as Record<string, unknown>
    if (Object.keys(args).length === 2 && typeof args.documentId === 'string' && args.documentId.trim() && typeof args.query === 'string' && args.query.trim()) {
      return { action: 'tool_call', toolName: 'get_instrument_document_content', arguments: { documentId: args.documentId.trim(), query: args.query.trim() } }
    }
  }
  if (parsed.action === 'final' &&
    ['definitive', 'conditional', 'partial', 'abstain'].includes(String(parsed.answerMode)) &&
    Array.isArray(parsed.claims) && Array.isArray(parsed.missingFacts) &&
    parsed.claims.every((claim) => {
      if (!claim || typeof claim !== 'object') return false
      const value = claim as Record<string, unknown>
      return typeof value.id === 'string' &&
        ['territorial_fact', 'normative_fact', 'normative_conditional', 'parcel_conclusion', 'limitation'].includes(String(value.type)) &&
        typeof value.text === 'string' && Array.isArray(value.sourceRefs) && value.sourceRefs.every((ref) => typeof ref === 'string' || typeof ref === 'number') &&
        (typeof value.appliesToParcel === 'boolean' || value.appliesToParcel === 'conditional' || value.appliesToParcel === 'unknown') &&
        Array.isArray(value.numericTokens) && value.numericTokens.every((token) => typeof token === 'string')
    }) && parsed.missingFacts.every((fact) => typeof fact === 'string')) {
    return {
      action: 'final',
      output: {
        answerMode: parsed.answerMode as AccreditedRealityReasonerOutput['answerMode'],
        claims: (parsed.claims as Array<Record<string, unknown>>).map((claim) => ({
          ...claim,
          sourceRefs: (claim.sourceRefs as Array<string | number>).map((ref) => String(ref)),
        })) as AccreditedRealityReasonerClaim[],
        missingFacts: parsed.missingFacts as string[],
      },
    }
  }
  return null
}

function findJsonValueEnd(rawContent: string, start: number): number | null {
  const opening = rawContent[start]
  if (opening !== '{' && opening !== '[') return null
  const stack: string[] = []
  let inString = false
  let escaped = false
  for (let index = start; index < rawContent.length; index += 1) {
    const character = rawContent[index]
    if (inString) {
      if (escaped) escaped = false
      else if (character === '\\') escaped = true
      else if (character === '"') inString = false
      continue
    }
    if (character === '"') {
      inString = true
      continue
    }
    if (character === '{' || character === '[') stack.push(character)
    else if (character === '}' || character === ']') {
      const expected = character === '}' ? '{' : '['
      if (stack.pop() !== expected) return null
      if (stack.length === 0) return index + 1
    }
  }
  return null
}

/** Parses one JSON response, a top-level action array, or legacy concatenated JSON values. */
export function parseAccreditedRealityModelResponseSequence(rawContent: string): AccreditedRealityModelResponseSequence | null {
  try {
    const values: unknown[] = []
    let cursor = 0
    while (cursor < rawContent.length) {
      while (/\s/.test(rawContent[cursor] ?? '')) cursor += 1
      if (cursor >= rawContent.length) break
      const end = findJsonValueEnd(rawContent, cursor)
      if (end === null) return null
      values.push(JSON.parse(rawContent.slice(cursor, end)))
      cursor = end
    }
    const flattened = values.flatMap((value) => Array.isArray(value) ? value : [value])
    if (flattened.length === 0) return null
    const parsed = flattened.map(parseAccreditedRealityModelValue)
    return parsed.every((item): item is AccreditedRealityModelResponse => item !== null) ? parsed : null
  } catch {
    return null
  }
}

export function parseAccreditedRealityModelResponse(rawContent: string): AccreditedRealityModelResponse | null {
  return parseAccreditedRealityModelResponseSequence(rawContent)?.[0] ?? null
}

export interface InstrumentDocumentsToolResult {
  toolName: 'get_instrument_documents'
  status: 'available' | 'unavailable' | 'error'
  municipalityCode: string | null
  instrumentId: string | null
  documents: Array<Pick<PlanningDocumentReference, 'id' | 'instrumentId' | 'title' | 'documentType' | 'sourceUrl' | 'binding' | 'preview'>>
  provenance: { source: 'siotuga'; retrievedAt: string; method: string } | null
  message?: string
}

/** Build the same allowlisted inventory shape from documents already accredited in the parcel package. */
export function accreditedPlanningDocumentsAsInventory(input: {
  municipalityCode?: string | null
  instrumentId?: string | null
  documents?: PlanningDocumentReference[] | null
  retrievedAt?: string
}): InstrumentDocumentsToolResult | null {
  const municipalityCode = input.municipalityCode?.trim() || null
  const instrumentId = input.instrumentId?.trim() || null
  if (!municipalityCode || !instrumentId || !input.documents?.length) return null
  const documents = input.documents
    .filter((document) => document.instrumentId === instrumentId)
    .map(({ id, instrumentId: documentInstrumentId, title, documentType, sourceUrl, binding, preview }) => ({
      id,
      instrumentId: documentInstrumentId,
      title,
      documentType,
      sourceUrl,
      binding,
      ...(preview ? { preview } : {}),
    }))
  if (documents.length === 0) return null
  return {
    toolName: 'get_instrument_documents',
    status: 'available',
    municipalityCode,
    instrumentId,
    documents,
    provenance: {
      source: 'siotuga',
      retrievedAt: input.retrievedAt ?? new Date().toISOString(),
      method: 'accredited reality planning document inventory',
    },
  }
}

export interface InstrumentDocumentContentFragment {
  stableSourceRef: string
  officialDocumentId: string
  chunkId: string
  text: string
  page?: number | null
  article?: string | null
  chapter?: string | null
  documentName?: string | null
  sourceUrl: string
  checksum?: string | null
}

export interface InstrumentDocumentContentToolResult {
  toolName: 'get_instrument_document_content'
  status: 'available' | 'not_found' | 'not_ingested' | 'unavailable' | 'error'
  municipalityCode: string | null
  instrumentId: string | null
  documentId: string
  document: InstrumentDocumentsToolResult['documents'][number] | null
  query: string
  fragments: InstrumentDocumentContentFragment[]
  provenance: { source: 'normative_chunks_v2' | 'normativa_chunks' | 'official_document'; retrievedAt: string; method: string } | null
  message?: string
}

export type AccreditedRealityToolExecutionResult = InstrumentDocumentsToolResult | InstrumentDocumentContentToolResult | CartographicToolResult

export function findReusableAccreditedRealityToolResult(
  history: ReadonlyArray<{ request: AccreditedRealityToolCall; result: AccreditedRealityToolExecutionResult }>,
  request: AccreditedRealityToolCall,
) {
  const key = accreditedRealityToolRequestKey(request)
  return history.find((entry) => accreditedRealityToolRequestKey(entry.request) === key && entry.result.status !== 'error') ?? null
}

export interface LegacyNormativeChunkRow {
  chunk_id?: unknown
  texto?: unknown
  nombre_pdf?: unknown
  titulo_detectado?: unknown
  ruta_pdf?: unknown
  metadata?: unknown
}

export function rankLegacyNormativeChunkRows(input: {
  rows: LegacyNormativeChunkRow[]
  terms: string[]
  officialDocumentId: string
  sourceUrl: string
  limit?: number
}): InstrumentDocumentContentFragment[] {
  const normalize = (value: string) => value.toLocaleLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '')
  const score = (text: string) => input.terms.reduce((total, term) => total + (normalize(text).includes(term) ? 1 : 0), 0)
  return input.rows
    .map((row) => ({ row, score: score(String(row.texto ?? '')) }))
    .filter((item) => input.terms.length === 0 || item.score > 0)
    .sort((left, right) => right.score - left.score)
    .slice(0, input.limit ?? 12)
    .map(({ row }) => ({
      stableSourceRef: `instrument-document:${input.officialDocumentId}:chunk:${String(row.chunk_id)}`,
      officialDocumentId: input.officialDocumentId,
      chunkId: String(row.chunk_id),
      text: String(row.texto ?? ''),
      // normativa_chunks has no dedicated page column. Do not infer one
      // from titulo_detectado or other presentation text.
      page: null,
      article: null,
      chapter: typeof row.titulo_detectado === 'string' ? row.titulo_detectado : null,
      documentName: typeof row.nombre_pdf === 'string' ? row.nombre_pdf : input.officialDocumentId,
      sourceUrl: input.sourceUrl,
      checksum: null,
    }))
}

/** Defensive ceiling for the experimental branch: inventory plus a few bounded document reads. */
export const ACCREDITED_REALITY_MAX_TOOL_CALLS = 4

export async function executeGetInstrumentDocumentsTool(input: {
  municipalityCode?: string | null
  instrumentId?: string | null
  retrievedAt?: string
  collect: (municipalityCode: string, instrumentId: string, retrievedAt: string) => Promise<{ documents: PlanningDocumentReference[] }>
}): Promise<InstrumentDocumentsToolResult> {
  const municipalityCode = input.municipalityCode?.trim() || null
  const instrumentId = input.instrumentId?.trim() || null
  const retrievedAt = input.retrievedAt ?? new Date().toISOString()
  if (!municipalityCode || !instrumentId) {
    return { toolName: 'get_instrument_documents', status: 'unavailable', municipalityCode, instrumentId, documents: [], provenance: null, message: 'El expediente no acredita municipio e instrumento suficientes para consultar documentos.' }
  }
  try {
    const collected = await input.collect(municipalityCode, instrumentId, retrievedAt)
    const documents = collected.documents
      .filter((document) => document.instrumentId === instrumentId)
      .map(({ id, instrumentId: documentInstrumentId, title, documentType, sourceUrl, binding, preview }) => ({
        id,
        instrumentId: documentInstrumentId,
        title,
        documentType,
        sourceUrl,
        binding,
        ...(preview ? { preview } : {}),
      }))
    return { toolName: 'get_instrument_documents', status: 'available', municipalityCode, instrumentId, documents, provenance: { source: 'siotuga', retrievedAt, method: 'SIOTUGA instrument document inventory' } }
  } catch {
    return { toolName: 'get_instrument_documents', status: 'error', municipalityCode, instrumentId, documents: [], provenance: { source: 'siotuga', retrievedAt, method: 'SIOTUGA instrument document inventory' }, message: 'La fuente oficial no pudo devolver el inventario de documentos.' }
  }
}

export function instrumentDocumentsAsCandidates(result: InstrumentDocumentsToolResult): NormativeCandidate[] {
  return result.documents.map((document) => ({
    id: `instrument-document:${document.id}`,
    sourceAliases: [String(document.id), document.instrumentId].filter((value): value is string => Boolean(value)),
    content: [
      `SOURCE_REF: instrument-document:${document.id}`,
      'EVIDENCIA OFICIAL DE DISPONIBILIDAD DOCUMENTAL',
      `Título: ${document.title}`,
      `Tipo: ${document.documentType ?? 'no especificado'}`,
      document.preview ? `Preview: ${document.preview}` : undefined,
      `Instrumento: ${document.instrumentId ?? 'no especificado'}`,
      `Municipio INE: ${result.municipalityCode ?? 'no especificado'}`,
      `URL oficial: ${document.sourceUrl}`,
      `Estado: ${result.status}`,
    ].filter(Boolean).join('\n'),
    sourceUrl: document.sourceUrl,
    documentName: document.title,
    hierarchy: 'municipal',
    evidenceSpecificity: 'SPECIFIC',
    parentInstrument: document.instrumentId ?? null,
  }))
}

export function instrumentDocumentContentAsCandidates(result: InstrumentDocumentContentToolResult): NormativeCandidate[] {
  return result.fragments.map((fragment) => ({
    id: fragment.stableSourceRef,
    sourceAliases: [fragment.stableSourceRef, fragment.chunkId],
    content: [
      `SOURCE_REF: ${fragment.stableSourceRef}`,
      'EVIDENCIA OFICIAL DE CONTENIDO DOCUMENTAL',
      `Documento oficial: ${fragment.officialDocumentId}`,
      `Chunk: ${fragment.chunkId}`,
      fragment.page == null ? undefined : `Página: ${fragment.page}`,
      fragment.article ? `Artículo: ${fragment.article}` : undefined,
      fragment.chapter ? `Capítulo: ${fragment.chapter}` : undefined,
      `Contenido:\n${fragment.text}`,
    ].filter(Boolean).join('\n'),
    sourceUrl: fragment.sourceUrl,
    documentName: fragment.documentName ?? fragment.officialDocumentId,
    page: fragment.page,
    hierarchy: 'municipal',
    evidenceSpecificity: 'SPECIFIC',
    parentInstrument: result.instrumentId,
  }))
}

export async function executeGetInstrumentDocumentContentTool(input: {
  municipalityCode?: string | null
  instrumentId?: string | null
  inventory: InstrumentDocumentsToolResult | null
  documentId: string
  query: string
  retrievedAt?: string
  retrieve: (input: {
    municipalityCode: string
    instrumentId: string
    document: InstrumentDocumentsToolResult['documents'][number]
    query: string
    retrievedAt: string
  }) => Promise<Omit<InstrumentDocumentContentToolResult, 'toolName' | 'municipalityCode' | 'instrumentId' | 'documentId' | 'query' | 'document'>>
}): Promise<InstrumentDocumentContentToolResult> {
  const municipalityCode = input.municipalityCode?.trim() || null
  const instrumentId = input.instrumentId?.trim() || null
  const documentId = input.documentId.trim()
  const query = input.query.trim()
  const retrievedAt = input.retrievedAt ?? new Date().toISOString()
  if (!municipalityCode || !instrumentId) return { toolName: 'get_instrument_document_content', status: 'unavailable', municipalityCode, instrumentId, documentId, document: null, query, fragments: [], provenance: null, message: 'El expediente no acredita municipio e instrumento suficientes.' }
  if (!input.inventory || input.inventory.status !== 'available') return { toolName: 'get_instrument_document_content', status: 'unavailable', municipalityCode, instrumentId, documentId, document: null, query, fragments: [], provenance: null, message: 'Primero debe existir un inventario documental acreditado.' }
  const document = input.inventory.documents.find((candidate) => candidate.id === documentId && candidate.instrumentId === instrumentId)
  if (!document) return { toolName: 'get_instrument_document_content', status: 'not_found', municipalityCode, instrumentId, documentId, document: null, query, fragments: [], provenance: null, message: 'El documento no pertenece al inventario acreditado del instrumento activo.' }
  try {
    const result = await input.retrieve({ municipalityCode, instrumentId, document, query, retrievedAt })
    return { toolName: 'get_instrument_document_content', municipalityCode, instrumentId, documentId, document, query, ...result }
  } catch {
    return { toolName: 'get_instrument_document_content', status: 'error', municipalityCode, instrumentId, documentId, document, query, fragments: [], provenance: { source: 'official_document', retrievedAt, method: 'document content retrieval' }, message: 'La fuente documental no pudo devolver contenido.' }
  }
}

export function formatCompactToolHistory(
  history: Array<{ request: AccreditedRealityModelResponse; result: InstrumentDocumentsToolResult | InstrumentDocumentContentToolResult | CartographicToolResult }>,
): string {
  if (!Array.isArray(history) || history.length === 0) {
    return ''
  }

  const entries: string[] = []

  for (let index = 0; index < history.length; index += 1) {
    const item = history[index]
    const { request, result } = item
    const toolNumber = index + 1
    const sections: string[] = []

    if (request.action === 'tool_call') {
      sections.push(`--- LLAMADA ${toolNumber}: ${request.toolName} ---`)
      if (request.toolName === 'get_instrument_documents') {
        sections.push('[REQUEST] herramienta: get_instrument_documents')
      } else if (request.toolName === 'get_instrument_document_content') {
        const { documentId, query } = request.arguments
        sections.push(`[REQUEST] herramienta: get_instrument_document_content | documentId: ${documentId} | query: ${query}`)
      } else if (request.toolName === 'get_cartographic_view') {
        sections.push(`[REQUEST] herramienta: get_cartographic_view | arguments: ${JSON.stringify(request.arguments)}`)
      }
    } else {
      sections.push(`--- LLAMADA ${toolNumber}: final ---`)
    }

    sections.push(`[RESULTADO] status: ${result.status}`)

    if (result.toolName === 'get_instrument_documents') {
      if (result.message) {
        sections.push(`[MENSAJE] ${result.message}`)
      }
      if (Array.isArray(result.documents) && result.documents.length > 0) {
        const docLines = result.documents.map((doc) => {
          const parts = [`id: ${doc.id}`, `título: ${doc.title}`]
          if (doc.documentType) parts.push(`tipo: ${doc.documentType}`)
          if (doc.binding) parts.push(`vinculación: ${doc.binding}`)
          if (doc.preview) parts.push(`preview: ${doc.preview}`)
          return `  - ${parts.join(' | ')}`
        })
        sections.push(`[DOCUMENTOS DISPONIBLES]\n${docLines.join('\n')}`)
      }
    } else if (result.toolName === 'get_instrument_document_content') {
      if (result.message) {
        sections.push(`[MENSAJE] ${result.message}`)
      }
      if (Array.isArray(result.fragments) && result.fragments.length > 0) {
        const fragmentBlocks = result.fragments.map((fragment) => {
          const metaParts: string[] = [`REF: ${fragment.stableSourceRef}`]
          if (fragment.page != null) metaParts.push(`página: ${fragment.page}`)
          if (fragment.article) metaParts.push(`artículo: ${fragment.article}`)
          if (fragment.chapter) metaParts.push(`capítulo: ${fragment.chapter}`)

          return `[FRAGMENTO ${metaParts.join(' | ')}]\n${fragment.text}`
        })
        sections.push(fragmentBlocks.join('\n\n'))
      }
    } else if (result.toolName === 'get_cartographic_view') {
      if (Array.isArray(result.views) && result.views.length > 0) {
        const viewLines = result.views.map((v) => `  - id: ${v.id} | kind: ${v.kind}`)
        sections.push(`[VISTAS CARTOGRÁFICAS]\n${viewLines.join('\n')}`)
      }
      if (Array.isArray(result.limitations) && result.limitations.length > 0) {
        sections.push(`[LIMITACIONES]\n${result.limitations.join('\n')}`)
      }
    }

    entries.push(sections.join('\n'))
  }

  return entries.join('\n\n')
}

export interface AccreditedRealityContinuationPromptInput {
  systemPrompt: string
  userPrompt: string
  package?: AccreditedRealityPackage
  question?: string
}

export function buildAccreditedRealityContinuationPrompt(
  originalPrompt: AccreditedRealityContinuationPromptInput,
  history: Array<{ request: AccreditedRealityModelResponse; result: InstrumentDocumentsToolResult | InstrumentDocumentContentToolResult | CartographicToolResult }>,
) {
  const toolReferences = history.flatMap(({ result }) =>
    result.toolName === 'get_cartographic_view'
      ? result.views.map((view) => view.id)
      : result.toolName === 'get_instrument_document_content'
      ? result.fragments.map((fragment) => fragment.stableSourceRef)
      : result.documents.map((document) => `instrument-document:${document.id}`)
  )

  let minimalContextJson: string | null = null
  let question = originalPrompt.question ?? ''
  let baseSources: string[] = []

  if (originalPrompt.package) {
    const minimalContext = buildMinimalContinuationContext(originalPrompt.package)
    minimalContextJson = JSON.stringify(minimalContext, null, 2)
    baseSources = originalPrompt.package.sources.map((source) => source.id)
    if (!question) {
      const qMarker = 'CONSULTA DEL TÉCNICO:\n'
      const qIdx = originalPrompt.userPrompt.indexOf(qMarker)
      if (qIdx !== -1) {
        question = originalPrompt.userPrompt.slice(qIdx + qMarker.length).trim()
      }
    }
  } else if (originalPrompt.userPrompt.includes('PAQUETE FACTUAL ACREDITADO')) {
    try {
      const startJson = originalPrompt.userPrompt.indexOf('{')
      const endJson = originalPrompt.userPrompt.indexOf('\n\nIDENTIFICADORES ESTABLES')
      if (startJson !== -1 && endJson !== -1) {
        const rawJson = originalPrompt.userPrompt.slice(startJson, endJson)
        const parsed = JSON.parse(rawJson)
        const stripped: Record<string, unknown> = {
          parcel: parsed.parcel,
          urbanisticFacts: parsed.urbanisticFacts,
          ...(parsed.confirmedNormativeIdentity ? { confirmedNormativeIdentity: parsed.confirmedNormativeIdentity } : {}),
          unknowns: parsed.unknowns,
          warnings: parsed.warnings,
        }
        if (Array.isArray(parsed.conflicts) && parsed.conflicts.length > 0) {
          stripped.conflicts = parsed.conflicts
        }
        minimalContextJson = JSON.stringify(stripped, null, 2)
      }

      const srcMatch = originalPrompt.userPrompt.match(/IDENTIFICADORES ESTABLES PARA CITAS \(sourceRefs\):\s*(\[[\s\S]*?\])\s*Usa/m)
      if (srcMatch && srcMatch[1]) {
        const parsedSources = JSON.parse(srcMatch[1])
        if (Array.isArray(parsedSources)) {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          baseSources = parsedSources.map((item: any) => typeof item === 'string' ? item : item.sourceRef || item.id).filter(Boolean)
        }
      }

      const qMarker = 'CONSULTA DEL TÉCNICO:\n'
      const qIdx = originalPrompt.userPrompt.indexOf(qMarker)
      if (qIdx !== -1) {
        question = originalPrompt.userPrompt.slice(qIdx + qMarker.length).trim()
      }
    } catch {
      minimalContextJson = null
    }
  }

  const unifiedSourceRefs = [...new Set([...baseSources, ...toolReferences])]

  const userSections: string[] = []
  if (minimalContextJson) {
    userSections.push(`ESTADO ACREDITADO DE LA PARCELA:\n${minimalContextJson}`)
    userSections.push(`CONSULTA DEL TÉCNICO:\n${question || 'Consulta urbanística'}`)
  } else {
    userSections.push(originalPrompt.userPrompt)
  }

  userSections.push(`HISTORIAL DE HERRAMIENTAS ACREDITADAS:\n${formatCompactToolHistory(history)}`)
  userSections.push(`SOURCE_REFS DISPONIBLES PARA CITAR:\n${JSON.stringify(unifiedSourceRefs, null, 2)}`)
  userSections.push(`Continúa el análisis profesional: solicita otra herramienta sólo si es necesario; en caso contrario responde finalmente.`)

  return {
    systemPrompt: `${originalPrompt.systemPrompt}\n\nPuedes continuar solicitando una o varias herramientas read-only si necesitas otra evidencia. Cada acción debe cumplir el contrato allowlisted y no inventar argumentos. Si ya tienes suficiente evidencia, emite action=final.`,
    userPrompt: userSections.join('\n\n'),
  }
}

export function buildAccreditedRealityToolFollowupPrompt(originalPrompt: { systemPrompt: string; userPrompt: string }, request: AccreditedRealityModelResponse, result: InstrumentDocumentsToolResult) {
  return {
    systemPrompt: `${originalPrompt.systemPrompt}\n\nLa herramienta ya se ejecutó una vez. No solicites otra herramienta. Emite únicamente una respuesta final con action=final.`,
    userPrompt: `${originalPrompt.userPrompt}\n\nSOLICITUD DE HERRAMIENTA VALIDADA:\n${JSON.stringify(request)}\n\nRESULTADO NEUTRAL ACREDITADO DE LA HERRAMIENTA:\n${JSON.stringify(result, null, 2)}\n\nPara citar estos documentos usa exactamente el sourceRef estable instrument-document:<id>. No uses índices posicionales.\n\nRazona de nuevo y responde finalmente.`,
  }
}
