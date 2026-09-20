import { describe, expect, it } from 'vitest'
import {
  clearGeoreferencingSession,
  createGeoreferencingSessionScope,
  georeferencingSessionStorageKey,
  restoreGeoreferencingSession,
  saveGeoreferencingSession,
} from '../../../scripts/georeferencing-session.js'

function memoryStorage() {
  const values = new Map<string, string>()
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
    removeItem: (key: string) => values.delete(key),
  }
}

const manifest = {
  schemaVersion: 'territorial-preparation-case/v1',
  caseId: 'case-a',
  territory: { municipalityCode: 'test-code', instrumentId: 'instrument-a' },
  historicalCartography: { id: 'sheet-a.jpg', sourceHash: 'hash-a', sourceUrl: 'https://official.example/sheet-a.jpg' },
  targetParcel: { reference: 'parcel-a' },
  targetCrs: 'EPSG:4326',
}

const state = {
  points: [
    { id: 'p1', imageCoordinate: [10, 20], referenceCoordinate: [-8.1, 42.2], referenceSourceId: 'official-a', capability: 'physical_anchor' },
    { id: 'p2', imageCoordinate: [30, 20], referenceCoordinate: [-8.0, 42.2], referenceSourceId: 'official-a', capability: 'physical_anchor' },
    { id: 'p3', imageCoordinate: [30, 40], referenceCoordinate: [-8.0, 42.3], referenceSourceId: 'official-a', capability: 'physical_anchor' },
    { id: 'p4', imageCoordinate: [10, 40], referenceCoordinate: [-8.1, 42.3], referenceSourceId: 'official-a', capability: 'physical_anchor' },
  ],
  rasterView: { scale: 1.2, ox: 10, oy: -5 },
  gisView: { scale: 2, ox: -20, oy: 14 },
  visibility: { 'official-a': true, 'official-b': false },
  showPoints: true,
  showParcel: true,
  showOverlay: true,
  overlayOpacity: 61,
  overlaySeen: true,
  reviewer: 'Técnica responsable',
  humanConfirmation: false,
  controlSourceId: 'official-a',
  zones: [],
  validationSnapshot: {
    status: 'REVIEW_REQUIRED',
    rmsMetres: 9.51,
    residuals: [{ pointId: 'p1', metres: 9.51 }],
    qualityFlags: ['RMS_EXCEEDS_AUTOMATIC_CRITERION'],
  },
}

describe('georeferencing session persistence', () => {
  it('saves and restores the complete compatible local session', () => {
    const storage = memoryStorage()
    const scope = createGeoreferencingSessionScope(manifest)
    saveGeoreferencingSession(storage, scope, state, '2026-08-24T20:00:00Z')

    expect(restoreGeoreferencingSession(storage, scope)).toEqual({
      status: 'RESTORED',
      state,
      savedAt: '2026-08-24T20:00:00Z',
    })
  })

  it('does not restore a session after the source sheet or hash changes', () => {
    const storage = memoryStorage()
    const originalScope = createGeoreferencingSessionScope(manifest)
    saveGeoreferencingSession(storage, originalScope, state)
    const changedScope = createGeoreferencingSessionScope({
      ...manifest,
      historicalCartography: { ...manifest.historicalCartography, id: 'sheet-b.jpg', sourceHash: 'hash-b' },
    })

    // Same case key deliberately exposes the old envelope to the compatibility check.
    expect(georeferencingSessionStorageKey(changedScope)).toBe(georeferencingSessionStorageKey(originalScope))
    expect(restoreGeoreferencingSession(storage, changedScope)).toMatchObject({
      status: 'INCOMPATIBLE',
      reason: 'MANIFEST_OR_SOURCE_CHANGED',
    })
  })

  it('keeps sessions from different manifests/cases isolated', () => {
    const storage = memoryStorage()
    const scope = createGeoreferencingSessionScope(manifest)
    saveGeoreferencingSession(storage, scope, state)
    const otherScope = createGeoreferencingSessionScope({ ...manifest, caseId: 'case-b' })

    expect(restoreGeoreferencingSession(storage, otherScope)).toEqual({ status: 'NONE' })
  })

  it('clears only the explicitly scoped session', () => {
    const storage = memoryStorage()
    const scope = createGeoreferencingSessionScope(manifest)
    saveGeoreferencingSession(storage, scope, state)
    clearGeoreferencingSession(storage, scope)

    expect(restoreGeoreferencingSession(storage, scope)).toEqual({ status: 'NONE' })
  })

  it('preserves the metric snapshot while allowing the UI to recalculate from restored points', () => {
    const storage = memoryStorage()
    const scope = createGeoreferencingSessionScope(manifest)
    saveGeoreferencingSession(storage, scope, state)
    const restored = restoreGeoreferencingSession(storage, scope)

    expect(restored.status).toBe('RESTORED')
    if (restored.status !== 'RESTORED') throw new Error('Session was not restored')
    expect(restored.state.validationSnapshot).toEqual(state.validationSnapshot)
    expect(restored.state.points).toEqual(state.points)
  })
})
