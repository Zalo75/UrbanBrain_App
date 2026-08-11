import { describe, expect, it } from 'vitest'

import {
  assessPlanningRegimeResolutionCurrentness,
  canTransitionPlanningRegimeResolution,
  resolvePlanningRegime,
  supersedePlanningRegimeResolution,
  type PlanningRegimeDependency,
  type PlanningRegimeEvidence,
} from './planningRegimeResolution'

const referenceDate = '2026-08-05T00:00:00.000Z'
const subject = { kind: 'action_area', id: 'area-a' } as const
const scope = { scopeKey: 'area-a', geometryReference: 'geometry-a' }
const dependencies: PlanningRegimeDependency[] = [
  { key: 'geometry_snapshot', value: 'geometry-a' },
  { key: 'action_area', value: 'area-a' },
  { key: 'instrument', value: 'instrument-a' },
  { key: 'instrument_version', value: 'version-1' },
  { key: 'validity_reference', value: referenceDate },
  { key: 'official_evidence', value: 'source-a' },
]

function evidence(overrides: Partial<PlanningRegimeEvidence> = {}): PlanningRegimeEvidence {
  return {
    id: 'evidence-1',
    evidenceType: 'official_vector',
    determination: {
      type: 'ordinance',
      value: { code: 'R-4', label: 'Regime 4' },
      relation: 'exclusive',
      exclusivityGroup: 'ordinance',
    },
    assertion: {
      subject,
      predicate: 'governed_by',
      object: { kind: 'detailed_regime', id: 'R-4' },
    },
    source: 'Official planning service',
    officialSourceId: 'feature-1',
    provider: 'official-provider',
    instrumentId: 'instrument-a',
    instrumentVersion: 'version-1',
    validFrom: '2020-01-01T00:00:00.000Z',
    spatialScope: scope,
    officialReference: { kind: 'vector_attribute', id: 'feature-1', locator: 'regime_code' },
    verification: 'verified',
    provenance: 'official',
    observedAt: referenceDate,
    explicitRelation: true,
    spatialApplicability: 'confirmed',
    current: true,
    ...overrides,
  }
}

function resolve(evidenceItems: PlanningRegimeEvidence[], overrides: Partial<Parameters<typeof resolvePlanningRegime>[0]> = {}) {
  return resolvePlanningRegime({
    resolutionId: 'resolution-1',
    createdAt: referenceDate,
    referenceDate,
    subject,
    spatialScope: scope,
    evidence: evidenceItems,
    dependencies,
    ...overrides,
  })
}

describe('resolvePlanningRegime', () => {
  it('confirms an unambiguous official vector', () => {
    const result = resolve([evidence()])
    expect(result.status).toBe('officially_confirmed')
    expect(result.determinations[0].effectiveValue?.code).toBe('R-4')
    expect(result.canConstrainNormativeSearch).toBe(true)
  })

  it('does not confirm reviewed knowledge from a boolean without a complete official chain', () => {
    const result = resolve([evidence({
      evidenceType: 'reviewed_knowledge',
      provenance: 'reviewed_knowledge',
      officialSourceVerifiable: true,
      officialSourceId: undefined,
      officialReference: undefined,
    })])
    expect(result.status).not.toBe('officially_confirmed')
    expect(result.determinations[0].effectiveValue).toBeUndefined()
  })

  it('allows reviewed knowledge with a complete official, current and spatial chain', () => {
    const result = resolve([evidence({
      evidenceType: 'reviewed_knowledge',
      provenance: 'reviewed_knowledge',
    })])
    expect(result.status).toBe('officially_confirmed')
  })

  it('composes an official document, spatial unit membership and instrument hierarchy', () => {
    const unit = { kind: 'planning_unit', id: 'U-1' } as const
    const document = evidence({
      id: 'document-unit-regime',
      evidenceType: 'official_document',
      assertion: { subject: unit, predicate: 'governed_by', object: { kind: 'detailed_regime', id: 'R-4' } },
      spatialScope: { scopeKey: 'unit-U-1' },
      spatialApplicability: 'unknown',
      officialReference: { kind: 'document', id: 'document-1', locator: 'page-12' },
    })
    const spatial = evidence({
      id: 'spatial-area-unit',
      determination: undefined,
      assertion: { subject, predicate: 'belongs_to', object: unit },
      spatialApplicability: 'confirmed',
    })
    const hierarchy = evidence({
      id: 'hierarchy-unit-instrument',
      evidenceType: 'instrument_hierarchy',
      determination: undefined,
      assertion: { subject: unit, predicate: 'part_of', object: { kind: 'instrument', id: 'instrument-a' } },
      spatialApplicability: 'confirmed',
      officialReference: { kind: 'structured_record', id: 'instrument-1', locator: 'unit-membership' },
    })
    const result = resolve([document, spatial, hierarchy])

    expect(result.status).toBe('officially_confirmed')
    expect(result.determinations[0].acceptedEvidence.map((item) => item.id)).toEqual([
      'spatial-area-unit', 'hierarchy-unit-instrument', 'document-unit-regime',
    ])
  })

  it('keeps a document unit-to-regime relation pending without area-to-unit evidence', () => {
    const result = resolve([evidence({
      evidenceType: 'official_document',
      assertion: {
        subject: { kind: 'planning_unit', id: 'U-1' },
        predicate: 'governed_by',
        object: { kind: 'detailed_regime', id: 'R-4' },
      },
      spatialApplicability: 'unknown',
    })])
    expect(result.status).toBe('review_required')
    expect(result.determinations[0].effectiveValue).toBeUndefined()
  })

  it('rejects a chain when official spatial evidence excludes the area from the unit', () => {
    const unit = { kind: 'planning_unit', id: 'U-1' } as const
    const document = evidence({
      evidenceType: 'official_document',
      assertion: { subject: unit, predicate: 'governed_by', object: { kind: 'detailed_regime', id: 'R-4' } },
      spatialApplicability: 'unknown',
    })
    const excluded = evidence({
      id: 'area-not-unit',
      determination: undefined,
      assertion: { subject, predicate: 'not_belongs_to', object: unit },
      spatialApplicability: 'not_applicable',
    })
    const result = resolve([document, excluded])
    expect(result.status).toBe('review_required')
    expect(result.determinations[0].rejectedEvidence.map((item) => item.id)).toContain('area-not-unit')
    expect(result.determinations[0].rejectionReasons.join(' ')).toMatch(/excluye el área de actuación/i)
  })

  it('does not conflict for compatible types in different exclusivity groups', () => {
    const result = resolve([
      evidence({
        determination: { type: 'planning_unit', value: { code: 'U-1' }, relation: 'exclusive', exclusivityGroup: 'unit' },
        assertion: { subject, predicate: 'governed_by', object: { kind: 'planning_unit', id: 'U-1' } },
      }),
      evidence({ id: 'regime', determination: { type: 'ordinance', value: { code: 'R-4' }, relation: 'exclusive', exclusivityGroup: 'ordinance' } }),
    ])
    expect(result.status).toBe('officially_confirmed')
  })

  it('preserves accumulative special plan and ordinance determinations', () => {
    const result = resolve([
      evidence({ determination: { type: 'ordinance', value: { code: 'R-4' }, relation: 'accumulative', exclusivityGroup: 'ordinance' } }),
      evidence({
        id: 'special',
        determination: { type: 'special_plan', value: { code: 'PE-2' }, relation: 'accumulative', exclusivityGroup: 'special-plan' },
        assertion: { subject, predicate: 'governed_by', object: { kind: 'detailed_regime', id: 'PE-2' } },
      }),
    ])
    expect(result.status).toBe('officially_confirmed')
    expect(result.determinations).toHaveLength(2)
  })

  it('conflicts only for different exclusive values in the same group and scope', () => {
    const result = resolve([
      evidence(),
      evidence({ id: 'other', determination: { type: 'ordinance', value: { code: 'R-7' }, relation: 'exclusive', exclusivityGroup: 'ordinance' } }),
    ])
    expect(result.status).toBe('conflict')
  })

  it('does not allow a superseded resolution to transition back to not_started', () => {
    expect(canTransitionPlanningRegimeResolution('superseded', 'not_started')).toBe(false)
  })

  it('creates a reevaluation with a new identity linked to the prior resolution', () => {
    const prior = resolve([evidence()])
    const next = resolve([evidence()], {
      resolutionId: 'resolution-2',
      supersedesResolutionId: prior.resolutionId,
    })
    expect(next.resolutionId).not.toBe(prior.resolutionId)
    expect(next.supersedesResolutionId).toBe(prior.resolutionId)
  })

  it('marks a resolution stale when a dependency is added or removed', () => {
    const result = resolve([evidence()])
    const added = assessPlanningRegimeResolutionCurrentness(result, [
      ...dependencies,
      { key: 'planning_unit', value: 'U-1' },
    ])
    const removed = assessPlanningRegimeResolutionCurrentness(result, dependencies.filter((item) => item.key !== 'action_area'))
    expect(added.current).toBe(false)
    expect(added.changes.some((item) => item.kind === 'added')).toBe(true)
    expect(removed.current).toBe(false)
    expect(removed.changes.some((item) => item.kind === 'removed')).toBe(true)
  })

  it('does not consider an effective resolution fully valid without required dependencies', () => {
    const result = resolve([evidence()], { dependencies: dependencies.filter((item) => item.key !== 'official_evidence') })
    expect(result.status).toBe('review_required')
    expect(result.canConstrainNormativeSearch).toBe(false)
  })

  it('does not confirm evidence before validFrom or after validTo', () => {
    const future = resolve([evidence({ validFrom: '2027-01-01T00:00:00.000Z' })])
    const expired = resolve([evidence({ validTo: '2025-01-01T00:00:00.000Z' })])
    expect(future.status).toBe('review_required')
    expect(expired.status).toBe('review_required')
  })

  it('preserves effective values for distinct spatial scopes without globally constraining search', () => {
    const parcel = { kind: 'geometry', id: 'parcel-a' } as const
    const result = resolve([
      evidence({
        assertion: {
          subject: parcel,
          predicate: 'governed_by',
          object: { kind: 'detailed_regime', id: 'R-4' },
        },
      }),
      evidence({
        id: 'scope-b',
        determination: { type: 'ordinance', value: { code: 'R-2' }, relation: 'exclusive', exclusivityGroup: 'ordinance' },
        assertion: {
          subject: parcel,
          predicate: 'governed_by',
          object: { kind: 'detailed_regime', id: 'R-2' },
        },
        spatialScope: { scopeKey: 'area-b', relationToSubject: 'within' },
      }),
    ], { subject: parcel })
    expect(result.status).toBe('multiple_applicable')
    expect(result.determinations.every((item) => item.effectiveValue)).toBe(true)
    expect(result.canConstrainNormativeSearch).toBe(false)
  })

  it('never confirms an official raster by itself', () => {
    const result = resolve([evidence({ evidenceType: 'official_raster' })])
    expect(result.status).toBe('candidate')
    expect(result.determinations[0].effectiveValue).toBeUndefined()
  })

  it('keeps learned evidence as a candidate and no evidence as insufficient', () => {
    const learned = resolve([evidence({
      evidenceType: 'learned_candidate',
      provenance: 'learned',
      explicitRelation: false,
      spatialApplicability: 'unknown',
    })])
    const absent = resolve([])
    expect(learned.status).toBe('candidate')
    expect(learned.canConstrainNormativeSearch).toBe(false)
    expect(absent.status).toBe('evidence_insufficient')
  })

  it('returns a new superseded representation without mutating the original', () => {
    const result = resolve([evidence()])
    const superseded = supersedePlanningRegimeResolution(result, [
      ...dependencies.filter((item) => item.key !== 'geometry_snapshot'),
      { key: 'geometry_snapshot', value: 'geometry-b' },
    ])
    expect(result.status).toBe('officially_confirmed')
    expect(superseded.status).toBe('superseded')
    expect(superseded.resolutionId).toBe(result.resolutionId)
  })
})
