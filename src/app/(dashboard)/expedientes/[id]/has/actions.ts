'use server'

import { getExpedienteAccess } from '@/application/authorization/expedienteAccess'
import { appendHasAlignment } from '@/infrastructure/db/hasAlignmentRepository'

export async function persistHasAlignment(input: any) {
  const access = await getExpedienteAccess(input?.expedienteId)
  if (!access.ok || typeof input?.cadastralReference !== 'string' || input.crs !== 'EPSG:4326' || !input.historicalViewId || !input.modernViewId || !input.transform || !input.bbox || !input.nativeDimensions) throw new Error('Invalid HAS alignment')
  return appendHasAlignment(input)
}
