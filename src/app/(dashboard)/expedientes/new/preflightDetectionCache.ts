import { randomUUID } from 'node:crypto'

import type { PreflightDetection } from './smartCaseDetection'

const MAX_AGE_MS = 15 * 60 * 1000
const MAX_ENTRIES = 200

interface CachedDetection {
  userId: string
  createdAt: number
  detection: PreflightDetection
}

const cache = new Map<string, CachedDetection>()

function purgeExpired(now = Date.now()) {
  for (const [id, entry] of cache) {
    if (now - entry.createdAt > MAX_AGE_MS) cache.delete(id)
  }
  while (cache.size > MAX_ENTRIES) {
    const first = cache.keys().next().value
    if (!first) break
    cache.delete(first)
  }
}

export function storePreflightDetection(userId: string, detection: PreflightDetection) {
  purgeExpired()
  const id = randomUUID()
  cache.set(id, { userId, createdAt: Date.now(), detection })
  return id
}

export function getPreflightDetection(userId: string, id: string | null | undefined) {
  purgeExpired()
  if (!id) return null
  const entry = cache.get(id)
  return entry?.userId === userId ? entry.detection : null
}
