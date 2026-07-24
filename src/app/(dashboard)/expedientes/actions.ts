'use server'

import { and, eq } from 'drizzle-orm'
import { revalidatePath } from 'next/cache'

import { getExpedienteAccess } from '@/application/authorization/expedienteAccess'
import { hasOrganizationPermission } from '@/application/authorization/organizationRoles'
import { db } from '@/infrastructure/db/client'
import { expedientes } from '@/infrastructure/db/schema'
import { deleteExpedientePermanently } from '@/application/expedientes/deleteExpediente'

export type DeleteExpedienteResult =
  | { success: true }
  | { success: false; error: string }

export async function archiveExpediente(expedienteId: string) {
  const access = await getExpedienteAccess(expedienteId)
  if (!access.ok || !hasOrganizationPermission(access.membershipRole, 'expediente.archive')) {
    throw new Error('Expediente not found or access denied')
  }

  await db
    .update(expedientes)
    .set({ status: 'archived' })
    .where(and(eq(expedientes.id, expedienteId), eq(expedientes.ownerId, access.userId)))
  revalidatePath('/dashboard')
  revalidatePath('/expedientes')
}

export async function deleteExpediente(expedienteId: string): Promise<DeleteExpedienteResult> {
  const access = await getExpedienteAccess(expedienteId)
  if (!access.ok) {
    return {
      success: false,
      error: 'No se ha podido eliminar el expediente. Compruebe sus permisos e inténtelo de nuevo.',
    }
  }

  try {
    await deleteExpedientePermanently({
      expedienteId,
      orgId: access.orgId,
      ownerId: access.userId,
    })
  } catch {
    return {
      success: false,
      error: 'No se ha podido completar la eliminación. El expediente no se ha eliminado.',
    }
  }

  revalidatePath('/dashboard')
  revalidatePath('/expedientes')
  return { success: true }
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
  }).where(and(eq(expedientes.id, expedienteId), eq(expedientes.ownerId, access.userId)))

  revalidatePath('/dashboard')
  revalidatePath('/expedientes')
  revalidatePath(`/expedientes/${expedienteId}`)
}
