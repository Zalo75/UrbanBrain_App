import { describe, expect, it } from 'vitest'
import {
  buildAccreditedRealityPackage,
  buildAccreditedRealityPrompt,
  buildMinimalContinuationContext,
  type AccreditedRealityPackage,
} from './accreditedRealityPackage'
import {
  buildAccreditedRealityContinuationPrompt,
  type AccreditedRealityModelResponse,
  type InstrumentDocumentsToolResult,
  type InstrumentDocumentContentToolResult,
} from './accreditedRealityTool'

function createSamplePackage(overrides?: Partial<AccreditedRealityPackage>): AccreditedRealityPackage {
  return {
    packageVersion: 'expedientes-accredited-reality-v1',
    identity: {
      cadastralReference: '0140506NJ9404S0001ML',
      municipality: 'Cariño',
      municipalityCode: '15901',
      province: 'A Coruña',
      address: 'Lugar Cariño de Arriba',
    },
    parcel: {
      surfaceSquareMetres: 1126.27,
    },
    planning: {
      instrument: 'Plan General de Ordenación Municipal',
      status: 'current',
      documents: [
        {
          id: '46722',
          instrumentId: '22262',
          title: 'Normativa Urbanística',
          documentType: 'normative_text',
          sourceUrl: 'https://siotuga.xunta.gal/46722.pdf',
          binding: 'general',
        },
        {
          id: '46723',
          instrumentId: '22262',
          title: 'Fichas de Núcleos Rurales',
          documentType: 'normative_text',
          sourceUrl: 'https://siotuga.xunta.gal/46723.pdf',
          binding: 'general',
        },
        {
          id: '6080',
          instrumentId: '22262',
          title: 'Memoria Justificativa',
          documentType: 'planning_sheet',
          sourceUrl: 'https://siotuga.xunta.gal/6080.pdf',
          binding: 'general',
        },
      ],
      evidence: [],
    },
    observedCandidates: [
      {
        candidateId: '_15901_PXOM_200002_AD_3CLAS_22262.1933',
        classification: {
          code: 'SNR',
          label: 'Suelo de núcleo rural',
          categoryCode: 'SNRSC',
          categoryLabel: 'Categoría común SNRSC',
          sourceFeatureIds: ['_15901_PXOM_200002_AD_3CLAS_22262.1933'],
        },
        areas: [
          {
            name: 'VILAR-CARIÑO DE ARRIBA',
            type: 'nucleus',
            sourceFeatureIds: ['_15901_PXOM_200002_AD_3CLAS_22262.1933'],
          },
        ],
        officialAttributes: [
          {
            classificationCode: 'SNR',
            categoryCode: 'SNRSC',
            legalClassificationCode: 'SNR',
            denomination: 'VILAR-CARIÑO DE ARRIBA',
            use: 'residencial',
            status: 'alta',
            sourceFeatureId: '_15901_PXOM_200002_AD_3CLAS_22262.1933',
            geometryAreaSquareMetres: 1126.27,
          },
        ],
        parcelCoverage: {
          parcelAreaSquareMetres: 1126.27,
          intersectionAreaSquareMetres: 1126.27,
          parcelPercentage: 100,
          method: 'polygon_intersection',
        },
      },
    ],
    derivedContext: {
      landClass: 'rustico_apt',
      zoningScope: 'GENERAL_UNZONED',
      classificationCode: 'SNR',
      categoryCode: 'SNRSC',
    },
    unknowns: ['No consta ficha específica de núcleo rural para el ámbito.'],
    conflicts: [],
    warnings: ['La cobertura de afecciones sectoriales es parcial.'],
    sources: [
      {
        id: 'candidate:_15901_PXOM_200002_AD_3CLAS_22262:SNR|SNRSC',
        aliases: ['_15901_PXOM_200002_AD_3CLAS_22262.1933'],
        content: 'EVIDENCIA DE CLASIFICACIÓN',
        source: 'siotuga',
      },
      {
        id: 'planning:evidence',
        aliases: ['PXOM Cariño'],
        content: 'EVIDENCIA DE PLANEAMIENTO',
        source: 'siotuga',
      },
    ],
    ...overrides,
  }
}

const mockToolHistory: Array<{
  request: AccreditedRealityModelResponse
  result: InstrumentDocumentsToolResult | InstrumentDocumentContentToolResult
}> = [
  {
    request: {
      action: 'tool_call',
      toolName: 'get_instrument_documents',
      arguments: {},
    },
    result: {
      toolName: 'get_instrument_documents',
      status: 'available',
      municipalityCode: '15901',
      instrumentId: '22262',
      documents: [
        {
          id: '46722',
          instrumentId: '22262',
          title: 'Normativa Urbanística',
          documentType: 'normative_text',
          sourceUrl: 'https://siotuga.xunta.gal/46722.pdf',
          binding: 'general',
        },
      ],
      provenance: { source: 'siotuga', retrievedAt: '2026-09-18T10:00:00.000Z', method: 'inventory' },
    },
  },
  {
    request: {
      action: 'tool_call',
      toolName: 'get_instrument_document_content',
      arguments: { documentId: '46722', query: 'vivienda unifamiliar parcela minima' },
    },
    result: {
      toolName: 'get_instrument_document_content',
      status: 'available',
      municipalityCode: '15901',
      instrumentId: '22262',
      documentId: '46722',
      document: {
        id: '46722',
        instrumentId: '22262',
        title: 'Normativa Urbanística',
        sourceUrl: 'https://siotuga.xunta.gal/46722.pdf',
      },
      query: 'vivienda unifamiliar parcela minima',
      fragments: [
        {
          stableSourceRef: 'instrument-document:46722:chunk:c18e787e3bedebda_00035',
          officialDocumentId: '46722',
          chunkId: 'c18e787e3bedebda_00035',
          text: 'Art. 198. Usos en suelo de núcleo rural.\n1. Uso característico: vivienda unifamiliar o colectiva.',
          page: 125,
          article: 'Art. 198',
          chapter: 'Capítulo IV',
          documentName: '46722_normativa.pdf',
          sourceUrl: 'https://siotuga.xunta.gal/46722.pdf',
          checksum: 'hash46722_35',
        },
        {
          stableSourceRef: 'instrument-document:46722:chunk:c18e787e3bedebda_00024',
          officialDocumentId: '46722',
          chunkId: 'c18e787e3bedebda_00024',
          text: 'Art. 188. Condiciones de edificación.\nOcupación máxima 50%, altura máxima B+1P+BC (7,00 m).',
          page: 118,
          article: 'Art. 188',
          chapter: 'Capítulo III',
          documentName: '46722_normativa.pdf',
          sourceUrl: 'https://siotuga.xunta.gal/46722.pdf',
          checksum: 'hash46722_24',
        },
      ],
      provenance: { source: 'normative_chunks_v2', retrievedAt: '2026-09-18T10:01:00.000Z', method: 'exact' },
    },
  },
]

describe('MinimalContinuationContext invariant suite', () => {
  it('1. documentCatalog está presente en la inferencia inicial pero estrictamente ausente en la continuación', () => {
    const pkg = createSamplePackage()
    const question = '¿Qué puedo construir en esta parcela?'
    const initialPrompt = buildAccreditedRealityPrompt(pkg, question)

    // En inferencia inicial: documentCatalog y derivedContext están presentes
    expect(initialPrompt.userPrompt).toContain('documentCatalog')
    expect(initialPrompt.userPrompt).toContain('46722')
    expect(initialPrompt.userPrompt).toContain('Normativa Urbanística')
    expect(initialPrompt.userPrompt).toContain('derivedContext')

    // En continuación: documentCatalog y derivedContext se eliminan completamente
    const continuationPrompt = buildAccreditedRealityContinuationPrompt(initialPrompt, mockToolHistory)
    expect(continuationPrompt.userPrompt).not.toContain('"documentCatalog"')
    expect(continuationPrompt.userPrompt).not.toContain('"derivedContext"')
    expect(continuationPrompt.userPrompt).not.toContain('"conflicts"')

    // Pero parcel, urbanisticFacts, unknowns y warnings permanecen
    expect(continuationPrompt.userPrompt).toContain('ESTADO ACREDITADO DE LA PARCELA:')
    expect(continuationPrompt.userPrompt).toContain('0140506NJ9404S0001ML')
    expect(continuationPrompt.userPrompt).toContain('1126.27')
    expect(continuationPrompt.userPrompt).toContain('VILAR-CARIÑO DE ARRIBA')
    expect(continuationPrompt.userPrompt).toContain('No consta ficha específica de núcleo rural')
    expect(continuationPrompt.userPrompt).toContain('La cobertura de afecciones sectoriales es parcial.')
  })

  it('2. Todos los fragmentos normativos literales sobreviven exactamente sin resumen ni truncamiento', () => {
    const pkg = createSamplePackage()
    const question = '¿Qué puedo construir en esta parcela?'
    const initialPrompt = buildAccreditedRealityPrompt(pkg, question)
    const continuationPrompt = buildAccreditedRealityContinuationPrompt(initialPrompt, mockToolHistory)

    // Fragmento 1 exacto
    expect(continuationPrompt.userPrompt).toContain('Art. 198. Usos en suelo de núcleo rural.')
    expect(continuationPrompt.userPrompt).toContain('1. Uso característico: vivienda unifamiliar o colectiva.')
    expect(continuationPrompt.userPrompt).toContain('página: 125')
    expect(continuationPrompt.userPrompt).toContain('artículo: Art. 198')
    expect(continuationPrompt.userPrompt).toContain('capítulo: Capítulo IV')

    // Fragmento 2 exacto
    expect(continuationPrompt.userPrompt).toContain('Art. 188. Condiciones de edificación.')
    expect(continuationPrompt.userPrompt).toContain('Ocupación máxima 50%, altura máxima B+1P+BC (7,00 m).')
    expect(continuationPrompt.userPrompt).toContain('página: 118')
    expect(continuationPrompt.userPrompt).toContain('artículo: Art. 188')
  })

  it('3. Todos los stableSourceRefs sobreviven exactamente y están unificados sin duplicación', () => {
    const pkg = createSamplePackage()
    const question = '¿Qué puedo construir en esta parcela?'
    const initialPrompt = buildAccreditedRealityPrompt(pkg, question)
    const continuationPrompt = buildAccreditedRealityContinuationPrompt(initialPrompt, mockToolHistory)

    // Stable source refs de las herramientas en el historial
    expect(continuationPrompt.userPrompt).toContain('instrument-document:46722:chunk:c18e787e3bedebda_00035')
    expect(continuationPrompt.userPrompt).toContain('instrument-document:46722:chunk:c18e787e3bedebda_00024')

    // Stable source refs en la sección SOURCE_REFS DISPONIBLES PARA CITAR
    expect(continuationPrompt.userPrompt).toContain('SOURCE_REFS DISPONIBLES PARA CITAR:')
    expect(continuationPrompt.userPrompt).toContain('candidate:_15901_PXOM_200002_AD_3CLAS_22262:SNR|SNRSC')
    expect(continuationPrompt.userPrompt).toContain('planning:evidence')
    expect(continuationPrompt.userPrompt).toContain('instrument-document:46722')

    // No existe la sección duplicada de IDENTIFICADORES ESTABLES
    expect(continuationPrompt.userPrompt).not.toContain('IDENTIFICADORES ESTABLES PARA CITAS (sourceRefs):')
  })

  it('4. Una confirmedNormativeIdentity nunca se pierde en la continuación', () => {
    const pkgWithConfirmedIdentity = createSamplePackage({
      confirmedNormativeIdentity: {
        code: 'ORD-NR-TRAD',
        denomination: 'Ordenanza de Núcleo Rural Tradicional',
        source: 'user_confirmed_case',
        authority: 'municipal',
        instrumentId: '22262',
      },
    })
    const question = '¿Qué puedo construir en esta parcela?'
    const initialPrompt = buildAccreditedRealityPrompt(pkgWithConfirmedIdentity, question)

    // Verificación en turno inicial
    expect(initialPrompt.systemPrompt).toContain('ORD-NR-TRAD')
    expect(initialPrompt.userPrompt).toContain('ORD-NR-TRAD')
    expect(initialPrompt.userPrompt).toContain('confirmedNormativeIdentity')

    // Verificación en continuación
    const continuationPrompt = buildAccreditedRealityContinuationPrompt(initialPrompt, mockToolHistory)
    expect(continuationPrompt.systemPrompt).toContain('ORD-NR-TRAD')
    expect(continuationPrompt.userPrompt).toContain('ORD-NR-TRAD')
    expect(continuationPrompt.userPrompt).toContain('"confirmedNormativeIdentity"')
    expect(continuationPrompt.userPrompt).toContain('Ordenanza de Núcleo Rural Tradicional')
  })

  it('5. La consulta original del técnico permanece íntegra en la continuación', () => {
    const pkg = createSamplePackage()
    const question = '¿Es autorizable una vivienda unifamiliar aislada con piscina y garaje?'
    const initialPrompt = buildAccreditedRealityPrompt(pkg, question)
    const continuationPrompt = buildAccreditedRealityContinuationPrompt(initialPrompt, mockToolHistory)

    expect(continuationPrompt.userPrompt).toContain('CONSULTA DEL TÉCNICO:\n¿Es autorizable una vivienda unifamiliar aislada con piscina y garaje?')
  })

  it('6. buildMinimalContinuationContext aísla los hechos sin inventar ni añadir campos espurios', () => {
    const pkg = createSamplePackage()
    const minimal = buildMinimalContinuationContext(pkg)

    expect(minimal.parcel.cadastralReference).toBe('0140506NJ9404S0001ML')
    expect(minimal.parcel.municipality).toBe('Cariño')
    expect(minimal.parcel.surfaceSquareMetres).toBe(1126.27)
    expect(minimal.urbanisticFacts.instrument).toBe('Plan General de Ordenación Municipal')
    expect(minimal.urbanisticFacts.candidates).toHaveLength(1)
    expect(minimal.urbanisticFacts.candidates[0]?.classification).toMatchObject({ code: 'SNR' })
    expect(minimal.unknowns).toHaveLength(1)
    expect(minimal.warnings).toHaveLength(1)
    expect((minimal as any).documentCatalog).toBeUndefined()
    expect((minimal as any).derivedContext).toBeUndefined()
    expect(minimal.conflicts).toBeUndefined()
  })

  it('7. Compatibilidad hacia atrás: soporta llamadas con prompt simple sin objeto package', () => {
    const legacyPrompt = {
      systemPrompt: 'System base legacy',
      userPrompt: 'Consulta simple sin paquete',
    }
    const continuation = buildAccreditedRealityContinuationPrompt(legacyPrompt, mockToolHistory)

    expect(continuation.systemPrompt).toContain('System base legacy')
    expect(continuation.userPrompt).toContain('Consulta simple sin paquete')
    expect(continuation.userPrompt).toContain('HISTORIAL DE HERRAMIENTAS ACREDITADAS:')
    expect(continuation.userPrompt).toContain('instrument-document:46722:chunk:c18e787e3bedebda_00035')
  })
})
