import { describe, expect, it } from 'vitest'
import { enrichOrdinanceCandidate, findAcceptedInstrumentIdentity, findInstrumentIdentity, getInstrumentIdentityCatalog, getInstrumentIdentityOptions, isAutomaticallyAuthoritative } from './instrumentIdentityCatalog'

describe('instrument identity catalog', () => {
  it('keeps identities isolated by municipality and instrument', () => {
    const teo = getInstrumentIdentityCatalog('15082', '27387')
    const vila = getInstrumentIdentityCatalog('36059', '23045')
    expect(teo?.instrumentId).toBe('27387')
    expect(vila?.instrumentId).toBe('23045')
    expect(findInstrumentIdentity(teo, 'R-2')?.id).toBe('27387:ordinance:R-2')
    expect(findInstrumentIdentity(vila, 'R-2')).toBeUndefined()
  })

  it('exposes accepted and review options, never rejected identities', () => {
    const options = getInstrumentIdentityOptions('15082', '27387')
    expect(options.some((item) => item.officialCode === 'R-2' && item.status === 'ACCEPTED')).toBe(true)
    expect(options.some((item) => item.officialCode === 'SU-C')).toBe(false)
  })

  it('enriches a detected candidate with an instrument-scoped canonical id', () => {
    const catalog = getInstrumentIdentityCatalog('15082', '27387')
    const result = enrichOrdinanceCandidate({ identity: 'R-2', instrumentId: '27387', provenance: [] }, catalog)
    expect(result.identityId).toBe('27387:ordinance:R-2')
    expect(result.catalogStatus).toBe('ACCEPTED')
    expect(result.normativeReferences?.some((ref) => ref.article === 'Art. 130')).toBe(true)
  })

  it('never treats review-required catalog identities as automatic authority', () => {
    const catalog = getInstrumentIdentityCatalog('36059', '23045')
    const review = enrichOrdinanceCandidate({ identity: '1', instrumentId: '23045', provenance: [] }, catalog)
    expect(review.catalogStatus).toBe('REVIEW_REQUIRED')
    expect(isAutomaticallyAuthoritative(review)).toBe(false)
  })

  it('refuses to enrich when more than one accepted identity matches', () => {
    const catalog = getInstrumentIdentityCatalog('15082', '27387')
    expect(catalog).toBeDefined()
    const duplicateCatalog = {
      ...catalog!,
      identities: [
        ...catalog!.identities,
        { ...catalog!.identities.find((identity) => identity.officialCode === 'R-2')!, id: 'duplicate:r2' },
      ],
    }
    expect(findAcceptedInstrumentIdentity(duplicateCatalog, 'R-2', 'ordinance')).toBeUndefined()
  })

  it('loads Cerceda from the generated instrument catalogue without mixing dimensions', () => {
    const catalog = getInstrumentIdentityCatalog('15024', '22284')
    expect(catalog).toBeDefined()
    expect(catalog?.identities.find((identity) => identity.officialCode === 'RD')).toMatchObject({ semanticDimension: 'ordinance', status: 'ACCEPTED' })
    expect(catalog?.identities.find((identity) => identity.officialCode === 'CJ')).toMatchObject({ semanticDimension: 'ordinance', status: 'ACCEPTED' })
    expect(catalog?.identities.find((identity) => identity.officialCode === 'RD')?.normativeReferences.length).toBeGreaterThan(0)
    expect(catalog?.identities.some((identity) => identity.officialCode === 'SA-2')).toBe(false)
    expect(catalog?.identities.find((identity) => identity.officialCode === 'NU')?.semanticDimension).toBe('classification')
    expect(catalog?.identities.find((identity) => identity.officialCode === 'NT')?.semanticDimension).toBe('category')
    expect(catalog?.identities.find((identity) => identity.officialCode === 'MF')?.semanticDimension).toBe('protection')
    expect(getInstrumentIdentityOptions('15024', '22284').map((identity) => identity.officialCode)).toEqual(expect.arrayContaining(['RD', 'CJ']))
    expect(getInstrumentIdentityOptions('15024', '22284').some((identity) => ['NU', 'NT', 'MF'].includes(identity.officialCode))).toBe(false)
  })
})
