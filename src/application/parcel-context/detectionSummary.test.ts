import { describe, expect, it } from 'vitest'
import { rehydrateDetectionSummary } from './rehydrateDetectionSummary'
import { detectionSummary } from './detectionSummary'
import { buildNormalizedParcelContext } from './normalizeParcelContext'
import { buildTerritorialFactualContract } from './buildFactualContract'
import { createTechnicianDetermination } from '@/domain/territorial-resolver/determinations'
import type { TerritorialResolution } from '@/domain/territorial-resolver/types'

const resolution: TerritorialResolution = {
  status: 'confirmed', confidence: 'high', inputMethod: 'cadastral_reference',
  cadastralReference: '1234567NH4913S', municipality: 'A Coruña', municipalityCode: '15030',
  parcelGeometry: { type: 'MultiPolygon', crs: 'EPSG:4326', coordinates: [[[[-8,43],[-7.999,43],[-7.999,43.001],[-8,43.001],[-8,43]]]] },
  candidates: [], evidence: [{ source: 'catastro', sourceUrl: 'https://official.example/parcel', retrievedAt: '2026-09-07', method: 'geometry' }], warnings: [], conflicts: [],
  planning: { status: 'partial', instrument: 'PGOM', areas: [{ type: 'sector', name: 'SURT1' }], evidence: [], warnings: [] },
  affects: { analysisGeometry: 'parcel', detected: [], canRuleOutUndetectedAffects: false, warnings: [] }, resolvedAt: '2026-09-07',
}

describe('canonical fact continuity', () => {
  it('preserves technician classification and nonzero work area through JSON reload and chat facts', () => {
    const input = structuredClone(resolution)
    input.continuity = { usingPreviousOfficialContext: false, sameParcelAsPrevious: true, manualContext: {
      provenance: 'manual', verification: 'technician_validated', recordedAt: '2026-09-07',
      classificationDetermination: { technician: createTechnicianDetermination('Urbanizable', 'technician') },
      actionAreaSelection: { history: [], current: { id: 'work-area', geometry: input.parcelGeometry!, surfaceSquareMetres: 0, parcelSurfaceSquareMetres: 0, selectionType: 'whole_parcel', source: 'manual', confidence: 'high', selectedBy: 'technician', selectedAt: '2026-09-07', verification: 'technician_validated' } },
    } }
    const stored = JSON.parse(JSON.stringify(detectionSummary(input)))
    expect(stored.schemaVersion).toBe(1)
    expect(rehydrateDetectionSummary(stored, { ...input, planning: { ...input.planning, classification: undefined } })).toBe(stored)
    const legacy = { ...stored, schemaVersion: undefined, classificationDetermination: undefined, landClass: undefined, urbanisticFacts: undefined }
    expect(rehydrateDetectionSummary(legacy, input)?.landClass).toBe('Urbanizable')
    const normalized = buildNormalizedParcelContext({ expediente: {}, detected: stored })
    expect(normalized.landClass?.value).toBe('Urbanizable')
    expect(normalized.landClass?.verification).toBe('confirmed')
    expect(normalized.urbanisticFacts?.classification.value?.code).toBe('Urbanizable')
    expect(normalized.actionArea?.value.surfaceSquareMetres).toBeGreaterThan(8000)
    expect(normalized.planningInstrument?.value).toBe('PGOM')
    expect(normalized.planningArea?.value).toBe('SURT1')
    expect(normalized.coverage?.unresolvedSurfaceSquareMetres).toBeGreaterThan(8000)
    const factual = JSON.stringify(buildTerritorialFactualContract(normalized))
    expect(factual).toContain('Urbanizable')
    expect(factual).not.toContain('"areaSquareMetres":0')
  })
  it('preserves unfamiliar classification codes without inventing ordinance identity', () => {
    const input = structuredClone(resolution)
    input.planning.classification = { code: 'SUR', label: 'Urbanizable', sourceFeatureIds: [] }
    const summary = detectionSummary(input)
    expect(summary.landClass).toBe('SUR')
    expect(summary.qualification).toBeUndefined()
    expect(summary.coverage?.status).toBe('unresolved')
  })

  it('reconciles an explicit legacy operational selection without candidateId and keeps spatial coverage unresolved', () => {
    const input = structuredClone(resolution)
    input.planning.classificationResolution = {
      status: 'review_required', nextAction: 'manual_selection', candidates: [], discrepancies: [],
      reviewReasons: ['insufficient_geometry'], sourceChecks: [], officialLinks: [], evidence: [],
      finalSelection: {
        origin: 'manual', operationalValue: 'urbanizable', areaNames: ['SURT1'],
        technicianValidated: false, reason: 'legacy explicit selection', selectedAt: '2026-09-07', selectedBy: 'legacy-user',
      },
    }
    const legacy = { ...detectionSummary(input), schemaVersion: undefined, landClass: undefined, classificationDetermination: undefined }
    const rehydrated = rehydrateDetectionSummary(legacy, input)
    expect(rehydrated?.landClass).toBe('urbanizable')
    expect(rehydrated?.classificationDetermination?.technician?.value).toBe('urbanizable')
    expect(rehydrated?.coverage?.coveredSurfaceSquareMetres).toBe(0)
    expect(rehydrated?.coverage?.status).toBe('unresolved')
  })

  it('does not silently choose between contradictory historical explicit values', () => {
    const input = structuredClone(resolution)
    input.planning.classificationResolution = {
      status: 'review_required', nextAction: 'manual_selection', candidates: [], discrepancies: [],
      reviewReasons: ['source_disagreement'], sourceChecks: [], officialLinks: [], evidence: [],
      finalSelection: { origin: 'manual', operationalValue: 'urbanizable', areaNames: [], technicianValidated: false },
    }
    const legacy = { ...detectionSummary(input), schemaVersion: undefined, landClass: 'rustico', classificationDetermination: undefined }
    const rehydrated = rehydrateDetectionSummary(legacy, input)
    expect(rehydrated?.landClass).toBeUndefined()
    expect(rehydrated?.unknownReasons?.classification).toContain('Conflicting')
  })
})
