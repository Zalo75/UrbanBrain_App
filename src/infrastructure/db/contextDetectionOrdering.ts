import { desc, sql } from 'drizzle-orm'

import { contextDetections } from '@/infrastructure/db/schema'

export function latestContextDetectionOrder() {
  const attemptTime = sql`coalesce(
    ${contextDetections.summary} -> 'reliability' ->> 'latestAttemptAt',
    ${contextDetections.rawResponse} ->> 'attemptStartedAt',
    ${contextDetections.rawResponse} ->> 'resolvedAt',
    ${contextDetections.detectedAt}::text
  )`

  return [desc(sql`(${attemptTime})::timestamptz`), desc(contextDetections.detectedAt)] as const
}
