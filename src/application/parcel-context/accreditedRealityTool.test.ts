import { describe, expect, it, vi } from 'vitest'
import {
  accreditedRealityReasonerResponseSchema,
  ACCREDITED_REALITY_MAX_TOOL_CALLS,
  buildAccreditedRealityContinuationPrompt,
  buildAccreditedRealityToolFollowupPrompt,
  executeGetInstrumentDocumentContentTool,
  executeGetInstrumentDocumentsTool,
  accreditedPlanningDocumentsAsInventory,
  instrumentDocumentContentAsCandidates,
  instrumentDocumentsAsCandidates,
  parseAccreditedRealityModelResponse,
  parseAccreditedRealityModelResponseSequence,
  rankLegacyNormativeChunkRows,
  normalizeInstrumentDocumentId,
  accreditedRealityToolRequestKey,
  findReusableAccreditedRealityToolResult,
} from './accreditedRealityTool'

const finalResponse = JSON.stringify({
  action: 'final',
  toolName: null,
  toolArguments: {},
  answerMode: 'partial',
  claims: [],
  missingFacts: ['documentación oficial'],
})

describe('accredited reality instrument documents tool', () => {
  it('accepts a direct final response without a tool call', () => {
    expect(parseAccreditedRealityModelResponse(finalResponse)?.action).toBe('final')
  })

  it('parses a structured action array and legacy concatenated JSON values', () => {
    const tool = { action: 'tool_call', toolName: 'get_instrument_document_content', toolArguments: { documentId: '96584', query: 'ordenanza' }, answerMode: 'partial', claims: [], missingFacts: [] }
    const final = { ...JSON.parse(finalResponse), action: 'final' }
    expect(parseAccreditedRealityModelResponseSequence(JSON.stringify([tool, final]))?.map((item) => item.action)).toEqual(['tool_call', 'final'])
    expect(parseAccreditedRealityModelResponseSequence(`${JSON.stringify(tool)}${JSON.stringify(final)}`)?.map((item) => item.action)).toEqual(['tool_call', 'final'])
    expect(parseAccreditedRealityModelResponseSequence(`${JSON.stringify(tool)} trailing`)).toBeNull()
  })

  it('ranks existing V1 chunks without requiring a dedicated page column', () => {
    const fragments = rankLegacyNormativeChunkRows({
      rows: [
        { chunk_id: 'c1', texto: 'Ordenanza de usos y edificabilidad', nombre_pdf: '27891no002.pdf', titulo_detectado: '--- PAGINA 1 ---' },
        { chunk_id: 'c2', texto: 'Texto sin coincidencia', nombre_pdf: '27891no002.pdf', titulo_detectado: '--- PAGINA 2 ---' },
      ],
      terms: ['ordenanza', 'edificabilidad'],
      officialDocumentId: '96584',
      sourceUrl: 'https://siotuga.xunta.gal/27891no002.pdf',
    })
    expect(fragments).toHaveLength(1)
    expect(fragments[0]).toMatchObject({ stableSourceRef: 'instrument-document:96584:chunk:c1', chunkId: 'c1', page: null })
    expect(fragments[0]?.chapter).toBe('--- PAGINA 1 ---')
  })

  it('normalizes numeric official IDs on the wire to stable string references', () => {
    const parsed = parseAccreditedRealityModelResponse(JSON.stringify({
      action: 'final', toolName: null, toolArguments: {}, answerMode: 'partial',
      claims: [{ id: 'c1', type: 'limitation', text: 'Revisión pendiente', sourceRefs: [96582], appliesToParcel: 'conditional', numericTokens: [] }], missingFacts: [],
    }))
    expect(parsed?.action === 'final' ? parsed.output.claims[0]?.sourceRefs : null).toEqual(['96582'])
  })

  it('accepts only the empty, named tool request', () => {
    const request = parseAccreditedRealityModelResponse(JSON.stringify({
      action: 'tool_call', toolName: 'get_instrument_documents', toolArguments: {},
      answerMode: 'abstain', claims: [], missingFacts: [],
    }))
    expect(request).toMatchObject({ action: 'tool_call', toolName: 'get_instrument_documents', arguments: {} })
    expect(parseAccreditedRealityModelResponse(JSON.stringify({
      action: 'tool_call', toolName: 'get_instrument_documents', toolArguments: { municipalityCode: '99999', instrumentId: 'other', url: 'https://evil.test' },
      answerMode: 'abstain', claims: [], missingFacts: [],
    }))).toBeNull()
    expect(parseAccreditedRealityModelResponse(JSON.stringify({
      action: 'tool_call', toolName: 'get_instrument_document_content', toolArguments: { documentId: 'doc-1', query: 'ordenanza' },
      answerMode: 'abstain', claims: [], missingFacts: [],
    })).action).toBe('tool_call')
    expect(parseAccreditedRealityModelResponse(JSON.stringify({
      action: 'tool_call', toolName: 'get_instrument_document_content', toolArguments: { documentId: 'doc-1', query: 'ordenanza', url: 'https://evil.test' },
      answerMode: 'abstain', claims: [], missingFacts: [],
    }))).toBeNull()
  })

  it('uses only server supplied municipality and instrument and returns neutral documents', async () => {
    const collect = vi.fn(async (municipalityCode: string, instrumentId: string) => ({ documents: [{
      id: 'doc-1', instrumentId, title: 'Normativa oficial', sourceUrl: 'https://official.test/doc.pdf', binding: 'general' as const, documentType: 'normative_text' as const,
    }] }))
    const result = await executeGetInstrumentDocumentsTool({ municipalityCode: '15058', instrumentId: '27891', collect })
    expect(collect).toHaveBeenCalledWith('15058', '27891', expect.any(String))
    expect(result.documents[0]).toMatchObject({ id: 'doc-1', instrumentId: '27891', sourceUrl: 'https://official.test/doc.pdf' })
    expect(instrumentDocumentsAsCandidates(result)[0]?.content).toContain('EVIDENCIA OFICIAL DE DISPONIBILIDAD DOCUMENTAL')
  })

  it('fails closed when the canonical context lacks municipality or instrument', async () => {
    const collect = vi.fn()
    const result = await executeGetInstrumentDocumentsTool({ municipalityCode: null, instrumentId: null, collect })
    expect(result.status).toBe('unavailable')
    expect(collect).not.toHaveBeenCalled()
  })

  it('exposes a strict schema with no arbitrary tool arguments', () => {
    expect((accreditedRealityReasonerResponseSchema.properties.toolArguments as any).anyOf.every((branch: any) => branch.additionalProperties === false)).toBe(true)
    expect(accreditedRealityReasonerResponseSchema.required).toContain('toolName')
  })

  it('accepts a document only when it belongs to the accredited active inventory', async () => {
    const inventory = { toolName: 'get_instrument_documents' as const, status: 'available' as const, municipalityCode: '15058', instrumentId: '27891', documents: [{ id: 'doc-1', instrumentId: '27891', title: 'Normativa', sourceUrl: 'https://official.test/doc.pdf', binding: 'general' as const }], provenance: null }
    const retrieve = vi.fn(async () => ({ status: 'available' as const, fragments: [{ stableSourceRef: 'instrument-document:doc-1:chunk:c1', officialDocumentId: 'doc-1', chunkId: 'c1', text: 'Ordenanza 1', page: 3, article: 'Art. 1', chapter: null, documentName: 'doc.pdf', sourceUrl: 'https://official.test/doc.pdf', checksum: 'hash' }], provenance: { source: 'normativa_chunks' as const, retrievedAt: '2026-01-01T00:00:00.000Z', method: 'exact document' } }))
    const result = await executeGetInstrumentDocumentContentTool({ municipalityCode: '15058', instrumentId: '27891', inventory, documentId: 'doc-1', query: 'ordenanza', retrieve })
    expect(result.status).toBe('available')
    expect(retrieve).toHaveBeenCalledOnce()
    expect(instrumentDocumentContentAsCandidates(result)[0]).toMatchObject({ id: 'instrument-document:doc-1:chunk:c1', page: 3, sourceUrl: 'https://official.test/doc.pdf' })
    const wrongInstrument = await executeGetInstrumentDocumentContentTool({ municipalityCode: '15058', instrumentId: 'other', inventory, documentId: 'doc-1', query: 'ordenanza', retrieve })
    expect(wrongInstrument.status).toBe('not_found')
    const invented = await executeGetInstrumentDocumentContentTool({ municipalityCode: '15058', instrumentId: '27891', inventory, documentId: 'evil', query: 'ordenanza', retrieve })
    expect(invented.status).toBe('not_found')
  })

  it('builds Cariño 22262 inventory from already accredited planning documents', async () => {
    const inventory = accreditedPlanningDocumentsAsInventory({
      municipalityCode: '15901',
      instrumentId: '22262',
      retrievedAt: '2026-09-18T00:00:00.000Z',
      documents: [
        { id: '46722', instrumentId: '22262', title: 'Normativa SNR', sourceUrl: 'https://official.test/46722.pdf', binding: 'general' },
        { id: '46723', instrumentId: '22262', title: 'Ficha Vilar', sourceUrl: 'https://official.test/46723.pdf', binding: 'area_specific' },
        { id: 'other', instrumentId: '99999', title: 'Otro instrumento', sourceUrl: 'https://official.test/other.pdf', binding: 'general' },
      ],
    })
    expect(inventory).toMatchObject({ status: 'available', municipalityCode: '15901', instrumentId: '22262' })
    expect(inventory?.documents.map((document) => document.id)).toEqual(['46722', '46723'])
    const retrieve = vi.fn(async ({ document }: { document: { id: string } }) => ({ status: 'available' as const, fragments: [], provenance: { source: 'official_document' as const, retrievedAt: '2026-09-18T00:00:00.000Z', method: document.id } }))
    const result = await executeGetInstrumentDocumentContentTool({ municipalityCode: '15901', instrumentId: '22262', inventory, documentId: '46722', query: 'núcleo rural', retrieve })
    expect(result.status).toBe('available')
    expect(retrieve).toHaveBeenCalledOnce()
  })

  it('does not create an inventory when accredited planning documents are absent or for another instrument', () => {
    expect(accreditedPlanningDocumentsAsInventory({ municipalityCode: '15901', instrumentId: '22262', documents: [] })).toBeNull()
    expect(accreditedPlanningDocumentsAsInventory({ municipalityCode: '15901', instrumentId: '22262', documents: [{ id: 'other', instrumentId: '99999', title: 'Otro', sourceUrl: 'https://official.test/other.pdf', binding: 'general' }] })).toBeNull()
  })

  it('normalizes a prefixed document id only when the accredited inventory proves it', () => {
    const inventory = { toolName: 'get_instrument_documents' as const, status: 'available' as const, municipalityCode: '15009', instrumentId: '22221', documents: [
      { id: '46479', instrumentId: '22221', title: 'Normativa', sourceUrl: 'https://official.test/0060no011.pdf', binding: 'general' as const },
    ], provenance: null }
    expect(normalizeInstrumentDocumentId('instrument-document:46479', inventory)).toBe('46479')
    expect(normalizeInstrumentDocumentId('instrument-document:99999', inventory)).toBe('instrument-document:99999')
  })

  it('does not normalize an ambiguous prefixed id', () => {
    const inventory = { toolName: 'get_instrument_documents' as const, status: 'available' as const, municipalityCode: '15009', instrumentId: '22221', documents: [
      { id: '46479', instrumentId: '22221', title: 'A', sourceUrl: 'https://official.test/a.pdf', binding: 'general' as const },
      { id: '46479', instrumentId: '22221', title: 'B', sourceUrl: 'https://official.test/b.pdf', binding: 'general' as const },
    ], provenance: null }
    expect(normalizeInstrumentDocumentId('instrument-document:46479', inventory)).toBe('instrument-document:46479')
  })

  it('gives identical tool requests one deterministic key', () => {
    const first = { action: 'tool_call' as const, toolName: 'get_instrument_documents' as const, arguments: {} }
    const second = { action: 'tool_call' as const, toolName: 'get_instrument_documents' as const, arguments: {} }
    expect(accreditedRealityToolRequestKey(first)).toBe(accreditedRealityToolRequestKey(second))
    const result = { toolName: 'get_instrument_documents' as const, status: 'available' as const, municipalityCode: '15009', instrumentId: '22221', documents: [], provenance: null }
    expect(findReusableAccreditedRealityToolResult([{ request: first, result }], second)?.result).toBe(result)
  })

  it('preserves a diagnostic retrieval error without widening scope', async () => {
    const inventory = { toolName: 'get_instrument_documents' as const, status: 'available' as const, municipalityCode: '15058', instrumentId: '27891', documents: [{ id: '96584', instrumentId: '27891', title: 'Normativa', sourceUrl: 'https://official.test/27891no002.pdf', binding: 'general' as const }], provenance: null }
    const result = await executeGetInstrumentDocumentContentTool({ municipalityCode: '15058', instrumentId: '27891', inventory, documentId: '96584', query: 'ordenanza', retrieve: async () => ({ status: 'error' as const, fragments: [], provenance: { source: 'normativa_chunks' as const, retrievedAt: '2026-01-01T00:00:00.000Z', method: 'exact municipality + corpus filename scope' }, message: 'column "pagina_detectada" does not exist' }) })
    expect(result.status).toBe('error')
    expect(result.message).toContain('pagina_detectada')
  })

  it('keeps content retrieval scoped to the requested document and carries history forward', async () => {
    const inventory = { toolName: 'get_instrument_documents' as const, status: 'available' as const, municipalityCode: '15058', instrumentId: '27891', documents: [{ id: 'doc-1', instrumentId: '27891', title: 'Normativa', sourceUrl: 'https://official.test/doc.pdf', binding: 'general' as const }], provenance: null }
    const retrieve = vi.fn(async ({ document }: { document: { id: string } }) => ({ status: 'not_ingested' as const, fragments: [], provenance: { source: 'normativa_chunks' as const, retrievedAt: '2026-01-01T00:00:00.000Z', method: `exact:${document.id}` } }))
    const result = await executeGetInstrumentDocumentContentTool({ municipalityCode: '15058', instrumentId: '27891', inventory, documentId: 'doc-1', query: 'altura', retrieve })
    expect(result.provenance?.method).toBe('exact:doc-1')
    expect(retrieve).toHaveBeenCalledWith(expect.objectContaining({ document: expect.objectContaining({ id: 'doc-1' }), query: 'altura', municipalityCode: '15058', instrumentId: '27891' }))
    const continuation = buildAccreditedRealityContinuationPrompt(
      { systemPrompt: 'base', userPrompt: 'question' },
      [{ request: { action: 'tool_call', toolName: 'get_instrument_documents', arguments: {} }, result: inventory }, { request: { action: 'tool_call', toolName: 'get_instrument_document_content', arguments: { documentId: 'doc-1', query: 'altura' } }, result }],
    )
    expect(continuation.userPrompt).toContain('instrument-document:doc-1')
    expect(continuation.systemPrompt).toContain('otra evidencia')
  })

  it('publishes a finite defensive ceiling for chained read-only calls', () => {
    expect(ACCREDITED_REALITY_MAX_TOOL_CALLS).toBe(4)
  })

  it('builds the single follow-up request with the tool result and no second tool request', () => {
    const request = parseAccreditedRealityModelResponse(JSON.stringify({
      action: 'tool_call', toolName: 'get_instrument_documents', toolArguments: {},
      answerMode: 'abstain', claims: [], missingFacts: [],
    }))!
    const followup = buildAccreditedRealityToolFollowupPrompt(
      { systemPrompt: 'base', userPrompt: 'question' },
      request,
      { toolName: 'get_instrument_documents', status: 'available', municipalityCode: '15058', instrumentId: '27891', documents: [], provenance: { source: 'siotuga', retrievedAt: '2026-01-01T00:00:00.000Z', method: 'inventory' } },
    )
    expect(followup.systemPrompt).toContain('No solicites otra herramienta')
    expect(followup.userPrompt).toContain('RESULTADO NEUTRAL ACREDITADO')
  })
})
