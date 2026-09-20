import { describe, expect, it, vi } from 'vitest'
import {
  retrieveMunicipalProgressively,
} from './municipalProgressiveRetrieval'

const baseInput = {
  query_embedding: [0.1, 0.2],
  match_count: 8,
  filter_municipio_codigo: '15087',
  filter_document_names: ['NNSS.pdf'],
  filter_ordinance: 'Ordenanza R4',
  retrieveMunicipal: true,
}

function response(data: string[]) {
  return { data, error: null }
}

describe('retrieveMunicipalProgressively', () => {
  it('uses strict scope only when it returns candidates', async () => {
    const execute = vi.fn(async () => response(['strict']))

    const result = await retrieveMunicipalProgressively(baseInput, execute)

    expect(result.data).toEqual(['strict'])
    expect(result.strategy).toBe('strict')
    expect(result.attemptCount).toBe(1)
    expect(result.fallbackUsed).toBe(false)
    expect(result.status).toBe('MATCHES')
    expect(result.evidenceSpecificity).toBe('SPECIFIC')
    expect(execute).toHaveBeenCalledTimes(1)
    expect(execute.mock.calls[0][0]).toMatchObject({
      filter_municipio_codigo: '15087',
      filter_document_names: ['NNSS.pdf'],
      filter_ordinance: 'Ordenanza R4',
    })
  })

  it('relaxes ordinance only when strict returns zero', async () => {
    const execute = vi.fn()
      .mockResolvedValueOnce(response([]))
      .mockResolvedValueOnce(response(['document-scope']))

    const result = await retrieveMunicipalProgressively(baseInput, execute)

    expect(result.data).toEqual(['document-scope'])
    expect(result.strategy).toBe('document_scope')
    expect(result.attemptCount).toBe(2)
    expect(result.documentScopeCandidateCount).toBe(1)
    expect(result.status).toBe('NON_SPECIFIC_EVIDENCE')
    expect(result.specificStatus).toBe('NO_MATCHES')
    expect(result.evidenceSpecificity).toBe('NON_SPECIFIC')
    expect(execute).toHaveBeenCalledTimes(2)
    expect(execute.mock.calls[1][0]).toMatchObject({
      filter_municipio_codigo: '15087',
      filter_document_names: ['NNSS.pdf'],
      filter_ordinance: null,
    })
  })

  it('does not discard document scope after a specific miss', async () => {
    const execute = vi.fn()
      .mockResolvedValueOnce(response([]))
      .mockResolvedValueOnce(response([]))

    const result = await retrieveMunicipalProgressively(baseInput, execute)

    expect(result.data).toEqual([])
    expect(result.strategy).toBe('document_scope')
    expect(result.status).toBe('NO_MATCHES')
    expect(result.attemptCount).toBe(2)
    expect(result.broadCandidateCount).toBe(0)
    expect(result.fallbackUsed).toBe(true)
    expect(execute).toHaveBeenCalledTimes(2)
    expect(execute.mock.calls.some(([args]) => args.filter_document_names === null)).toBe(false)
  })

  it('keeps NO_CANDIDATES input when every level is empty', async () => {
    const execute = vi.fn(async () => response([]))

    const result = await retrieveMunicipalProgressively(baseInput, execute)

    expect(result.data).toEqual([])
    expect(result.strategy).toBe('document_scope')
    expect(result.attemptCount).toBe(2)
    expect(result.fallbackUsed).toBe(true)
    expect(result.status).toBe('NO_MATCHES')
    expect(result.specificStatus).toBe('NO_MATCHES')
    expect(result.strictCandidateCount).toBe(0)
    expect(result.documentScopeCandidateCount).toBe(0)
    expect(result.broadCandidateCount).toBe(0)
  })

  it('does not fall back after a scoped timeout', async () => {
    const execute = vi.fn()
      .mockResolvedValueOnce({ data: [], error: { code: '57014' } })
      .mockResolvedValueOnce(response(['must-not-be-used']))

    const result = await retrieveMunicipalProgressively(baseInput, execute)

    expect(result.data).toEqual([])
    expect(result.error).toMatchObject({ code: '57014' })
    expect(result.status).toBe('TIMEOUT')
    expect(result.specificStatus).toBe('TIMEOUT')
    expect(result.strategy).toBe('strict')
    expect(result.failedStrategy).toBe('strict')
    expect(result.fallbackUsed).toBe(false)
    expect(execute).toHaveBeenCalledTimes(1)
  })

  it('can keep a directed retry strictly ordinance-scoped after a specific miss', async () => {
    const execute = vi.fn().mockResolvedValue(response([]))

    const result = await retrieveMunicipalProgressively(
      { ...baseInput, allowDocumentScopeFallback: false },
      execute
    )

    expect(result.data).toEqual([])
    expect(result.strategy).toBe('strict')
    expect(result.attemptCount).toBe(1)
    expect(result.status).toBe('NO_MATCHES')
    expect(result.evidenceSpecificity).toBe('NONE')
    expect(execute).toHaveBeenCalledTimes(1)
  })

  it('can recover a timeout through a bounded document-scoped executor', async () => {
    const execute = vi.fn().mockResolvedValueOnce({ data: [], error: { code: '57014' } })
    const executeDocumentScoped = vi.fn().mockResolvedValue({ data: ['r2-specific'], error: null })

    const result = await retrieveMunicipalProgressively(baseInput, execute, executeDocumentScoped)

    expect(result.data).toEqual(['r2-specific'])
    expect(result.error).toBeNull()
    expect(result.status).toBe('MATCHES')
    expect(result.specificStatus).toBe('TIMEOUT')
    expect(result.evidenceSpecificity).toBe('SPECIFIC')
    expect(result.strategy).toBe('document_scope')
    expect(result.fallbackUsed).toBe(true)
    expect(executeDocumentScoped).toHaveBeenCalledWith(expect.objectContaining({
      filter_municipio_codigo: '15087',
      filter_document_names: ['NNSS.pdf'],
      filter_ordinance: 'Ordenanza R4',
    }))
  })

  it('distinguishes a non-timeout RPC error and preserves the scope', async () => {
    const dbError = { code: 'XX000', message: 'planner failure' }
    const execute = vi.fn().mockResolvedValueOnce({ data: [], error: dbError })

    const result = await retrieveMunicipalProgressively(baseInput, execute)

    expect(result.data).toEqual([])
    expect(result.error).toBe(dbError)
    expect(result.status).toBe('ERROR')
    expect(result.specificStatus).toBe('ERROR')
    expect(result.strategy).toBe('strict')
    expect(result.failedStrategy).toBe('strict')
    expect(execute).toHaveBeenCalledTimes(1)
  })

  it('classifies a network fetch failure as ERROR, not TIMEOUT', async () => {
    const execute = vi.fn().mockResolvedValueOnce({ data: [], error: new TypeError('fetch failed') })

    const result = await retrieveMunicipalProgressively(baseInput, execute)

    expect(result.status).toBe('ERROR')
    expect(result.specificStatus).toBe('ERROR')
    expect(result.failedStrategy).toBe('strict')
    expect(execute).toHaveBeenCalledTimes(1)
  })

  it('uses document scope as specific evidence when no ordinance filter is requested', async () => {
    const execute = vi.fn().mockResolvedValueOnce(response(['document']))

    const result = await retrieveMunicipalProgressively(
      { ...baseInput, filter_ordinance: null },
      execute
    )

    expect(result.data).toEqual(['document'])
    expect(result.strategy).toBe('document_scope')
    expect(result.status).toBe('MATCHES')
    expect(result.evidenceSpecificity).toBe('SPECIFIC')
    expect(execute).toHaveBeenCalledTimes(1)
  })

  it('short-circuits immediately without RPC execution when hasMunicipalCorpus is false', async () => {
    const execute = vi.fn()
    const result = await retrieveMunicipalProgressively(
      { ...baseInput, hasMunicipalCorpus: false },
      execute
    )

    expect(result.data).toEqual([])
    expect(result.strategy).toBe('none')
    expect(result.attemptCount).toBe(0)
    expect(result.error).toBeNull()
    expect(execute).not.toHaveBeenCalled()
  })

  it('short-circuits immediately when hasMunicipalCorpus function returns exists: false', async () => {
    const execute = vi.fn()
    const hasCorpusFn = vi.fn().mockResolvedValue({ exists: false, error: null })
    const result = await retrieveMunicipalProgressively(
      { ...baseInput, hasMunicipalCorpus: hasCorpusFn },
      execute
    )

    expect(result.data).toEqual([])
    expect(result.strategy).toBe('none')
    expect(result.attemptCount).toBe(0)
    expect(result.error).toBeNull()
    expect(hasCorpusFn).toHaveBeenCalledWith('15087')
    expect(execute).not.toHaveBeenCalled()
  })

  it('propagates database error when hasMunicipalCorpus function fails', async () => {
    const execute = vi.fn()
    const dbError = new Error('Database connection failed')
    const hasCorpusFn = vi.fn().mockResolvedValue({ exists: false, error: dbError })
    const result = await retrieveMunicipalProgressively(
      { ...baseInput, hasMunicipalCorpus: hasCorpusFn },
      execute
    )

    expect(result.data).toEqual([])
    expect(result.strategy).toBe('none')
    expect(result.attemptCount).toBe(0)
    expect(result.error).toBe(dbError)
    expect(execute).not.toHaveBeenCalled()
  })
})
