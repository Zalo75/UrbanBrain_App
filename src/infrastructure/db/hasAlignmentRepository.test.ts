import { describe, expect, it, vi } from 'vitest'
vi.mock('./client', () => ({ db: {} }))
import { isCompatibleHasAlignment } from './hasAlignmentRepository'

describe('HAS alignment compatibility', () => {
  const base = { expedienteId: 'e', cadastralReference: 'rc', historicalViewId: 'h', modernViewId: 'm', crs: 'EPSG:4326' }
  it('accepts the same parcel and source materials', () => expect(isCompatibleHasAlignment(base, base)).toBe(true))
  it.each(['cadastralReference', 'historicalViewId', 'modernViewId', 'crs'] as const)('rejects changed %s', key => expect(isCompatibleHasAlignment(base, { ...base, [key]: 'changed' })).toBe(false))
  it('rejects a different expediente', () => expect(isCompatibleHasAlignment(base, { ...base, expedienteId: 'other' })).toBe(false))
})
