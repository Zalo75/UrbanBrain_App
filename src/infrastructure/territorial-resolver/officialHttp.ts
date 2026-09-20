export type FetchLike = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

export interface OfficialRequestPolicy {
  maxRetries?: number;
  baseDelayMs?: number;
}

export class OfficialServiceError extends Error {
  constructor(
    public readonly service: string,
    public readonly kind: 'timeout' | 'http' | 'malformed' | 'unavailable',
    message: string
  ) {
    super(message);
    this.name = 'OfficialServiceError';
  }
}

export function officialFailureKind(error: unknown): OfficialServiceError['kind'] {
  return error instanceof OfficialServiceError ? error.kind : 'unavailable';
}

export function isExternalServiceFailure(error: unknown): boolean {
  if (!error) return false;
  if (error instanceof OfficialServiceError) return true;
  if (error instanceof Error) {
    if (error.name === 'TimeoutError' || error.name === 'AbortError' || error.name === 'FetchError') {
      return true;
    }
    const code = (error as { code?: unknown }).code;
    if (typeof code === 'string' && ['UND_ERR_SOCKET', 'ECONNREFUSED', 'ECONNRESET', 'ETIMEDOUT', 'ENOTFOUND', 'EAI_AGAIN'].includes(code)) {
      return true;
    }
    const cause = (error as { cause?: unknown }).cause;
    if (cause && isExternalServiceFailure(cause)) {
      return true;
    }
    if (error instanceof TypeError && error.message === 'fetch failed') {
      return true;
    }
  }
  return false;
}

const RETRYABLE_HTTP_STATUSES = new Set([408, 425, 429, 500, 502, 503, 504]);

function timeoutFailure(error: unknown) {
  return error instanceof Error && (error.name === 'TimeoutError' || error.name === 'AbortError');
}

function wait(ms: number) {
  return ms > 0 ? new Promise((resolve) => setTimeout(resolve, ms)) : Promise.resolve();
}

export async function fetchOfficial(
  fetcher: FetchLike,
  service: string,
  url: URL,
  timeoutMs: number,
  init: RequestInit = {},
  policy: OfficialRequestPolicy = {}
) {
  const startedAt = Date.now();
  const safeUrl = `${url.origin}${url.pathname}`;
  const maxRetries = Math.max(0, Math.min(policy.maxRetries ?? 1, 2));
  const baseDelayMs = Math.max(0, policy.baseDelayMs ?? 150);

  for (let attempt = 0; attempt <= maxRetries; attempt += 1) {
    let response: Response;
    try {
      response = await fetcher(url, { ...init, signal: init.signal ? AbortSignal.any([init.signal, AbortSignal.timeout(timeoutMs)]) : AbortSignal.timeout(timeoutMs) });
    } catch (error) {
      init.signal?.throwIfAborted();
      console.log('UB-DIAG external', JSON.stringify({ service, url: safeUrl, attempt: attempt + 1, phase: 'fetch', status: 'error', durationMs: Date.now() - startedAt, error: error instanceof Error ? error.name : 'unknown' }));
      if (attempt < maxRetries) {
        await wait(baseDelayMs * 2 ** attempt);
        continue;
      }
      throw new OfficialServiceError(
        service,
        timeoutFailure(error) ? 'timeout' : 'unavailable',
        `${service} no está disponible temporalmente.`
      );
    }

    console.log('UB-DIAG external', JSON.stringify({ service, url: safeUrl, attempt: attempt + 1, phase: 'response', status: response.status, durationMs: Date.now() - startedAt }));
    if (response.ok) return response;
    if (RETRYABLE_HTTP_STATUSES.has(response.status) && attempt < maxRetries) {
      await response.body?.cancel();
      await wait(baseDelayMs * 2 ** attempt);
      continue;
    }
    throw new OfficialServiceError(
      service,
      'http',
      `${service} respondió HTTP ${response.status}.`
    );
  }

  throw new OfficialServiceError(
    service,
    'unavailable',
    `${service} no está disponible temporalmente.`
  );
}
