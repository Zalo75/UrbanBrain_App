import { describe, expect, it, vi } from 'vitest'

vi.mock('@/infrastructure/db/client', () => ({ db: {} }))

import type { PlanningDocumentReference } from '@/domain/territorial-resolver/types'
import {
  enrichPlanningDocumentPreviews,
  isEligibleForDocumentPreview,
  sanitizeDocumentPreview,
  MAX_PREVIEW_LENGTH,
} from './documentPreviewLoader'
import {
  accreditedPlanningDocumentsAsInventory,
  formatCompactToolHistory,
  type InstrumentDocumentsToolResult,
} from '@/application/parcel-context/accreditedRealityTool'
import {
  buildAccreditedContextForReasoning,
  type AccreditedRealityPackage,
} from '@/application/parcel-context/accreditedRealityPackage'

describe('documentPreviewLoader', () => {
  const sampleNormativeDoc: PlanningDocumentReference = {
    id: '46725',
    instrumentId: '22262',
    title: 'NORMATIVA: TITULO VIII.',
    sourceUrl: 'https://official.test/CARINO/documents/0101no111.pdf',
    binding: 'general',
    documentType: 'normative_text',
  }

  const sampleSheetDoc: PlanningDocumentReference = {
    id: '46714',
    instrumentId: '22262',
    title: 'FICHAS DOS NUCLEOS.',
    sourceUrl: 'https://official.test/CARINO/documents/0101me101.pdf',
    binding: 'general',
    documentType: 'sheet',
  }

  const sampleMemoriaDoc: PlanningDocumentReference = {
    id: '46713',
    instrumentId: '22262',
    title: 'MEMORIA.',
    sourceUrl: 'https://official.test/CARINO/documents/0101me001.pdf',
    binding: 'general',
    documentType: 'other',
  }

  const sampleCatalogueDoc: PlanningDocumentReference = {
    id: '46750',
    instrumentId: '22262',
    title: 'CATÁLOGO ARQUITECTÓNICO.',
    sourceUrl: 'https://official.test/CARINO/documents/0101ca001.pdf',
    binding: 'general',
    documentType: 'catalogue',
  }

  it('A) documento normativo con chunks -> devuelve preview literal <= 250 caracteres', async () => {
    const longChunkText = 'Art. 214: Concepto de núcleo rural: 1Tienen el carácter de núcleos rurales, los identificados en el presente documento que se enumeran a continuación y que han sido delimitados en los planos correspondientes. PARROQUIA NÚCLEOS RURALES CARIÑO VILAR / CARIÑO DE ARRIBA, MURELA Y CASAS DA VILA A PEDRA'
    expect(longChunkText.length).toBeGreaterThan(250)

    const mockResolver = async () => new Map([
      ['0101no111.pdf', longChunkText],
    ])

    const result = await enrichPlanningDocumentPreviews(
      [sampleNormativeDoc],
      '15901',
      '22262',
      mockResolver,
    )

    expect(result).toHaveLength(1)
    expect(result[0].preview).toBeDefined()
    expect(result[0].preview!.length).toBeLessThanOrEqual(MAX_PREVIEW_LENGTH)
    expect(result[0].preview!.length).toBe(250)
    expect(result[0].preview).toBe(
      'Art. 214: Concepto de núcleo rural: 1Tienen el carácter de núcleos rurales, los identificados en el presente documento que se enumeran a continuación y que han sido delimitados en los planos correspondientes. PARROQUIA NÚCLEOS RURALES CARIÑO VILAR / '
    )
  })

  it('B) documento sin chunks -> no inventa preview (queda undefined)', async () => {
    const mockResolver = async () => new Map<string, string>()

    const result = await enrichPlanningDocumentPreviews(
      [sampleNormativeDoc],
      '15901',
      '22262',
      mockResolver,
    )

    expect(result).toHaveLength(1)
    expect(result[0].preview).toBeUndefined()
  })

  it('C) preview con OCR malo -> se conserva; no se interpreta ni corrige', async () => {
    const badOcrChunk = '--- PAGINA 1 ---   \t\n  Û Û Û Û Û Û Û Û ...  dfWla%fade Cariño  &@#  '
    const mockResolver = async () => new Map([
      ['0101no111.pdf', badOcrChunk],
    ])

    const result = await enrichPlanningDocumentPreviews(
      [sampleNormativeDoc],
      '15901',
      '22262',
      mockResolver,
    )

    expect(result[0].preview).toBe('--- PAGINA 1 --- Û Û Û Û Û Û Û Û ... dfWla%fade Cariño &@#')
    // Must NOT strip characters or guess words
    expect(result[0].preview).toContain('Û Û Û Û')
    expect(result[0].preview).toContain('dfWla%fade')
  })

  it('D) no se generan summaries/scopes/appliesTo en ningún caso', async () => {
    const mockResolver = async () => new Map([
      ['0101no111.pdf', 'Art. 214. Concepto de núcleo rural.'],
    ])

    const result = await enrichPlanningDocumentPreviews(
      [sampleNormativeDoc],
      '15901',
      '22262',
      mockResolver,
    )

    const doc = result[0] as unknown as Record<string, unknown>
    expect(doc.preview).toBe('Art. 214. Concepto de núcleo rural.')
    expect(doc.summary).toBeUndefined()
    expect(doc.scope).toBeUndefined()
    expect(doc.appliesTo).toBeUndefined()
    expect(doc.description).toBeUndefined()
  })

  it('E) documentos no elegibles (memoria, planos, catálogo) -> no provocan inflación innecesaria', async () => {
    const mockResolver = async () => new Map([
      ['0101me001.pdf', 'Memoria justificativa del planeamiento general municipal.'],
      ['0101ca001.pdf', 'Catálogo de bienes protegidos y patrimonio cultural.'],
      ['0101no111.pdf', 'Art. 214: Concepto de núcleo rural.'],
    ])

    const docs = [sampleNormativeDoc, sampleMemoriaDoc, sampleCatalogueDoc]
    const result = await enrichPlanningDocumentPreviews(
      docs,
      '15901',
      '22262',
      mockResolver,
    )

    expect(result).toHaveLength(3)
    // Only normative_text receives preview
    expect(result[0].preview).toBe('Art. 214: Concepto de núcleo rural.')
    expect(result[1].preview).toBeUndefined()
    expect(result[2].preview).toBeUndefined()
  })

  it('F) el catálogo anterior sigue funcionando si preview no existe (backward compatibility)', () => {
    const docsWithoutPreview: PlanningDocumentReference[] = [
      {
        id: 'doc-old',
        instrumentId: '22262',
        title: 'Documento Antiguo',
        sourceUrl: 'https://official.test/doc.pdf',
        binding: 'general',
        documentType: 'normative_text',
      },
    ]

    const inventory = accreditedPlanningDocumentsAsInventory({
      municipalityCode: '15901',
      instrumentId: '22262',
      documents: docsWithoutPreview,
    })

    expect(inventory).not.toBeNull()
    expect(inventory!.documents[0].preview).toBeUndefined()

    const pkg = {
      packageVersion: '1.0',
      identity: { cadastralReference: '123', municipality: 'Cariño' },
      parcel: { surfaceSquareMetres: 500 },
      planning: { instrument: 'PXOM', documents: docsWithoutPreview },
      observedCandidates: [],
      derivedContext: {},
      sources: [],
      unknowns: [],
      warnings: [],
      conflicts: [],
    } as unknown as AccreditedRealityPackage

    const reasoningContext = buildAccreditedContextForReasoning(pkg)
    expect(reasoningContext.documentCatalog).not.toBe('USE_TOOL')
    if (Array.isArray(reasoningContext.documentCatalog)) {
      expect(reasoningContext.documentCatalog[0].id).toBe('doc-old')
      expect(reasoningContext.documentCatalog[0].preview).toBeUndefined()
    }

    const toolHistory = formatCompactToolHistory([
      {
        request: { action: 'tool_call', toolName: 'get_instrument_documents', arguments: {} },
        result: inventory!,
      },
    ])
    expect(toolHistory).toContain('id: doc-old | título: Documento Antiguo | tipo: normative_text | vinculación: general')
    expect(toolHistory).not.toContain('preview:')
  })

  it('G) formatCompactToolHistory incluye preview cuando está disponible', () => {
    const docsWithPreview: PlanningDocumentReference[] = [
      {
        id: '46725',
        instrumentId: '22262',
        title: 'NORMATIVA: TITULO VIII.',
        sourceUrl: 'https://official.test/0101no111.pdf',
        binding: 'general',
        documentType: 'normative_text',
        preview: 'Art. 214: Concepto de núcleo rural: ...',
      },
    ]

    const inventory: InstrumentDocumentsToolResult = {
      toolName: 'get_instrument_documents',
      status: 'available',
      municipalityCode: '15901',
      instrumentId: '22262',
      documents: docsWithPreview,
      provenance: null,
    }

    const toolHistory = formatCompactToolHistory([
      {
        request: { action: 'tool_call', toolName: 'get_instrument_documents', arguments: {} },
        result: inventory,
      },
    ])
    expect(toolHistory).toContain('id: 46725 | título: NORMATIVA: TITULO VIII. | tipo: normative_text | vinculación: general | preview: Art. 214: Concepto de núcleo rural: ...')
  })
})
