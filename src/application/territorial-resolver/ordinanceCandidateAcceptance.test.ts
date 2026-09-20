import { evaluateApplicability } from '@/application/parcel-context/applicabilityEngine'
import { describe, it, expect } from 'vitest'
import { resolveOrdinanceCandidatesDetailed, type DetailedZoningObservation } from './ordinanceCandidateResolver'
import { buildNormalizedParcelContext } from '@/application/parcel-context/normalizeParcelContext'
import { deriveParcelRegimeIdentity } from '@/application/parcel-context/parcelRegimeIdentity'
import { buildTerritorialFactualContract } from '@/application/parcel-context/buildFactualContract'
import { PreparedZoningStrategy } from '@/infrastructure/territorial-resolver/PreparedZoningStrategy'
import { buildPreparedZoningLayer } from '@/infrastructure/territorial-resolver/preparedZoningLayer'

describe('Universal Ordinance Resolver Acceptance', () => {
  const dummyPlanning = {
    applicableInstruments: [{ id: 'inst-1', status: 'current' as const, name: 'Plan', kind: 'general', sourceUrl: '' }],
    evidence: [],
    cataloguedInstruments: [],
    documents: [],
  }
  
  it('CASO 1 - VECTOR DIRECTO / UNA ZONA', async () => {
    const observation: DetailedZoningObservation = {
      identity: 'SU-1',
      instrumentId: 'inst-1',
      sourceRef: 'vector-source',
      spatialEvidence: 'Intersección GIS',
      graphicEvidence: 'N/A',
      legendEvidence: 'N/A',
      documentaryEvidence: 'N/A',
      coverage: { percentage: 100 }
    }
    const result = await resolveOrdinanceCandidatesDetailed(dummyPlanning as unknown, { observations: [observation] })
    expect(result.status).toBe('automatically_determined')
    expect(result.candidates).toHaveLength(1)
    expect(result.candidates[0].identity).toBe('SU-1')
  })

  it('CASO 2 - VECTOR DIRECTO / MULTIZONA', async () => {
    const obs1: DetailedZoningObservation = {
      identity: 'SU-1', instrumentId: 'inst-1', sourceRef: 'vector-source',
      spatialEvidence: 'GIS', graphicEvidence: 'N/A', legendEvidence: 'N/A', documentaryEvidence: 'N/A',
      coverage: { percentage: 60 }
    }
    const obs2: DetailedZoningObservation = {
      identity: 'SU-2', instrumentId: 'inst-1', sourceRef: 'vector-source',
      spatialEvidence: 'GIS', graphicEvidence: 'N/A', legendEvidence: 'N/A', documentaryEvidence: 'N/A',
      coverage: { percentage: 40 }
    }
    const result = await resolveOrdinanceCandidatesDetailed(dummyPlanning as unknown, { observations: [obs1, obs2] })
    expect(result.status).toBe('multizone')
    expect(result.candidates).toHaveLength(2)
  })

  it('CASO 3 - PREPARED ZONING LAYER', async () => {
    const layer = buildPreparedZoningLayer({
      municipalityCode: '36059',
      instrumentId: 'inst-1',
      sourceDocumentId: 'doc-1',
      sourceSheet: 'sheet1',
      sourceUrl: 'http',
      sourceScale: 2000,
      rasterBytes: new Uint8Array([0]),
      tiePoints: [
        { pixel: [0, 0], coordinate: [0, 0] },
        { pixel: [100, 0], coordinate: [100, 0] },
        { pixel: [100, 100], coordinate: [100, 100] },
        { pixel: [0, 100], coordinate: [0, 100] }
      ],
      pixelZones: [
        { pixelGeometry: [[[0, 0], [10, 0], [10, 10], [0, 10], [0, 0]]], code: 'SU-1', label: 'SU-1', ordinance: 'SU-1', normativeArticle: '', legendEvidence: 'N/A', documentaryEvidence: 'N/A', confidence: 'high' },
        { pixelGeometry: [[[10, 0], [20, 0], [20, 10], [10, 10], [10, 0]]], code: 'SU-2', label: 'SU-2', ordinance: 'SU-2', normativeArticle: '', legendEvidence: 'N/A', documentaryEvidence: 'N/A', confidence: 'high' }
      ],
      reviewer: 'test', validatedAt: '2026-01-01T00:00:00.000Z', validatedGeoreference: {
        method: 'affine', targetCrs: 'EPSG:25829', metricCrs: 'EPSG:25829',
        sourcePixelSpace: { width: 100, height: 100 },
        transformation: { x: [1, 0, 0], y: [0, 1, 0] },
        rmsMetres: 1, residuals: [{ pointId: '1', metres: 1, isOutlier: false }],
        validationStatus: 'VALIDATED', validationMethod: 'TECHNICIAN_CONFIRMED', qualityStatus: 'AUTO_ACCEPTABLE', qualityFlags: [], reviewer: 'test', validatedAt: '2026-01-01T00:00:00.000Z'
      },
    })
    
    const repo = { getLayer: async () => layer }
    const strategy = new PreparedZoningStrategy(repo as unknown)
    
    const p1Result = await resolveOrdinanceCandidatesDetailed(dummyPlanning as unknown, {
      strategies: [strategy], municipalityCode: '36059',
      geometry: { type: 'MultiPolygon', coordinates: [[[[5, 5], [6, 5], [6, 6], [5, 6], [5, 5]]]] }
    })
    expect(p1Result.candidates).toHaveLength(1)
    expect(p1Result.candidates[0].identity).toBe('SU-1')
    
    const p2Result = await resolveOrdinanceCandidatesDetailed(dummyPlanning as unknown, {
      strategies: [strategy], municipalityCode: '36059',
      geometry: { type: 'MultiPolygon', coordinates: [[[[15, 5], [16, 5], [16, 6], [15, 6], [15, 5]]]] }
    })
    expect(p2Result.candidates).toHaveLength(1)
    expect(p2Result.candidates[0].identity).toBe('SU-2')
  })

  it('CASO 4 - SIN ZONING ACREDITADO', async () => {
    const result = await resolveOrdinanceCandidatesDetailed(dummyPlanning as unknown, { observations: [], strategies: [] })
    expect(result.status).toBe('manual_confirmation_required')
    expect(result.candidates).toHaveLength(0)
  })

  it('CASO 5 - PROPAGACI\u00d3N MULTIZONA', async () => {
    const candidates = [
      { identity: 'SU-1', instrumentId: 'inst-1', coverage: { percentage: 60, method: 'prepared_zoning_intersection' }, provenance: ['test'], status: 'active' },
      { identity: 'SU-2', instrumentId: 'inst-1', coverage: { percentage: 40, method: 'prepared_zoning_intersection' }, provenance: ['test'], status: 'active' }
    ]
    const detected: unknown = {
      ordinanceDetermination: { candidates, status: 'multizone' },
      planning: { status: 'determined', ordinanceResolutionStatus: 'multizone', applicableInstruments: dummyPlanning.applicableInstruments },
      classification: 'SU',
      municipalityName: 'VIGO',
      municipalityCode: '36057',
      validity: { status: 'vigente' },
    }
    const context = buildNormalizedParcelContext({ expediente: { municipio: '36057', refCatastral: '12345678901234' } as unknown, detected } as unknown)
    expect(context.ordinanceCandidates).toHaveLength(2)
    
    const identity = deriveParcelRegimeIdentity(context)
    expect(identity.scopes).toHaveLength(1)
    expect(identity.scopes[0].ordinances).toHaveLength(2)
    
    const contract = buildTerritorialFactualContract(context);
    expect(contract.ordinances).toHaveLength(2)
    
    const normativeCandidates: unknown[] = [
      { id: 'c1', documentId: 'doc', content: 'c1', municipalityName: '36057', regimeMetadata: { kind: 'ordinance', code: 'SU-1', municipalityCode: '36057' } },
      { id: 'c2', documentId: 'doc', content: 'c2', municipalityName: '36057', regimeMetadata: { kind: 'ordinance', code: 'SU-2', municipalityCode: '36057' } },
      { id: 'c3', documentId: 'doc', content: 'c3', municipalityName: '36057', regimeMetadata: { kind: 'ordinance', code: 'SU-3', municipalityCode: '36057' } },
      { id: 'c4', documentId: 'doc', content: 'c4', municipalityName: '36057', regimeMetadata: { kind: 'general', municipalityCode: '36057' } },
    ]
    
    console.log('MUNICIPALITY EXPECTED:', context.municipality?.value?.name)
    const appResult = evaluateApplicability(context, normativeCandidates, false)
    console.log('REGIME_IDENTITY_TEST:', JSON.stringify(context.regimeIdentity, null, 2))
    console.log('APP_RESULT_TEST:', JSON.stringify(appResult, null, 2))
    expect(appResult.applicable).toHaveLength(3) // SU-1, SU-2, general
    expect(appResult.rejected).toHaveLength(1) // SU-3
    expect(appResult.rejected[0].candidate.regimeMetadata.code).toBe('SU-3')
    expect(appResult.missingData).toHaveLength(0) // Should have no missing data because candidates are present
  })

  it('CASO 6 - CHAT GENERAL VS PARCELARIO END-TO-END', async () => {
    const dummyPlanning = {
      applicableInstruments: [{ id: 'inst-1', status: 'current' as const, name: 'Plan', kind: 'general', sourceUrl: '' }],
      evidence: [],
      cataloguedInstruments: [],
      documents: [],
    };
    
    // Escenario 1: parcela completa y acreditada, responde a normativas parcelarias (ordinance)
    const candidates = [
      { identity: 'SU-1', instrumentId: 'inst-1', coverage: { percentage: 100, method: 'prepared_zoning_intersection' }, provenance: ['test'], status: 'active' }
    ]
    const detected: unknown = {
      ordinanceDetermination: { candidates, status: 'automatically_determined' },
      planning: { status: 'determined', ordinanceResolutionStatus: 'automatically_determined', applicableInstruments: dummyPlanning.applicableInstruments },
      planningCanAnswerConcreteParameters: true,
      urbanisticFacts: { 
        classification: { value: { code: 'SU', label: 'SU' }, status: 'automatic_confirmed', confidence: 1, evidence: [], discrepancies: [] },
        category: { value: null, candidates: [], status: 'automatic_confirmed', confidence: 1, evidence: [], discrepancies: [] },
        consolidation: { evidence: [], discrepancies: [] }
      },
      landClass: 'SU',
      validity: { status: 'vigente' },
      municipalityName: 'VIGO',
      municipalityCode: '36057',
      affects: { parcel: [] }
    }
    const context = buildNormalizedParcelContext({ expediente: { municipio: '36057', refCatastral: '12345678901234' } as unknown, detected } as unknown)
    
    const normativeCandidates: unknown[] = [
      { id: 'c1', documentId: 'doc', content: 'c1', municipalityName: '36057', regimeMetadata: { kind: 'ordinance', code: 'SU-1', municipalityCode: '36057' } },
      { id: 'c2', documentId: 'doc', content: 'c2', municipalityName: '36057', regimeMetadata: { kind: 'general', municipalityCode: '36057' } },
    ]
    const appResult = evaluateApplicability(context, normativeCandidates, true)
    console.log('CASO 6 REJECTED:', JSON.stringify(appResult.rejected, null, 2))
    console.log('CASO 6 IDENTITY:', JSON.stringify(context.regimeIdentity, null, 2))
    expect(appResult.applicable).toHaveLength(2)
    console.log('CASO 6 CONTEXT:', JSON.stringify(context, null, 2))

    // Escenario 2: parcela SIN zona acreditada, debe bloquear las ordenanzas pero habilitar normativa general
    const detectedSinZona: unknown = {
      ordinanceDetermination: { candidates: [], status: 'manual_confirmation_required' },
      planning: { status: 'determined', ordinanceResolutionStatus: 'manual_confirmation_required', applicableInstruments: dummyPlanning.applicableInstruments },
      planningCanAnswerConcreteParameters: false,
      urbanisticFacts: { 
        classification: { value: { code: 'SU', label: 'SU' }, status: 'automatic_confirmed', confidence: 1, evidence: [], discrepancies: [] },
        category: { value: null, candidates: [], status: 'automatic_confirmed', confidence: 1, evidence: [], discrepancies: [] },
        consolidation: { evidence: [], discrepancies: [] }
      },
      validity: { status: 'vigente' },
      municipalityName: 'VIGO',
      municipalityCode: '36057',
      affects: { parcel: [] }
    }
    const contextSinZona = buildNormalizedParcelContext({ expediente: { municipio: '36057', refCatastral: '12345678901234' } as unknown, detected: detectedSinZona } as unknown)
    
    const appResultSinZona = evaluateApplicability(contextSinZona, normativeCandidates, true) // concrete parameter requested
    expect(appResultSinZona.applicable).toHaveLength(1) // General chunk is applicable
    expect(appResultSinZona.canAnswerConcreteParameters).toBe(false) // But we can't answer concrete questions
    expect(appResultSinZona.missingData.length).toBeGreaterThan(0)
    
    const appResultSinZonaGeneral = evaluateApplicability(contextSinZona, normativeCandidates, false) // concrete parameter NOT requested
    expect(appResultSinZonaGeneral.applicable).toHaveLength(1) // General passes
    expect(appResultSinZonaGeneral.applicable[0].regimeMetadata.kind).toBe('general')
    expect(appResultSinZonaGeneral.review).toHaveLength(1) // SU-1 review
  })
})






