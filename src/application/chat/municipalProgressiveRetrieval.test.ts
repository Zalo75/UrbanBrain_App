import { describe, expect, it, vi } from 'vitest'
import {
  retrieveMunicipalProgressively,
  type MunicipalRetrievalRpcArgs,
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
    const execute = vi.fn(async (_args: MunicipalRetrievalRpcArgs) => response(['strict']))

    const result = await retrieveMunicipalProgressively(baseInput, execute)

    expect(result.data).toEqual(['strict'])
    expect(result.strategy).toBe('strict')
    expect(result.attemptCount).toBe(1)
    expect(result.fallbackUsed).toBe(false)
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
    expect(execute).toHaveBeenCalledTimes(2)
    expect(execute.mock.calls[1][0]).toMatchObject({
      filter_municipio_codigo: '15087',
      filter_document_names: ['NNSS.pdf'],
      filter_ordinance: null,
    })
  })

  it('relaxes document names only when the first two levels return zero', async () => {
    const execute = vi.fn()
      .mockResolvedValueOnce(response([]))
      .mockResolvedValueOnce(response([]))
      .mockResolvedValueOnce(response(['municipal-scope']))

    const result = await retrieveMunicipalProgressively(baseInput, execute)

    expect(result.data).toEqual(['municipal-scope'])
    expect(result.strategy).toBe('municipal_scope')
    expect(result.attemptCount).toBe(3)
    expect(result.broadCandidateCount).toBe(1)
    expect(result.fallbackUsed).toBe(true)
    expect(execute).toHaveBeenCalledTimes(3)
    expect(execute.mock.calls[2][0]).toMatchObject({
      filter_municipio_codigo: '15087',
      filter_document_names: null,
      filter_ordinance: null,
    })
  })

  it('keeps NO_CANDIDATES input when every level is empty', async () => {
    const execute = vi.fn(async () => response([]))

    const result = await retrieveMunicipalProgressively(baseInput, execute)

    expect(result.data).toEqual([])
    expect(result.strategy).toBe('municipal_scope')
    expect(result.attemptCount).toBe(3)
    expect(result.fallbackUsed).toBe(true)
    expect(result.strictCandidateCount).toBe(0)
    expect(result.documentScopeCandidateCount).toBe(0)
    expect(result.broadCandidateCount).toBe(0)
  })
})
