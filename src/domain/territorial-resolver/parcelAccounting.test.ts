import { describe, expect, it } from 'vitest'
import { accountParcelGeometry, geometrySurface } from './parcelAccounting'
import type { ClassificationCandidate, ParcelGeometry } from './types'

const rectangle = (left = -8, right = -7.999): ParcelGeometry => ({ type: 'MultiPolygon', crs: 'EPSG:4326', coordinates: [[[[left, 43], [right, 43], [right, 43.001], [left, 43.001], [left, 43]]]] })
const candidate = (id: string, geometry: ParcelGeometry): ClassificationCandidate => ({ id, kind: 'official_classification', classification: { code: 'SU', label: 'Urbano', sourceFeatureIds: [id] }, evidence: [], confidence: 'high', evidenceBasis: 'parcel_geometry', instrumentTraceability: 'verified', normalizationStatus: 'mapped', areas: [], source: 'siotuga', parcelCoverage: { parcelAreaSquareMetres: 9000, intersectionAreaSquareMetres: 1, parcelPercentage: 1, method: 'polygon_intersection', intersectionGeometry: geometry } })

describe('complete parcel geometry accounting', () => {
  it('keeps the entire uncovered parcel, with a measured nonzero surface', () => {
    const result = accountParcelGeometry(rectangle())
    expect(result.unresolvedGeometry).toEqual(rectangle())
    expect(result.unresolvedSurfaceSquareMetres).toBeGreaterThan(8000)
    expect(result.coveredSurfaceSquareMetres).toBe(0)
    expect(result.reasons.join()).toContain('planning may still apply')
  })
  it('does not invent zero when geometry is absent', () => {
    expect(accountParcelGeometry(undefined).analysedSurfaceSquareMetres).toBeUndefined()
    expect(accountParcelGeometry(undefined).unresolvedSurfaceSquareMetres).toBeUndefined()
  })
  it('keeps coverage unresolved when a classification has no parcel intersection geometry', () => {
    const withoutIntersection = { ...candidate('no-geometry', rectangle()), parcelCoverage: { ...candidate('tmp', rectangle()).parcelCoverage!, intersectionGeometry: undefined } }
    const result = accountParcelGeometry(rectangle(), [withoutIntersection])
    expect(result.portions).toHaveLength(0)
    expect(result.coveredSurfaceSquareMetres).toBe(0)
    expect(result.unresolvedSurfaceSquareMetres).toBeCloseTo(result.analysedSurfaceSquareMetres!)
    expect(result.status).toBe('unresolved')
  })
  it('accounts for multiple zones and the remainder within explicit tolerance', () => {
    const result = accountParcelGeometry(rectangle(), [candidate('one', rectangle(-8, -7.9997)), candidate('two', rectangle(-7.9997, -7.9994))])
    expect(result.portions).toHaveLength(2)
    expect(result.unresolvedSurfaceSquareMetres).toBeGreaterThan(0)
    expect(Math.abs(result.analysedSurfaceSquareMetres! - result.coveredSurfaceSquareMetres! - result.unresolvedSurfaceSquareMetres!)).toBeLessThan(result.toleranceSquareMetres)
  })
  it('unions overlapping evidence instead of inflating coverage', () => {
    const result = accountParcelGeometry(rectangle(), [candidate('one', rectangle()), candidate('two', rectangle())])
    expect(result.coveredSurfaceSquareMetres).toBeCloseTo(result.analysedSurfaceSquareMetres!)
    expect(result.overlapSurfaceSquareMetres).toBeGreaterThan(0)
    expect(result.status).toBe('unresolved')
  })
  it('subtracts holes from measured surface', () => {
    const shape = rectangle()
    shape.coordinates[0].push(rectangle(-7.9998, -7.9992).coordinates[0][0])
    expect(geometrySurface(shape)).toBeCloseTo(geometrySurface(rectangle())! * 0.4, 1)
  })
})
