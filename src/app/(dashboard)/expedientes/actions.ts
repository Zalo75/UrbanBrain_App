'use server'

import { revalidatePath } from 'next/cache'
import { db } from '@/infrastructure/db/client'
import { expedientes, organizationMembers } from '@/infrastructure/db/schema'
import { eq, and } from 'drizzle-orm'
import { authProvider } from '@/infrastructure/auth'

async function checkAccess(expedienteId: string) {
  const userId = await authProvider.getUserId()
  if (!userId) return null

  const memberships = await db.select().from(organizationMembers).where(eq(organizationMembers.profileId, userId))
  if (memberships.length === 0) return null
  
  const orgId = memberships[0].orgId

  const [expediente] = await db
    .select()
    .from(expedientes)
    .where(and(eq(expedientes.id, expedienteId), eq(expedientes.orgId, orgId)))

  if (!expediente) return null

  return { userId, orgId, expediente }
}

export async function archiveExpediente(expedienteId: string) {
  const access = await checkAccess(expedienteId)
  if (!access) throw new Error('Unauthorized or not found')

  await db
    .update(expedientes)
    .set({ status: 'archived' })
    .where(eq(expedientes.id, expedienteId))

  revalidatePath('/dashboard')
  revalidatePath('/expedientes')
}

export async function updateExpediente(expedienteId: string, formData: FormData) {
  const access = await checkAccess(expedienteId)
  if (!access) throw new Error('Unauthorized or not found')

  const name = formData.get('name') as string
  const municipio = formData.get('municipio') as string
  const refCatastral = formData.get('refCatastral') as string | null

  if (!name || name.trim() === '') throw new Error('Name is required')
  if (!municipio || municipio.trim() === '') throw new Error('Municipio is required')

  await db
    .update(expedientes)
    .set({
      name: name.trim(),
      municipio: municipio.trim(),
      refCatastral: refCatastral ? refCatastral.trim() : null
    })
    .where(eq(expedientes.id, expedienteId))

  revalidatePath('/dashboard')
  revalidatePath('/expedientes')
  revalidatePath(`/expedientes/${expedienteId}`)
}
