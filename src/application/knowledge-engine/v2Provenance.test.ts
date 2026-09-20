import { describe, expect, it } from 'vitest'
import { preserveV2Provenance } from './v2Provenance'

describe('V2 field-level provenance', () => {
  it('preserves identity, article, page, URL and checksum', () => {
    expect(preserveV2Provenance({ municipalityCode: '36059', instrumentId: '23045', parentInstrumentId: null, officialDocumentId: '54464', article: 'Art. 4', page: 12, officialUrl: 'https://example.test/a.pdf', checksum: 'sha', batchId: 'B' })).toMatchObject({ municipalityCode: '36059', instrumentId: '23045', officialDocumentId: '54464', article: 'Art. 4', page: 12, officialUrl: 'https://example.test/a.pdf', checksum: 'sha', batchId: 'B' })
  })
  it('recovers optional fields from chunk metadata', () => {
    expect(preserveV2Provenance({ metadata: { municipalityCode: '36059', instrumentId: '23045', officialDocumentId: '54464', officialUrl: 'https://example.test/a.pdf', checksum: 'sha' } })).toMatchObject({ municipalityCode: '36059', instrumentId: '23045', officialDocumentId: '54464', officialUrl: 'https://example.test/a.pdf', checksum: 'sha' })
  })
  it('does not invent missing provenance', () => {
    expect(preserveV2Provenance({})).toEqual({ municipalityCode: null, instrumentId: null, parentInstrumentId: null, officialDocumentId: null, article: null, page: null, officialUrl: null, checksum: null, documentType: null, batchId: null })
  })
})
