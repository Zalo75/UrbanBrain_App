import { describe, expect, it } from 'vitest'
import { buildPreparedZoningLayer, intersectPreparedZoningLayer } from './preparedZoningLayer'

describe('PreparedZoningLayer', () => {
  const points = [
    { pixel: [0, 0] as [number, number], coordinate: [0, 0] as [number, number] },
    { pixel: [100, 0] as [number, number], coordinate: [1, 0] as [number, number] },
    { pixel: [100, 100] as [number, number], coordinate: [1, 1] as [number, number] },
    { pixel: [0, 100] as [number, number], coordinate: [0, 1] as [number, number] },
  ]
  const validatedGeoreference = {
    method: 'affine' as const,
    targetCrs: 'LOCAL_CARTESIAN',
    metricCrs: 'LOCAL_METRES',
    sourcePixelSpace: { width: 100, height: 100 },
    transformation: { x: [0.01, 0, 0] as [number, number, number], y: [0, 0.01, 0] as [number, number, number] },
    rmsMetres: 0,
    residuals: points.map((_, index) => ({ pointId: `P${index + 1}`, metres: 0, isOutlier: false })),
    validationStatus: 'VALIDATED' as const,
    validationMethod: 'TECHNICIAN_CONFIRMED' as const,
    qualityStatus: 'AUTO_ACCEPTABLE' as const,
    qualityFlags: [],
    reviewer: 'reviewer',
    validatedAt: '2026-08-24T00:00:00Z',
  }
  it('requires explicit review metadata and derives zones from pixel geometry', () => {
    const layer = buildPreparedZoningLayer({ municipalityCode: 'test', instrumentId: 'plan', sourceDocumentId: 'doc', sourceSheet: 'sheet.jpg', sourceUrl: 'https://example.invalid/sheet.jpg', sourceScale: 2000, rasterBytes: new Uint8Array([1, 2, 3]), tiePoints: points, pixelZones: [{ pixelGeometry: [[[0, 0], [50, 0], [50, 100], [0, 100], [0, 0]]], code: 'A', label: 'A', ordinance: 'A', normativeArticle: 'Art. 1', legendEvidence: 'legend', documentaryEvidence: 'doc', confidence: 'high' }], reviewer: 'reviewer', validatedAt: '2026-08-24T00:00:00Z', validatedGeoreference })
    expect(layer.validationStatus).toBe('VALIDATED')
    expect(layer.zones[0]!.geometry.coordinates[0]![1]).toEqual([0.5, 0])
  })
  it('intersects any parcel without a cadastral mapping', () => {
    const layer = buildPreparedZoningLayer({ municipalityCode: 'test', instrumentId: 'plan', sourceDocumentId: 'doc', sourceSheet: 'sheet.jpg', sourceUrl: 'https://example.invalid/sheet.jpg', sourceScale: 2000, rasterBytes: new Uint8Array([1]), tiePoints: points, pixelZones: [{ pixelGeometry: [[[0, 0], [50, 0], [50, 100], [0, 100], [0, 0]]], code: 'A', label: 'A', ordinance: 'A', normativeArticle: 'Art. 1', legendEvidence: 'legend', documentaryEvidence: 'doc', confidence: 'high' }], reviewer: 'reviewer', validatedAt: '2026-08-24T00:00:00Z', validatedGeoreference })
    const result = intersectPreparedZoningLayer(layer, [[[[0.25, 0.25], [0.75, 0.25], [0.75, 0.75], [0.25, 0.75], [0.25, 0.25]]]])
    expect(result).toHaveLength(1)
    expect(result[0]!.coveragePercent).toBeCloseTo(50)
  })
  it('preserves a reviewed metric georeference instead of recalculating it differently', () => {
    const layer = buildPreparedZoningLayer({ municipalityCode: 'test', instrumentId: 'plan', sourceDocumentId: 'doc', sourceSheet: 'sheet.jpg', sourceUrl: 'https://example.invalid/sheet.jpg', sourceScale: 2000, rasterBytes: new Uint8Array([1]), tiePoints: points, pixelZones: [{ pixelGeometry: [[[0, 0], [50, 0], [50, 100], [0, 100], [0, 0]]], code: 'A', label: 'A', ordinance: 'A', normativeArticle: 'Art. 1', legendEvidence: 'legend', documentaryEvidence: 'doc', confidence: 'high' }], reviewer: 'reviewer', validatedAt: '2026-08-24T00:00:00Z', validatedGeoreference: { method: 'affine', targetCrs: 'EPSG:25829', metricCrs: 'EPSG:25829', sourcePixelSpace: { width: 100, height: 100 }, transformation: { x: [0.01, 0, 0], y: [0, 0.01, 0] }, rmsMetres: 0.5, residuals: points.map((_, index) => ({ pointId: `P${index + 1}`, metres: 0.5, isOutlier: false })), validationStatus: 'VALIDATED', validationMethod: 'TECHNICIAN_CONFIRMED', qualityStatus: 'AUTO_ACCEPTABLE', qualityFlags: [], reviewer: 'reviewer', validatedAt: '2026-08-24T00:00:00Z' } })
    expect(layer.targetCrs).toBe('EPSG:25829')
    expect(layer.rmsMetres).toBe(0.5)
    expect(layer.sourcePixelSpace.width).toBe(100)
  })
  it('preserves warning-bearing metrics after explicit technician confirmation instead of applying a fixed RMS gate', () => {
    const residuals = [
      { pointId: 'P1', metres: 4.25, leaveOneOutMetres: 9.1, isOutlier: true, exceedsAutomaticCriterion: true },
      { pointId: 'P2', metres: 8.8, leaveOneOutMetres: 10.4, isOutlier: true, exceedsAutomaticCriterion: true },
      { pointId: 'P3', metres: 11.2, leaveOneOutMetres: 12.7, isOutlier: true, exceedsAutomaticCriterion: true },
      { pointId: 'P4', metres: 10.9, leaveOneOutMetres: 11.5, isOutlier: true, exceedsAutomaticCriterion: true },
    ]
    const layer = buildPreparedZoningLayer({ municipalityCode: 'test', instrumentId: 'plan', sourceDocumentId: 'doc', sourceSheet: 'sheet.jpg', sourceUrl: 'https://example.invalid/sheet.jpg', sourceScale: 2000, rasterBytes: new Uint8Array([1]), tiePoints: points, pixelZones: [{ pixelGeometry: [[[0, 0], [50, 0], [50, 100], [0, 100], [0, 0]]], code: 'A', label: 'A', ordinance: 'A', normativeArticle: 'Art. 1', legendEvidence: 'legend', documentaryEvidence: 'doc', confidence: 'high' }], reviewer: 'reviewer', validatedAt: '2026-08-24T00:00:00Z', validatedGeoreference: { method: 'affine', targetCrs: 'EPSG:25829', metricCrs: 'EPSG:25829', sourcePixelSpace: { width: 100, height: 100 }, transformation: { x: [0.01, 0, 0], y: [0, 0.01, 0] }, rmsMetres: 9.51, residuals, validationStatus: 'VALIDATED', validationMethod: 'TECHNICIAN_CONFIRMED', qualityStatus: 'REVIEW_REQUIRED', qualityFlags: ['RMS_EXCEEDS_AUTOMATIC_CRITERION', 'RESIDUAL_EXCEEDS_AUTOMATIC_CRITERION'], automaticCriteriaWarning: 'Automatic acceptance criteria were exceeded.', validationPurpose: 'Territorial zoning preparation', reviewer: 'reviewer', validatedAt: '2026-08-24T00:00:00Z' } })

    expect(layer.rmsMetres).toBe(9.51)
    expect(layer.residuals).toEqual(residuals)
    expect(layer.qualityStatus).toBe('REVIEW_REQUIRED')
    expect(layer.validationMethod).toBe('TECHNICIAN_CONFIRMED')
    expect(layer.qualityFlags).toEqual(['RMS_EXCEEDS_AUTOMATIC_CRITERION', 'RESIDUAL_EXCEEDS_AUTOMATIC_CRITERION'])
    expect(layer.provenance).toContain('quality-flag:RMS_EXCEEDS_AUTOMATIC_CRITERION')
  })
  it('still blocks a structurally degenerate transformation after purported review', () => {
    expect(() => buildPreparedZoningLayer({ municipalityCode: 'test', instrumentId: 'plan', sourceDocumentId: 'doc', sourceSheet: 'sheet.jpg', sourceUrl: 'https://example.invalid/sheet.jpg', sourceScale: 2000, rasterBytes: new Uint8Array([1]), tiePoints: points, pixelZones: [{ pixelGeometry: [[[0, 0], [50, 0], [50, 100], [0, 100], [0, 0]]], code: 'A', label: 'A', ordinance: 'A', normativeArticle: 'Art. 1', legendEvidence: 'legend', documentaryEvidence: 'doc', confidence: 'high' }], reviewer: 'reviewer', validatedAt: '2026-08-24T00:00:00Z', validatedGeoreference: { method: 'affine', targetCrs: 'EPSG:25829', metricCrs: 'EPSG:25829', sourcePixelSpace: { width: 100, height: 100 }, transformation: { x: [1, 1, 0], y: [2, 2, 0] }, rmsMetres: 9.51, residuals: points.map((_, index) => ({ pointId: `P${index + 1}`, metres: 9.51, isOutlier: true })), validationStatus: 'VALIDATED', validationMethod: 'TECHNICIAN_CONFIRMED', qualityStatus: 'REVIEW_REQUIRED', qualityFlags: ['RMS_EXCEEDS_AUTOMATIC_CRITERION'], reviewer: 'reviewer', validatedAt: '2026-08-24T00:00:00Z' } })).toThrow('non-degenerate')
  })
  it('does not allow an oversized human control set', () => {
    expect(() => buildPreparedZoningLayer({ municipalityCode: 'test', instrumentId: 'plan', sourceDocumentId: 'doc', sourceSheet: 'sheet.jpg', sourceUrl: 'https://example.invalid/sheet.jpg', sourceScale: 2000, rasterBytes: new Uint8Array([1]), tiePoints: Array.from({ length: 13 }, (_, index) => ({ pixel: [index, index] as [number, number], coordinate: [index, index] as [number, number] })), pixelZones: [{ pixelGeometry: [[[0, 0], [1, 0], [1, 1], [0, 0]]], code: 'A', label: 'A', ordinance: 'A', normativeArticle: 'Art. 1', legendEvidence: 'legend', documentaryEvidence: 'doc', confidence: 'high' }], reviewer: 'reviewer', validatedAt: '2026-08-24T00:00:00Z', validatedGeoreference })).toThrow('twelve')
  })
})
