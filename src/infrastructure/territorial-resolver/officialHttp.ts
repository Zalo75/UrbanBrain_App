export type FetchLike = (input: string | URL | Request, init?: RequestInit) => Promise<Response>

export class OfficialServiceError extends Error {
  constructor(
    public readonly service: string,
    public readonly kind: 'timeout' | 'http' | 'malformed' | 'unavailable',
    message: string
  ) {
    super(message)
    this.name = 'OfficialServiceError'
  }
}

export function officialFailureKind(error: unknown): OfficialServiceError['kind'] {
  return error instanceof OfficialServiceError ? error.kind : 'unavailable'
}

export async function fetchOfficial(
  fetcher: FetchLike,
  service: string,
  url: URL,
  timeoutMs: number,
  init: RequestInit = {}
) {
  let response: Response
  try {
    response = await fetcher(url, { ...init, signal: AbortSignal.timeout(timeoutMs) })
  } catch (error) {
    const isTimeout =
      error instanceof Error && (error.name === 'TimeoutError' || error.name === 'AbortError')
    throw new OfficialServiceError(
      service,
      isTimeout ? 'timeout' : 'unavailable',
      `${service} no está disponible temporalmente.`
    )
  }
  if (!response.ok) {
    throw new OfficialServiceError(service, 'http', `${service} respondió HTTP ${response.status}.`)
  }
  return response
}
