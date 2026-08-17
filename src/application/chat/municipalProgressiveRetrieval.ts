export type MunicipalRetrievalStrategy =
  | 'strict'
  | 'document_scope'
  | 'municipal_scope'
  | 'none'

export interface MunicipalRetrievalRpcArgs {
  query_embedding: number[]
  match_count: number
  filter_municipio_codigo: string
  filter_document_names: string[] | null
  filter_ordinance: string | null
}

export interface MunicipalProgressiveRetrievalInput {
  query_embedding: number[]
  match_count: number
  filter_municipio_codigo: string
  filter_document_names?: readonly string[] | null
  filter_ordinance?: string | null
  retrieveMunicipal: boolean
}

export interface MunicipalProgressiveRetrievalResult<T> {
  data: T[]
  error: unknown | null
  strategy: MunicipalRetrievalStrategy
  attemptCount: number
  strictCandidateCount: number
  documentScopeCandidateCount: number
  broadCandidateCount: number
  fallbackUsed: boolean
}

type RpcResult<T> = {
  data: T[] | null
  error: unknown | null
}

function emptyResult<T>(): MunicipalProgressiveRetrievalResult<T> {
  return {
    data: [],
    error: null,
    strategy: 'none',
    attemptCount: 0,
    strictCandidateCount: 0,
    documentScopeCandidateCount: 0,
    broadCandidateCount: 0,
    fallbackUsed: false,
  }
}

export async function retrieveMunicipalProgressively<T>(
  input: MunicipalProgressiveRetrievalInput,
  execute: (args: MunicipalRetrievalRpcArgs) => Promise<RpcResult<T>>
): Promise<MunicipalProgressiveRetrievalResult<T>> {
  if (!input.retrieveMunicipal) return emptyResult<T>()

  const documentNames = input.filter_document_names?.length
    ? [...input.filter_document_names]
    : null
  const ordinance = input.filter_ordinance?.trim() || null
  const hasStrictScope = Boolean(documentNames || ordinance)
  const levels: Array<{
    strategy: Exclude<MunicipalRetrievalStrategy, 'none'>
    filter_document_names: string[] | null
    filter_ordinance: string | null
  }> = hasStrictScope
    ? [
        { strategy: 'strict', filter_document_names: documentNames, filter_ordinance: ordinance },
        { strategy: 'document_scope', filter_document_names: documentNames, filter_ordinance: null },
        { strategy: 'municipal_scope', filter_document_names: null, filter_ordinance: null },
      ]
    : [{ strategy: 'municipal_scope', filter_document_names: null, filter_ordinance: null }]

  const result: MunicipalProgressiveRetrievalResult<T> = emptyResult<T>()
  for (const level of levels) {
    const rpcResult = await execute({
      query_embedding: input.query_embedding,
      match_count: input.match_count,
      filter_municipio_codigo: input.filter_municipio_codigo,
      filter_document_names: level.filter_document_names,
      filter_ordinance: level.filter_ordinance,
    })
    result.attemptCount += 1
    result.strategy = level.strategy
    if (rpcResult.error) {
      result.error = rpcResult.error
      result.fallbackUsed = result.attemptCount > 1
      return result
    }

    const data = Array.isArray(rpcResult.data) ? rpcResult.data : []
    if (level.strategy === 'strict') result.strictCandidateCount = data.length
    if (level.strategy === 'document_scope') result.documentScopeCandidateCount = data.length
    if (level.strategy === 'municipal_scope') result.broadCandidateCount = data.length

    if (data.length > 0) {
      result.data = data
      result.fallbackUsed = result.attemptCount > 1
      return result
    }
  }

  result.fallbackUsed = result.attemptCount > 1
  return result
}
