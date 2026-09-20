import { describe, expect, it } from 'vitest'
import {
  assertV2EmbeddingDimension,
  isV2CandidateInScope,
  selectMunicipalRetrievalMode,
  v2PilotConfigFromEnv,
} from './municipalRetrievalMode'

const base = {
  municipalityCode: '36059',
  instrumentId: 'VC-PXOM-001',
  parentInstrumentId: null,
  scopeValid: true,
  corpusAvailable: true,
}

const candidate = (overrides: Record<string, unknown> = {}) => ({
  municipalityCode: '36059',
  instrumentId: 'VC-PXOM-001',
  parentInstrumentId: null,
  officialDocumentId: 'DOC-1',
  officialUrl: 'https://example.test/doc.pdf',
  status: 'vigente',
  currentVersion: true,
  legalReviewStatus: 'reviewed',
  ...overrides,
})

describe('municipal V2 pilot gate', () => {
  it('keeps V1 when flag is off', () => {
    expect(selectMunicipalRetrievalMode(base, { enabled: false, allowedMunicipalityCodes: ['36059'] })).toBe('v1')
  })
  it('enables V2 only for the configured pilot municipality', () => {
    expect(selectMunicipalRetrievalMode(base, { enabled: true, allowedMunicipalityCodes: ['36059'] })).toBe('v2')
    expect(selectMunicipalRetrievalMode({ ...base, municipalityCode: '15030' }, { enabled: true, allowedMunicipalityCodes: ['36059'] })).toBe('v1')
  })
  it('does not enable V2 without a valid scope or corpus', () => {
    expect(selectMunicipalRetrievalMode({ ...base, scopeValid: false }, { enabled: true, allowedMunicipalityCodes: ['36059'] })).toBe('v1')
    expect(selectMunicipalRetrievalMode({ ...base, corpusAvailable: false }, { enabled: true, allowedMunicipalityCodes: ['36059'] })).toBe('v1')
  })
})

describe('V2 candidate scope and safety', () => {
  it('accepts exact municipality and instrument', () => expect(isV2CandidateInScope(candidate(), base)).toBe(true))
  it('rejects a different municipality', () => expect(isV2CandidateInScope(candidate({ municipalityCode: '15030' }), base)).toBe(false))
  it('rejects a different instrument', () => expect(isV2CandidateInScope(candidate({ instrumentId: 'OTHER' }), base)).toBe(false))
  it('rejects a different parent', () => expect(isV2CandidateInScope(candidate({ parentInstrumentId: 'PARENT-2' }), { ...base, parentInstrumentId: 'PARENT-1' })).toBe(false))
  it('does not mix a null parent with a present parent', () => expect(isV2CandidateInScope(candidate(), { ...base, parentInstrumentId: 'PARENT-1' })).toBe(false))
  it('accepts a matching parent', () => expect(isV2CandidateInScope(candidate({ parentInstrumentId: 'PARENT-1' }), { ...base, parentInstrumentId: 'PARENT-1' })).toBe(true))
  it('accepts vigente reviewed current version', () => expect(isV2CandidateInScope(candidate(), base)).toBe(true))

  it('accepts a reviewed current official document without requiring consolidation', () => {
    expect(isV2CandidateInScope(candidate({ isConsolidated: false }), base)).toBe(true)
  })
  it('rejects historical status', () => expect(isV2CandidateInScope(candidate({ status: 'derogada' }), base)).toBe(false))
  it('rejects non-current versions', () => expect(isV2CandidateInScope(candidate({ currentVersion: false }), base)).toBe(false))
  it('rejects unreviewed documents', () => expect(isV2CandidateInScope(candidate({ legalReviewStatus: 'pending' }), base)).toBe(false))
  it('accepts a current official pending document only with explicit provisional opt-in', () => {
    expect(isV2CandidateInScope(candidate({ legalReviewStatus: 'pending' }), { ...base, allowProvisional: true })).toBe(true)
  })
  it('never accepts rejected documents in provisional mode', () => {
    expect(isV2CandidateInScope(candidate({ legalReviewStatus: 'rejected' }), { ...base, allowProvisional: true })).toBe(false)
  })
  it('rejects missing officialDocumentId', () => expect(isV2CandidateInScope(candidate({ officialDocumentId: null }), base)).toBe(false))
  it('rejects missing official URL', () => expect(isV2CandidateInScope(candidate({ officialUrl: null }), base)).toBe(false))
  it('rejects contradictory metadata', () => expect(isV2CandidateInScope(candidate({ metadata: { instrumentId: 'OTHER' } }), base)).toBe(false))
  it('keeps PBA and PXOM separate by instrument', () => expect(isV2CandidateInScope(candidate({ instrumentId: 'PBA' }), base)).toBe(false))
  it('rejects a candidate with a missing required scope identity', () => expect(isV2CandidateInScope(candidate(), { ...base, instrumentId: undefined })).toBe(false))
  it('rejects an empty official document identifier', () => expect(isV2CandidateInScope(candidate({ officialDocumentId: '' }), base)).toBe(false))
  it('rejects an empty official URL', () => expect(isV2CandidateInScope(candidate({ officialUrl: '' }), base)).toBe(false))
  it('rejects a contradictory municipality in metadata', () => expect(isV2CandidateInScope(candidate({ metadata: { municipalityCode: '15030' } }), base)).toBe(false))
  it('accepts metadata identities when they agree with the scope', () => expect(isV2CandidateInScope(candidate({ municipalityCode: null, instrumentId: null, metadata: { municipalityCode: '36059', instrumentId: 'VC-PXOM-001' } }), base)).toBe(true))
  it('rejects a candidate without reviewed status even when current', () => expect(isV2CandidateInScope(candidate({ legalReviewStatus: null }), base)).toBe(false))
  it('rejects an explicitly historical currentVersion', () => expect(isV2CandidateInScope(candidate({ status: 'historical', currentVersion: true }), base)).toBe(false))
  it('rejects a candidate from a different parent when metadata disagrees', () => expect(isV2CandidateInScope(candidate({ parentInstrumentId: 'PARENT-1', metadata: { parentInstrumentId: 'PARENT-2' } }), { ...base, parentInstrumentId: 'PARENT-1' })).toBe(false))
  it('keeps a null parent only when metadata also has no parent', () => expect(isV2CandidateInScope(candidate({ metadata: { parentInstrumentId: null } }), base)).toBe(true))
  it('rejects a null parent when metadata introduces a parent', () => expect(isV2CandidateInScope(candidate({ metadata: { parentInstrumentId: 'PARENT-1' } }), base)).toBe(false))
  it('does not enable V2 for an unlisted municipality', () => expect(selectMunicipalRetrievalMode({ ...base, municipalityCode: '36060' }, { enabled: true, allowedMunicipalityCodes: ['36059'] })).toBe('v1'))
  it('does not enable V2 without an instrument', () => expect(selectMunicipalRetrievalMode({ ...base, instrumentId: null }, { enabled: true, allowedMunicipalityCodes: ['36059'] })).toBe('v1'))
  it('reads the pilot flag from environment without changing the default', () => {
    expect(selectMunicipalRetrievalMode(base, { enabled: false, allowedMunicipalityCodes: [] })).toBe('v1')
  })
  it('requires an explicit provisional environment flag', () => {
    expect(v2PilotConfigFromEnv({ URBANBRAIN_V2_MUNICIPAL_RETRIEVAL_ENABLED: 'true', URBANBRAIN_V2_MUNICIPAL_PILOT_CODES: '36059' }).provisionalEnabled).toBe(false)
    expect(v2PilotConfigFromEnv({ URBANBRAIN_V2_MUNICIPAL_RETRIEVAL_ENABLED: 'true', URBANBRAIN_V2_MUNICIPAL_PILOT_CODES: '36059', URBANBRAIN_V2_MUNICIPAL_PROVISIONAL_ENABLED: 'true' }).provisionalEnabled).toBe(true)
  })
  it('rejects a non-finite embedding value', () => expect(() => assertV2EmbeddingDimension([...(new Array(767).fill(0)), Infinity])).toThrow())
})

describe('V2 embedding contract', () => {
  it('accepts exactly 768 dimensions', () => expect(() => assertV2EmbeddingDimension(new Array(768).fill(0))).not.toThrow())
  it('rejects 3072 dimensions', () => expect(() => assertV2EmbeddingDimension(new Array(3072).fill(0))).toThrow(/768/))
  it('rejects empty or malformed vectors', () => {
    expect(() => assertV2EmbeddingDimension([])).toThrow()
    expect(() => assertV2EmbeddingDimension([0, Number.NaN])).toThrow()
  })
})
