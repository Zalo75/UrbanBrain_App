export type MunicipalRetrievalStrategy =
  | 'strict'
  | 'document_scope'
  | 'municipal_scope'
  | 'none'

/** Outcome of the retrieval ladder, kept separate from the selected strategy. */
export type MunicipalRetrievalStatus =
  | 'NONE'
  | 'MATCHES'
  | 'NO_MATCHES'
  | 'TIMEOUT'
  | 'ERROR'
  | 'NON_SPECIFIC_EVIDENCE'

export type MunicipalEvidenceSpecificity = 'NONE' | 'SPECIFIC' | 'NON_SPECIFIC'

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
  /** Keep an ordinance-scoped retry from degrading into anonymous document evidence. */
  allowDocumentScopeFallback?: boolean
  retrieveMunicipal: boolean
  hasMunicipalCorpus?: boolean | ((municipioCodigo: string) => Promise<{ exists: boolean; error?: unknown | null }>)
}

export interface MunicipalProgressiveRetrievalResult<T> {
  data: T[]
  error: unknown | null
  strategy: MunicipalRetrievalStrategy
  status: MunicipalRetrievalStatus
  /** Result of the most restrictive (ordinance-specific) attempt. */
  specificStatus: Exclude<MunicipalRetrievalStatus, 'NON_SPECIFIC_EVIDENCE'>
  evidenceSpecificity: MunicipalEvidenceSpecificity
  failedStrategy: MunicipalRetrievalStrategy
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
    status: 'NONE',
    specificStatus: 'NONE',
    evidenceSpecificity: 'NONE',
    failedStrategy: 'none',
    attemptCount: 0,
    strictCandidateCount: 0,
    documentScopeCandidateCount: 0,
    broadCandidateCount: 0,
    fallbackUsed: false,
  }
}

function isTimeoutError(error: unknown) {
  if (!error || typeof error !== 'object') return false
  const candidate = error as { code?: unknown; name?: unknown; message?: unknown }
  return candidate.code === '57014' ||
    candidate.name === 'AbortError' ||
    (typeof candidate.message === 'string' && /(?:statement )?timeout|timed out/i.test(candidate.message))
}

export async function retrieveMunicipalProgressively<T>(
  input: MunicipalProgressiveRetrievalInput,
  execute: (args: MunicipalRetrievalRpcArgs) => Promise<RpcResult<T>>,
  executeDocumentScoped?: (args: MunicipalRetrievalRpcArgs) => Promise<RpcResult<unknown>>
): Promise<MunicipalProgressiveRetrievalResult<T>> {
  if (!input.retrieveMunicipal) return emptyResult<T>()

  if (input.hasMunicipalCorpus === false) {
    return emptyResult<T>()
  }

  if (typeof input.hasMunicipalCorpus === 'function') {
    const check = await input.hasMunicipalCorpus(input.filter_municipio_codigo)
    if (check.error) {
      return {
        ...emptyResult<T>(),
        error: check.error,
      }
    }
    if (!check.exists) {
      return emptyResult<T>()
    }
  }

  const documentNames = input.filter_document_names?.length
    ? [...input.filter_document_names]
    : null
  const ordinance = input.filter_ordinance?.trim() || null
  const allowDocumentScopeFallback = input.allowDocumentScopeFallback !== false
  const levels: Array<{
    strategy: Exclude<MunicipalRetrievalStrategy, 'none'>
    filter_document_names: string[] | null
    filter_ordinance: string | null
  }> = ordinance
    ? [
        { strategy: 'strict', filter_document_names: documentNames, filter_ordinance: ordinance },
        ...(documentNames && allowDocumentScopeFallback
          ? [{ strategy: 'document_scope' as const, filter_document_names: documentNames, filter_ordinance: null }]
          : []),
      ]
    : documentNames
      ? [{ strategy: 'document_scope', filter_document_names: documentNames, filter_ordinance: null }]
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
      result.failedStrategy = level.strategy
      result.status = isTimeoutError(rpcResult.error) ? 'TIMEOUT' : 'ERROR'
      if (level.strategy === 'strict') result.specificStatus = result.status
      if (
        level.strategy === 'strict' &&
        isTimeoutError(rpcResult.error) &&
        documentNames &&
        executeDocumentScoped
      ) {
        const scopedResult = await executeDocumentScoped({
          query_embedding: input.query_embedding,
          match_count: input.match_count,
          filter_municipio_codigo: input.filter_municipio_codigo,
          filter_document_names: documentNames,
          filter_ordinance: ordinance,
        })
        if (!scopedResult.error && Array.isArray(scopedResult.data) && scopedResult.data.length > 0) {
          result.data = scopedResult.data as T[]
          result.error = null
          result.strategy = 'document_scope'
          result.status = 'MATCHES'
          result.evidenceSpecificity = 'SPECIFIC'
          result.documentScopeCandidateCount = scopedResult.data.length
          result.fallbackUsed = true
          return result
        }
      }
      // Never turn an unavailable specific query into silently broader evidence.
      return result
    }

    const data = Array.isArray(rpcResult.data) ? rpcResult.data : []
    if (level.strategy === 'strict') result.strictCandidateCount = data.length
    if (level.strategy === 'document_scope') result.documentScopeCandidateCount = data.length
    if (level.strategy === 'municipal_scope') result.broadCandidateCount = data.length

    if (data.length > 0) {
      result.data = data
      result.error = null
      if (level.strategy === 'strict') {
        result.status = 'MATCHES'
        result.specificStatus = 'MATCHES'
        result.evidenceSpecificity = 'SPECIFIC'
      } else if (ordinance && level.strategy === 'document_scope') {
        result.status = 'NON_SPECIFIC_EVIDENCE'
        result.specificStatus = 'NO_MATCHES'
        result.evidenceSpecificity = 'NON_SPECIFIC'
      } else {
        result.status = 'MATCHES'
        result.specificStatus = documentNames ? 'MATCHES' : 'NONE'
        result.evidenceSpecificity = 'SPECIFIC'
      }
      result.fallbackUsed = result.status === 'NON_SPECIFIC_EVIDENCE'
      return result
    }

    if (level.strategy === 'strict') result.specificStatus = 'NO_MATCHES'

    // A document-scoped miss is not permission to search the whole municipal
    // corpus: doing so would lose the canonical instrument/document scope.
    if (level.strategy === 'document_scope') {
      result.status = 'NO_MATCHES'
      result.evidenceSpecificity = 'NONE'
      result.fallbackUsed = result.attemptCount > 1
      return result
    }
  }

  result.fallbackUsed = result.attemptCount > 1
  result.status = result.specificStatus === 'NO_MATCHES' ? 'NO_MATCHES' : 'NONE'
  return result
}
