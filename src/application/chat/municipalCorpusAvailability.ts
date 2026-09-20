export interface MunicipalCorpusCheckResult {
  exists: boolean
  error: unknown | null
}

const corpusAvailabilityCache = new Map<string, boolean>()

/**
 * Checks whether a municipality has an available normative corpus before
 * initiating expensive vector/HNSW scans.
 * Caches positive and negative results in memory to eliminate repeated checks.
 */
export async function checkMunicipalCorpusAvailability(
  municipioCodigo: string | null | undefined,
  checker: (codigo: string) => Promise<MunicipalCorpusCheckResult>
): Promise<MunicipalCorpusCheckResult> {
  if (!municipioCodigo || !municipioCodigo.trim()) {
    return { exists: false, error: null }
  }

  const normalized = municipioCodigo.trim()
  if (corpusAvailabilityCache.has(normalized)) {
    return { exists: corpusAvailabilityCache.get(normalized)!, error: null }
  }

  const result = await checker(normalized)
  if (result.error) {
    return { exists: false, error: result.error }
  }

  corpusAvailabilityCache.set(normalized, result.exists)
  return { exists: result.exists, error: null }
}

/**
 * Resets the in-memory cache (primarily for tests).
 */
export function clearMunicipalCorpusAvailabilityCache(): void {
  corpusAvailabilityCache.clear()
}
