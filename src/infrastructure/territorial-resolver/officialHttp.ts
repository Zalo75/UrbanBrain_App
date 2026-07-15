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
  const maxRetries = Math.max(0, Math.min(policy.maxRetries ?? 1, 2));
  const baseDelayMs = Math.max(0, policy.baseDelayMs ?? 150);

  for (let attempt = 0; attempt <= maxRetries; attempt += 1) {
    let response: Response;
    try {
      response = await fetcher(url, { ...init, signal: AbortSignal.timeout(timeoutMs) });
    } catch (error) {
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
