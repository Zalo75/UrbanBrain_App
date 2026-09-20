import { describe, expect, it } from 'vitest'
import {
  resolveOrdinanceCandidatesDetailed,
  type DetailedZoningObservation,
} from './ordinanceCandidateResolver'
import type { PlanningApplicability } from '@/domain/territorial-resolver/types'

function planning(instrumentId = 'instrument-current'): PlanningApplicability {
  return {
    status: 'determined',
    instrument: 'official plan',
    applicableInstruments: [{
      id: instrumentId,
      name: 'official plan',
      kind: 'general',
      status: 'current',
      sourceUrl: 'https://official.example/instrument',
    }],
    evidence: [],
    warnings: [],
  }
}

function evidence(identity: string, overrides: Partial<DetailedZoningObservation> = {}): DetailedZoningObservation {
  return {
    identity,
    instrumentId: 'instrument-current',
    sourceRef: 'official:sheet:1',
    sourceDocument: 'official:ordinance:1',
    spatialEvidence: 'parcel intersects official recinto',
    graphicEvidence: 'official plan label',
    legendEvidence: 'official legend maps label to identity',
    documentaryEvidence: 'official normative chapter',
    instrumentMembership: true,
    provenance: ['official:sheet:1', 'official:ordinance:1'],
    confidence: 'high',
    ...overrides,
  }
}

describe('detailed zoning evidence convergence', () => {
  it('promotes convergent graphic, legend and normative evidence automatically', async () => {
    const result = await resolveOrdinanceCandidatesDetailed(planning(), {
      observations: [evidence('Ordinance 1')],
    })
    expect(result.status).toBe('automatically_determined')
    expect(result.candidates[0]).toMatchObject({ identity: 'Ordinance 1', instrumentId: 'instrument-current' })
  })

  it('supports a PORD-insufficient observation completed by original-sheet evidence', async () => {
    const result = await resolveOrdinanceCandidatesDetailed(planning(), {
      observations: [evidence('Ordinance 2', {
        spatialEvidence: 'TILEINDEX footprint and original-sheet projection',
        graphicEvidence: 'original sheet label 2',
      })],
    })
    expect(result.status).toBe('automatically_determined')
    expect(result.candidates[0]?.spatialEvidence).toContain('original-sheet')
  })

  it('never promotes an observation without documentary validation', async () => {
    const result = await resolveOrdinanceCandidatesDetailed(planning(), {
      observations: [evidence('Ordinance 2', { documentaryEvidence: undefined })],
    })
    expect(result.status).toBe('manual_confirmation_required')
    expect(result.candidates).toHaveLength(0)
  })

  it('retains incompatible candidates as ambiguous instead of choosing one', async () => {
    const result = await resolveOrdinanceCandidatesDetailed(planning(), {
      observations: [evidence('Ordinance 1'), evidence('Ordinance 2')],
    })
    expect(result.status).toBe('ambiguous')
    expect(result.candidates).toHaveLength(2)
    expect(result.candidates[0]?.competingCandidates).toEqual(['ORDINANCE 1', 'ORDINANCE 2'])
  })

  it('retains multizone candidates and their coverage', async () => {
    const result = await resolveOrdinanceCandidatesDetailed(planning(), {
      observations: [
        evidence('Ordinance 1', { coverage: { percentage: 60, method: 'polygon_intersection' } }),
        evidence('Ordinance 2', { coverage: { percentage: 40, method: 'polygon_intersection' } }),
      ],
    })
    expect(result.status).toBe('multizone')
    expect(result.candidates.map((candidate) => candidate.coverage?.percentage)).toEqual([60, 40])
  })

  it('falls back to manual confirmation when no strategy has evidence', async () => {
    const result = await resolveOrdinanceCandidatesDetailed(planning())
    expect(result.candidates).toEqual([])
    expect(result.status).toBe('manual_confirmation_required')
    expect(result.metadata.status).toBe('REVIEW_REQUIRED')
  })

  it('rejects evidence belonging to another instrument', async () => {
    const result = await resolveOrdinanceCandidatesDetailed(planning(), {
      observations: [evidence('Ordinance 1', { instrumentId: 'historical-instrument' })],
    })
    expect(result.candidates).toHaveLength(0)
    expect(result.status).toBe('manual_confirmation_required')
  })

  it('merges the same identity from independent strategies without collapsing distinct zones', async () => {
    const result = await resolveOrdinanceCandidatesDetailed(planning(), {
      strategies: [
        { id: 'pord', resolve: async () => [evidence('Ordinance 1')] },
        { id: 'sheet', resolve: async () => [evidence('ORDINANCE 1')] },
      ],
    })
    expect(result.status).toBe('automatically_determined')
    expect(result.candidates).toHaveLength(1)
    expect(result.candidates[0]?.provenance).toHaveLength(2)
  })

  it('exposes the normalized product status for structured automatic evidence', async () => {
    const result = await resolveOrdinanceCandidatesDetailed(planning(), {
      observations: [evidence('U-1', { sourceRef: 'https://example.arcgis.com/FeatureServer/0', provenance: ['arcgis:feature'] })],
    })
    expect(result.metadata.status).toBe('RESOLVED')
    expect(result.metadata.confirmationSource).toBe('automatic')
  })

  it('keeps legacy precision warnings without hiding the warning', async () => {
    const result = await resolveOrdinanceCandidatesDetailed(planning(), {
      observations: [evidence('ORD-1', { estimatedErrorMeters: 0.7, alignmentMethod: 'automatic-registration', warning: 'Cartografía escaneada: revise límites próximos.' })],
    })
    expect(result.metadata.status).toBe('RESOLVED_WITH_PRECISION_WARNING')
    expect(result.metadata.warning).toContain('Cartografía escaneada')
  })

  it('keeps unstructured legacy evidence in review until precision is supplied', async () => {
    const result = await resolveOrdinanceCandidatesDetailed(planning(), {
      observations: [evidence('ORD-1')],
    })
    expect(result.metadata.status).toBe('REVIEW_REQUIRED')
    expect(result.metadata.reviewMaterials?.candidateOrdinances).toHaveLength(1)
  })

  it('routes ambiguous or multizone evidence to review', async () => {
    const result = await resolveOrdinanceCandidatesDetailed(planning(), {
      observations: [
        evidence('ORD-1', { coverage: { percentage: 55 } }),
        evidence('ORD-2', { coverage: { percentage: 45 } }),
      ],
    })
    expect(result.metadata.status).toBe('REVIEW_REQUIRED')
    expect(result.metadata.reviewMaterials?.candidateOrdinances).toHaveLength(2)
  })

  it('keeps classification/category context from competing with an ordinance', async () => {
    const result = await resolveOrdinanceCandidatesDetailed({
      ...planning(),
      classification: {
        code: 'SU',
        categoryCode: 'SU-C',
        label: 'Suelo urbano',
        categoryLabel: 'Categoría urbana',
        sourceFeatureIds: ['official:classification'],
      },
    }, {
      observations: [
        evidence('SU-C', { semanticDimension: 'category' }),
        evidence('R-2', { semanticDimension: 'ordinance' }),
      ],
    })
    expect(result.status).toBe('automatically_determined')
    expect(result.candidates.map((candidate) => candidate.identity)).toEqual(['R-2'])
    expect(result.contextualCandidates?.map((candidate) => candidate.identity)).toEqual(['SU-C'])
  })

  it('does not let an unstable VLM category label erase a detailed identity', async () => {
    const result = await resolveOrdinanceCandidatesDetailed({
      ...planning(),
      classification: {
        code: 'SU',
        categoryCode: 'SU-C',
        label: 'Suelo urbano',
        categoryLabel: 'Suelo urbano consolidado',
        sourceFeatureIds: ['official:feature:1'],
      },
    }, {
      observations: [
        evidence('R-2', { semanticDimension: 'category', confidence: 'high' }),
        evidence('SU-C', { semanticDimension: 'category', confidence: 'medium' }),
      ],
    })

    expect(result.candidates.map((candidate) => candidate.identity)).toEqual(['R-2'])
    expect(result.candidates[0]?.semanticDimension).toBe('category')
    expect(result.contextualCandidates?.map((candidate) => candidate.identity)).toEqual(['SU-C'])
  })

  it('still requires review for two alternatives in the same semantic dimension', async () => {
    const result = await resolveOrdinanceCandidatesDetailed(planning(), {
      observations: [
        evidence('R-2', { semanticDimension: 'ordinance' }),
        evidence('R-5', { semanticDimension: 'ordinance' }),
      ],
    })
    expect(result.status).toBe('ambiguous')
    expect(result.metadata.status).toBe('REVIEW_REQUIRED')
    expect(result.candidates).toHaveLength(2)
  })

  it('does not expose capabilities XML as map or legend review material', async () => {
    const result = await resolveOrdinanceCandidatesDetailed({
      ...planning(),
      resources: {
        municipalityCode: '15000',
        instrumentId: 'instrument-current',
        source: 'siotuga',
        wmsCapabilitiesUrl: 'https://official.example/wms?REQUEST=GetCapabilities',
      },
    })
    expect(result.metadata.reviewMaterials?.mapUrl).toBeUndefined()
    expect(result.metadata.reviewMaterials?.legendUrl).toBeUndefined()
    expect(result.metadata.reviewMaterials?.sourceEvidence).toContain('https://official.example/wms?REQUEST=GetCapabilities')
  })

  it('derives the official SIOTUGA legend from a discovered detailed layer for manual review', async () => {
    const result = await resolveOrdinanceCandidatesDetailed({
      ...planning(),
      resources: {
        municipalityCode: '15004',
        instrumentId: 'instrument-current',
        source: 'siotuga',
        detailedPlanningLayer: '_15004_PXOM_202002_AD_PORD_02CL_28295',
      },
    })
    expect(result.metadata.reviewMaterials?.legendUrl).toContain('REQUEST=GetLegendGraphic')
    expect(result.metadata.reviewMaterials?.legendUrl).toContain('codine=15004')
    expect(result.metadata.reviewMaterials?.legendUrl).toContain('LAYER=_15004_PXOM_202002_AD_PORD_02CL_28295')
  })

  it('uses an explicitly discovered plan image as review map material', async () => {
    const result = await resolveOrdinanceCandidatesDetailed({
      ...planning(),
      documents: [{
        id: 'sheet-1',
        title: 'Hoja de ordenación',
        sourceUrl: 'https://official.example/1002su001.jpg',
        binding: 'area_specific',
      }],
    })
    expect(result.metadata.reviewMaterials?.mapUrl).toContain('1002su001.jpg')
    expect(result.metadata.reviewMaterials?.legendUrl).toBeUndefined()
  })

  it('preserves specific map and legend URLs supplied by evidence', async () => {
    const result = await resolveOrdinanceCandidatesDetailed(planning(), {
      observations: [evidence('R-2', {
        semanticDimension: 'ordinance',
        reviewMaterials: {
          mapUrl: 'https://official.example/wms?REQUEST=GetMap&LAYERS=detail',
          legendUrl: 'https://official.example/wms?REQUEST=GetLegendGraphic&LAYER=detail',
          candidateOrdinances: [],
          sourceEvidence: [],
        },
      })],
    })
    expect(result.metadata.reviewMaterials?.mapUrl).toContain('GetMap')
    expect(result.metadata.reviewMaterials?.legendUrl).toContain('GetLegendGraphic')
  })
})
