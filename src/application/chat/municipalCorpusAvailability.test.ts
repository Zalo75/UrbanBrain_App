import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  checkMunicipalCorpusAvailability,
  clearMunicipalCorpusAvailabilityCache,
} from './municipalCorpusAvailability'

describe('checkMunicipalCorpusAvailability', () => {
  beforeEach(() => {
    clearMunicipalCorpusAvailabilityCache()
  })

  it('returns exists: false immediately for empty or undefined code', async () => {
    const checker = vi.fn()
    const r1 = await checkMunicipalCorpusAvailability('', checker)
    const r2 = await checkMunicipalCorpusAvailability(undefined, checker)

    expect(r1).toEqual({ exists: false, error: null })
    expect(r2).toEqual({ exists: false, error: null })
    expect(checker).not.toHaveBeenCalled()
  })

  it('calls checker when not in cache and caches positive result', async () => {
    const checker = vi.fn().mockResolvedValue({ exists: true, error: null })

    const r1 = await checkMunicipalCorpusAvailability('15009', checker)
    expect(r1).toEqual({ exists: true, error: null })
    expect(checker).toHaveBeenCalledTimes(1)

    // Second call should hit cache
    const r2 = await checkMunicipalCorpusAvailability('15009', checker)
    expect(r2).toEqual({ exists: true, error: null })
    expect(checker).toHaveBeenCalledTimes(1)
  })

  it('calls checker when not in cache and caches negative (zero corpus) result', async () => {
    const checker = vi.fn().mockResolvedValue({ exists: false, error: null })

    const r1 = await checkMunicipalCorpusAvailability('36059', checker)
    expect(r1).toEqual({ exists: false, error: null })
    expect(checker).toHaveBeenCalledTimes(1)

    // Second call should hit cache
    const r2 = await checkMunicipalCorpusAvailability('36059', checker)
    expect(r2).toEqual({ exists: false, error: null })
    expect(checker).toHaveBeenCalledTimes(1)
  })

  it('distinguishes real database errors and does not cache error results', async () => {
    const dbError = new Error('DB connection timeout')
    const checker = vi.fn()
      .mockResolvedValueOnce({ exists: false, error: dbError })
      .mockResolvedValueOnce({ exists: true, error: null })

    const r1 = await checkMunicipalCorpusAvailability('15009', checker)
    expect(r1).toEqual({ exists: false, error: dbError })
    expect(checker).toHaveBeenCalledTimes(1)

    // Next call after error should retry checker (not cached)
    const r2 = await checkMunicipalCorpusAvailability('15009', checker)
    expect(r2).toEqual({ exists: true, error: null })
    expect(checker).toHaveBeenCalledTimes(2)
  })
})
