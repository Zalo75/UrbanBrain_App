import { and, desc, eq } from 'drizzle-orm'
import { db } from './client'
import { hasAlignments } from './schema'

export type HasAlignmentInput = {
  expedienteId: string
  cadastralReference: string
  historicalViewId: string
  historicalProvenance: unknown
  modernViewId: string
  modernProvenance: unknown
  bbox: unknown
  crs: string
  transform: unknown
  nativeDimensions: unknown
}

export function isCompatibleHasAlignment(row: Pick<HasAlignmentInput, 'expedienteId' | 'cadastralReference' | 'historicalViewId' | 'modernViewId' | 'crs'>, input: Pick<HasAlignmentInput, 'expedienteId' | 'cadastralReference' | 'historicalViewId' | 'modernViewId' | 'crs'>) {
  return row.expedienteId === input.expedienteId && row.cadastralReference === input.cadastralReference && row.historicalViewId === input.historicalViewId && row.modernViewId === input.modernViewId && row.crs === input.crs
}

export async function appendHasAlignment(input: HasAlignmentInput) {
  const [row] = await db.insert(hasAlignments).values(input).returning()
  return row
}

export async function getLatestCompatibleHasAlignment(input: { expedienteId: string; cadastralReference: string; historicalViewId: string; modernViewId: string; crs: string }) {
  const [row] = await db.select().from(hasAlignments).where(and(
    eq(hasAlignments.expedienteId, input.expedienteId),
    eq(hasAlignments.cadastralReference, input.cadastralReference),
    eq(hasAlignments.historicalViewId, input.historicalViewId),
    eq(hasAlignments.modernViewId, input.modernViewId),
    eq(hasAlignments.crs, input.crs),
    eq(hasAlignments.status, 'approved'),
  )).orderBy(desc(hasAlignments.createdAt)).limit(1)
  return row ?? null
}
