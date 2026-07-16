'use server'

import { eq } from 'drizzle-orm'
import { revalidatePath } from 'next/cache'

import { getExpedienteAccess } from '@/application/authorization/expedienteAccess'
import { hasOrganizationPermission } from '@/application/authorization/organizationRoles'
import { db } from '@/infrastructure/db/client'
import { expedientes } from '@/infrastructure/db/schema'

export async function archiveExpediente(expedienteId: string) {
  const access = await getExpedienteAccess(expedienteId)
  if (!access.ok || !hasOrganizationPermission(access.membershipRole, 'expediente.archive')) {
    throw new Error('Expediente not found or access denied')
  }

  await db.update(expedientes).set({ status: 'archived' }).where(eq(expedientes.id, expedienteId))
  revalidatePath('/dashboard')
  revalidatePath('/expedientes')
}

export async function updateExpediente(expedienteId: string, formData: FormData) {
  const access = await getExpedienteAccess(expedienteId)
  if (!access.ok || !hasOrganizationPermission(access.membershipRole, 'expediente.edit')) {
    throw new Error('Expediente not found or access denied')
  }

  const name = formData.get('name') as string
  const municipio = formData.get('municipio') as string
  const refCatastral = formData.get('refCatastral') as string | null
  if (!name?.trim()) throw new Error('Name is required')
  if (!municipio?.trim()) throw new Error('Municipio is required')

  await db.update(expedientes).set({
    name: name.trim(),
    municipio: municipio.trim(),
    refCatastral: refCatastral?.trim() || null,
  }).where(eq(expedientes.id, expedienteId))

  revalidatePath('/dashboard')
  revalidatePath('/expedientes')
  revalidatePath(`/expedientes/${expedienteId}`)
}
