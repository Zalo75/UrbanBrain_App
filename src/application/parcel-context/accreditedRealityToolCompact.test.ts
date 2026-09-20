import { describe, expect, it } from 'vitest'
import {
  formatCompactToolHistory,
  buildAccreditedRealityContinuationPrompt,
  type AccreditedRealityModelResponse,
  type InstrumentDocumentsToolResult,
  type InstrumentDocumentContentToolResult,
} from './accreditedRealityTool'

describe('formatCompactToolHistory - Instrumento 22262 (Docs 46722 y 46723)', () => {
  const literalTextDoc46723 = 'Artigo 45. Condicións de edificación no Núcleo Rural Tradicional.\nA tipoloxía edificatoria responderá ás características da arquitectura tradicional galega.'
  const literalTextDoc46722 = 'Artigo 12. Réxime xeral do solo de núcleo rural.\n1. Son parcelas mínimas as establecidas nas ordenanzas particulares.'

  const call1Request: AccreditedRealityModelResponse = {
    action: 'tool_call',
    toolName: 'get_instrument_documents',
    arguments: {},
  }
  const call1Result: InstrumentDocumentsToolResult = {
    toolName: 'get_instrument_documents',
    status: 'available',
    municipalityCode: '15901',
    instrumentId: '22262',
    documents: [
      {
        id: '46722',
        instrumentId: '22262',
        title: 'Título VII Normativa de Núcleo Rural',
        documentType: 'normative_text',
        sourceUrl: 'https://siotuga.xunta.gal/siotuga/descargaDoc.php?id=46722',
        binding: 'general',
      },
      {
        id: '46723',
        instrumentId: '22262',
        title: 'Título VII Fichas de Núcleo Rural',
        documentType: 'normative_text',
        sourceUrl: 'https://siotuga.xunta.gal/siotuga/descargaDoc.php?id=46723',
        binding: 'general',
      },
    ],
    provenance: {
      source: 'siotuga',
      retrievedAt: '2026-09-18T10:00:00.000Z',
      method: 'SIOTUGA instrument document inventory',
    },
  }

  const call2Request: AccreditedRealityModelResponse = {
    action: 'tool_call',
    toolName: 'get_instrument_document_content',
    arguments: { documentId: '46723', query: 'edificación tradicional' },
  }
  const call2Result: InstrumentDocumentContentToolResult = {
    toolName: 'get_instrument_document_content',
    status: 'available',
    municipalityCode: '15901',
    instrumentId: '22262',
    documentId: '46723',
    document: call1Result.documents[1],
    query: 'edificación tradicional',
    fragments: [
      {
        stableSourceRef: 'instrument-document:46723:chunk:c101',
        officialDocumentId: '46723',
        chunkId: 'c101',
        text: literalTextDoc46723,
        page: 45,
        article: 'Art. 45',
        chapter: 'Título VII',
        documentName: '46723_fichas.pdf',
        sourceUrl: 'https://siotuga.xunta.gal/siotuga/descargaDoc.php?id=46723',
        checksum: 'sha256_checksum_46723',
      },
    ],
    provenance: {
      source: 'normative_chunks_v2',
      retrievedAt: '2026-09-18T10:01:00.000Z',
      method: 'exact officialDocumentId + instrument',
    },
  }

  const call3Request: AccreditedRealityModelResponse = {
    action: 'tool_call',
    toolName: 'get_instrument_document_content',
    arguments: { documentId: '46722', query: 'parcela mínima' },
  }
  const call3Result: InstrumentDocumentContentToolResult = {
    toolName: 'get_instrument_document_content',
    status: 'available',
    municipalityCode: '15901',
    instrumentId: '22262',
    documentId: '46722',
    document: call1Result.documents[0],
    query: 'parcela mínima',
    fragments: [
      {
        stableSourceRef: 'instrument-document:46722:chunk:c202',
        officialDocumentId: '46722',
        chunkId: 'c202',
        text: literalTextDoc46722,
        page: null,
        article: null,
        chapter: null,
        documentName: '46722_normativa.pdf',
        sourceUrl: 'https://siotuga.xunta.gal/siotuga/descargaDoc.php?id=46722',
        checksum: null,
      },
    ],
    provenance: {
      source: 'normativa_chunks',
      retrievedAt: '2026-09-18T10:02:00.000Z',
      method: 'exact municipality + corpus filename scope',
    },
  }

  it('1. Demuestra output determinista', () => {
    const history = [
      { request: call1Request, result: call1Result },
      { request: call2Request, result: call2Result },
    ]
    const runA = formatCompactToolHistory(history)
    const runB = formatCompactToolHistory(history)
    expect(runA).toBe(runB)
    expect(runA.length).toBeGreaterThan(0)
  })

  it('2. Conserva exactamente el texto normativo literal sin alteraciones ni resúmenes', () => {
    const history = [
      { request: call2Request, result: call2Result },
      { request: call3Request, result: call3Result },
    ]
    const output = formatCompactToolHistory(history)
    expect(output).toContain(literalTextDoc46723)
    expect(output).toContain(literalTextDoc46722)
  })

  it('3. Conserva exactamente los stableSourceRef', () => {
    const history = [
      { request: call2Request, result: call2Result },
      { request: call3Request, result: call3Result },
    ]
    const output = formatCompactToolHistory(history)
    expect(output).toContain('instrument-document:46723:chunk:c101')
    expect(output).toContain('instrument-document:46722:chunk:c202')
  })

  it('4. Conserva page, article y chapter cuando existen', () => {
    const history = [{ request: call2Request, result: call2Result }]
    const output = formatCompactToolHistory(history)
    expect(output).toContain('45')
    expect(output).toContain('Art. 45')
    expect(output).toContain('Título VII')
  })

  it('5. No renderiza null ni undefined para campos ausentes', () => {
    const history = [{ request: call3Request, result: call3Result }]
    const output = formatCompactToolHistory(history)
    expect(output.toLowerCase()).not.toContain('null')
    expect(output.toLowerCase()).not.toContain('undefined')
  })

  it('6. Omite sourceUrl, provenance y checksum redundantes en el historial', () => {
    const history = [
      { request: call1Request, result: call1Result },
      { request: call2Request, result: call2Result },
      { request: call3Request, result: call3Result },
    ]
    const output = formatCompactToolHistory(history)
    expect(output).not.toContain('https://siotuga.xunta.gal')
    expect(output).not.toContain('sha256_checksum_46723')
    expect(output).not.toContain('SIOTUGA instrument document inventory')
    expect(output).not.toContain('exact officialDocumentId')
    expect(output).not.toContain('exact municipality + corpus')
  })

  it('7. No genera JSON indentado ni estructura pesada con comillas y llaves innecesarias', () => {
    const history = [
      { request: call2Request, result: call2Result },
      { request: call3Request, result: call3Result },
    ]
    const output = formatCompactToolHistory(history)
    expect(output).not.toContain('"fragments": [')
    expect(output).not.toContain('{\n  "stableSourceRef"')
    expect(output).not.toContain('"toolName":')
  })

  it('8. Múltiples tools siguen representándose estructuradamente', () => {
    const history = [
      { request: call1Request, result: call1Result },
      { request: call2Request, result: call2Result },
    ]
    const output = formatCompactToolHistory(history)
    expect(output).toContain('get_instrument_documents')
    expect(output).toContain('get_instrument_document_content')
    expect(output).toContain('46723')
    expect(output).toContain('edificación tradicional')
    expect(output).toContain('Título VII Normativa de Núcleo Rural')
    expect(output).toContain('Título VII Fichas de Núcleo Rural')
  })

  it('9. Los resultados históricos siguen íntegramente presentes al añadir una nueva tool', () => {
    const step1 = formatCompactToolHistory([
      { request: call1Request, result: call1Result },
      { request: call2Request, result: call2Result },
    ])
    const step2 = formatCompactToolHistory([
      { request: call1Request, result: call1Result },
      { request: call2Request, result: call2Result },
      { request: call3Request, result: call3Result },
    ])
    // Step 2 contains everything from step 1, plus call 3
    expect(step2).toContain(literalTextDoc46723)
    expect(step2).toContain(literalTextDoc46722)
    expect(step2).toContain('instrument-document:46723:chunk:c101')
    expect(step2).toContain('instrument-document:46722:chunk:c202')
  })

  it('10. No muta los objetos de backend ni cambia el contrato de continuation prompt', () => {
    const originalFragments = [...call2Result.fragments]
    const continuation = buildAccreditedRealityContinuationPrompt(
      { systemPrompt: 'System base', userPrompt: 'Pregunta usuario' },
      [{ request: call2Request, result: call2Result }],
    )

    // Objects not mutated
    expect(call2Result.fragments).toEqual(originalFragments)
    expect(call2Result.fragments[0]?.sourceUrl).toBe('https://siotuga.xunta.gal/siotuga/descargaDoc.php?id=46723')
    expect(call2Result.fragments[0]?.checksum).toBe('sha256_checksum_46723')

    // Continuation prompt includes compact history and stableSourceRefs
    expect(continuation.userPrompt).toContain('HISTORIAL DE HERRAMIENTAS ACREDITADAS:')
    expect(continuation.userPrompt).toContain(literalTextDoc46723)
    expect(continuation.userPrompt).toContain('instrument-document:46723:chunk:c101')
    expect(continuation.userPrompt).not.toContain('"fragments": [')
  })
})
