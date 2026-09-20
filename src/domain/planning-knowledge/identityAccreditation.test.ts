import { describe, expect, it } from 'vitest'
import { isAccreditedIdentity, type InstrumentIdentity } from './identityCatalog'

const identity: InstrumentIdentity = { id: 'plan:ordinance:1', municipalityCode: '12345', instrumentId: 'plan', officialCode: '1', officialName: 'Residential ordinance', semanticDimension: 'ordinance', status: 'ACCEPTED', evidence: [{ sourceId: 'official-plan', officialUrl: 'https://official.example/plan.pdf', locator: 'page 12' }], normativeReferences: [] }
describe('identity accreditation barrier', () => {
  it('accepts numbered ordinances only with explicit accreditation and provenance', () => {
    expect(isAccreditedIdentity(identity)).toBe(true)
    expect(isAccreditedIdentity({ ...identity, evidence: [] })).toBe(false)
    expect(isAccreditedIdentity({ ...identity, status: 'OBSERVED_NOT_ACREDITED' })).toBe(false)
    expect(isAccreditedIdentity({ ...identity, status: 'REVIEW_REQUIRED' })).toBe(false)
  })
  it('does not let an extraction confidence or instrument-free label certify identity', () => {
    expect(isAccreditedIdentity({ ...identity, instrumentId: '' })).toBe(false)
    expect(isAccreditedIdentity({ ...identity, evidence: [{ sourceId: 'regex', confidence: 'high' }] })).toBe(false)
  })
})
