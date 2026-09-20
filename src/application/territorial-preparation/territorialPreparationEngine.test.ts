import { describe, expect, it } from 'vitest'
import {
  confirmTechnicianValidation,
  TerritorialPreparationEngine,
  type OfficialReferenceSource,
  type SpatialReferencePort,
} from './territorialPreparationEngine'

const cartesian: SpatialReferencePort = {
  targetCrs: 'LOCAL_TARGET',
  metricCrs: 'LOCAL_METRES',
  toTarget: ([x, y]) => [x, y],
  distanceMetres: ([x1, y1], [x2, y2]) => Math.hypot(x1 - x2, y1 - y2),
}

const source: OfficialReferenceSource = {
  id: 'official-base',
  authority: 'official',
  crs: 'LOCAL_TARGET',
  sourceUrl: 'https://official.example/base',
  official: true,
  capabilities: ['roads', 'buildings'],
  provenance: ['official'],
}

const input = {
  historicalCartography: {
    id: 'sheet',
    sourceUrl: 'https://official.example/sheet',
    format: 'jpg' as const,
    pixelSpace: { crs: 'image-pixel' as const, width: 100, height: 100 },
    provenance: ['official'],
  },
  referenceSources: [source],
  controls: [
    { id: 'p1', imageCoordinate: [0, 0] as [number, number], referenceCoordinate: [10, 20] as [number, number], referenceSourceId: source.id, capability: 'roads' as const },
    { id: 'p2', imageCoordinate: [10, 0] as [number, number], referenceCoordinate: [20, 20] as [number, number], referenceSourceId: source.id, capability: 'roads' as const },
    { id: 'p3', imageCoordinate: [10, 10] as [number, number], referenceCoordinate: [20, 30] as [number, number], referenceSourceId: source.id, capability: 'buildings' as const },
    { id: 'p4', imageCoordinate: [0, 10] as [number, number], referenceCoordinate: [10, 30] as [number, number], referenceSourceId: source.id, capability: 'buildings' as const },
  ],
}

describe('TerritorialPreparationEngine', () => {
  it('automatically accepts a structurally valid fit that passes configured conservative criteria', () => {
    const engine = new TerritorialPreparationEngine(cartesian, {
      automaticAcceptance: { maxRmsMetres: 5, maxResidualMetres: 8 },
    })
    expect(engine.availableCapabilities(input)).toEqual(['roads', 'buildings'])
    expect(engine.selectReferenceSources(input).map((candidate) => candidate.id)).toEqual(['official-base'])
    const assessment = engine.assess(input)
    expect(assessment.status).toBe('AUTO_ACCEPTABLE')
    expect(assessment.canAutomaticallyAccept).toBe(true)
    expect(assessment.metrics?.rmsMetres).toBeCloseTo(0)
    expect(assessment.transform?.targetCrs).toBe('LOCAL_TARGET')
  })

  it('keeps a mathematically invalid control set blocked', () => {
    const assessment = new TerritorialPreparationEngine(cartesian).assess({ ...input, controls: input.controls.slice(0, 3) })
    expect(assessment.status).toBe('INVALID')
    expect(assessment.canTechnicianConfirm).toBe(false)
    expect(assessment.invalidReasons[0]).toContain('4')
  })

  it('blocks a degenerate or non-finite transformation regardless of technician review', () => {
    const degenerate = new TerritorialPreparationEngine(cartesian).assess({
      ...input,
      controls: input.controls.map((control, index) => ({
        ...control,
        imageCoordinate: [index, index] as [number, number],
      })),
    })
    expect(degenerate.status).toBe('INVALID')
    expect(degenerate.canTechnicianConfirm).toBe(false)

    const nonFinite = new TerritorialPreparationEngine(cartesian).assess({
      ...input,
      controls: input.controls.map((control, index) => index === 0
        ? { ...control, referenceCoordinate: [Number.NaN, 20] as [number, number] }
        : control),
    })
    expect(nonFinite.status).toBe('INVALID')
    expect(nonFinite.invalidReasons).toContain('All control coordinates must be finite')
  })

  it('keeps a thematic layer visible but does not accept it as the only human anchor', () => {
    const thematic: OfficialReferenceSource = { ...source, id: 'theme', capabilities: ['thematic_geometry'] }
    const assessment = new TerritorialPreparationEngine(cartesian).assess({
      ...input,
      referenceSources: [thematic],
      controls: input.controls.map((control) => ({ ...control, referenceSourceId: thematic.id, capability: 'thematic_geometry' as const })),
    })
    expect(assessment.status).toBe('INVALID')
    expect(assessment.invalidReasons.some((reason) => reason.includes('thematic geometry alone'))).toBe(true)
  })

  it('rejects an undeclared control capability instead of silently accepting it', () => {
    const assessment = new TerritorialPreparationEngine(cartesian).assess({
      ...input,
      controls: input.controls.map((control) => ({ ...control, capability: 'hydrography' as const })),
    })
    expect(assessment.status).toBe('INVALID')
    expect(assessment.invalidReasons.some((reason) => reason.includes('not declared'))).toBe(true)
  })

  it('classifies a valid high-residual fit as REVIEW_REQUIRED instead of blocking human validation', () => {
    const assessment = new TerritorialPreparationEngine(cartesian, {
      automaticAcceptance: { maxRmsMetres: 1, maxResidualMetres: 2 },
    }).assess({
      ...input,
      controls: [...input.controls.slice(0, 3), { ...input.controls[3]!, referenceCoordinate: [35, 30] }],
    })
    expect(assessment.status).toBe('REVIEW_REQUIRED')
    expect(assessment.canAutomaticallyAccept).toBe(false)
    expect(assessment.canTechnicianConfirm).toBe(true)
    expect(assessment.qualityFlags).toEqual(expect.arrayContaining([
      'RMS_EXCEEDS_AUTOMATIC_CRITERION',
      'RESIDUAL_EXCEEDS_AUTOMATIC_CRITERION',
    ]))
    expect(assessment.metrics?.residuals.some((residual) => residual.exceedsAutomaticCriterion)).toBe(true)
  })

  it('requires explicit complete technician confirmation and preserves the measured evidence unchanged', () => {
    const reviewedInput = {
      ...input,
      historicalCartography: {
        ...input.historicalCartography,
        sourceHash: 'official-hash',
        scaleDenominator: 2000,
      },
      controls: [...input.controls.slice(0, 3), { ...input.controls[3]!, referenceCoordinate: [35, 30] as [number, number] }],
    }
    const assessment = new TerritorialPreparationEngine(cartesian, {
      automaticAcceptance: { maxRmsMetres: 1, maxResidualMetres: 2 },
    }).assess(reviewedInput)
    const confirmation = {
      reviewer: 'Técnica responsable',
      timestamp: '2026-08-24T12:00:00Z',
      purpose: 'Preparación territorial de zoning',
      inspectedOverlay: true,
      inspectedParcel: true,
      inspectedControls: true,
      inspectedResiduals: true,
      confirmedSufficientForPurpose: true,
    }

    expect(() => confirmTechnicianValidation(reviewedInput, assessment, {
      ...confirmation,
      inspectedResiduals: false,
    })).toThrow('Explicit inspection')

    const validated = confirmTechnicianValidation(reviewedInput, assessment, confirmation)
    expect(validated.validationMethod).toBe('TECHNICIAN_CONFIRMED')
    expect(validated.qualityStatus).toBe('REVIEW_REQUIRED')
    expect(validated.metrics).toEqual(assessment.metrics)
    expect(validated.qualityFlags).toEqual(assessment.qualityFlags)
    expect(validated.source).toMatchObject({
      sourceHash: 'official-hash',
      scaleDenominator: 2000,
      pixelSpace: { width: 100, height: 100 },
    })
  })
})
