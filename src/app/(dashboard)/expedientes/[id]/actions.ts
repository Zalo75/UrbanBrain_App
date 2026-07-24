'use server'

import { createClient } from '@supabase/supabase-js'
import { getExpedienteAccess } from '@/application/authorization/expedienteAccess'
import { hasOrganizationPermission } from '@/application/authorization/organizationRoles'
import { db } from '@/infrastructure/db/client'
import { documents } from '@/infrastructure/db/schema'
import { expedienteStoragePrefix } from '@/infrastructure/supabase/deleteExpedienteStorageFiles'

const MAX_DOCUMENT_BYTES = 20 * 1024 * 1024

export async function prepareDocumentUpload(data: {
  expedienteId: string
  filename: string
  contentType: string
  size: number
}) {
  const access = await getExpedienteAccess(data.expedienteId)
  if (!access.ok || !hasOrganizationPermission(access.membershipRole, 'document.upload')) {
    throw new Error('Expediente not found or access denied')
  }
  if (data.contentType !== 'application/pdf' || data.size <= 0 || data.size > MAX_DOCUMENT_BYTES) {
    throw new Error('Invalid document')
  }

  const safeFilename = data.filename.replace(/[^a-zA-Z0-9._-]/g, '_').slice(-120) || 'documento.pdf'
  const storagePath = `organizations/${access.orgId}/expedientes/${data.expedienteId}/${crypto.randomUUID()}-${safeFilename}`
  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false, autoRefreshToken: false } }
  )
  const { data: signed, error } = await supabase.storage.from('expedientes').createSignedUploadUrl(storagePath)
  if (error || !signed?.token) throw new Error('Unable to prepare document upload')
  return { storagePath, token: signed.token }
}

export async function registerDocument(data: {
  expedienteId: string
  filename: string
  storagePath: string
  documentType: 'planeamiento' | 'normativa' | 'catalogo' | 'ficha' | 'informe' | 'consulta' | 'otros'
}) {
  const access = await getExpedienteAccess(data.expedienteId)
  if (!access.ok || !hasOrganizationPermission(access.membershipRole, 'document.upload')) {
    throw new Error('Expediente not found or access denied')
  }
  const expectedPrefix = expedienteStoragePrefix(access.orgId, data.expedienteId)
  if (!data.storagePath.startsWith(expectedPrefix)) {
    throw new Error('Expediente not found or access denied')
  }

  await db.insert(documents).values({
    expedienteId: data.expedienteId,
    filename: data.filename,
    storagePath: data.storagePath,
    documentType: data.documentType,
    uploadedBy: access.userId,
  })
  return { success: true }
}

export async function processDocumentAction(_documentId: string) {
  void _documentId
  return {
    success: false,
    error: 'PROCESSING_DISABLED',
    message: 'Procesamiento documental no disponible durante la beta privada.',
  }
}
