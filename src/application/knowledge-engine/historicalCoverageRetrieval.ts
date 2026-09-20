import type { HistoricalTaxonomyBridgeResult } from './historicalTaxonomyBridge'

export function buildHistoricalCoverageQueries(
  question: string,
  bridge: HistoricalTaxonomyBridgeResult,
  maxQueries = 5,
) {
  const terms = bridge.originalPlanSearchTerms
  if (terms.length === 0) return [question]

  const queries = [question]
  for (const term of terms) {
    queries.push(`${question}\n\nTérmino original del instrumento: ${term}`)
    if (queries.length >= maxQueries) break
  }
  return queries
}

export function mergeHistoricalCoverageResults<T extends { chunk_id: string | number }>(
  resultSets: readonly (readonly T[])[],
  maxResults = 48,
) {
  const byChunk = new Map<string, T>()
  for (const resultSet of resultSets) {
    for (const result of resultSet) {
      const key = String(result.chunk_id)
      const existing = byChunk.get(key) as (T & { similarity?: number }) | undefined
      const candidate = result as T & { similarity?: number }
      if (!existing || (candidate.similarity ?? -Infinity) > (existing.similarity ?? -Infinity)) {
        byChunk.set(key, result)
      }
    }
  }
  return [...byChunk.values()].slice(0, maxResults)
}
