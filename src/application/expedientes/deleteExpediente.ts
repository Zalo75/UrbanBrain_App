import { and, eq, inArray } from 'drizzle-orm'

import { db } from '@/infrastructure/db/client'
import {
  adminAuditEvents,
  chatMessages,
  contextDetections,
  conversations,
  documentChunks,
  documents,
  expedienteAfecciones,
  expedienteNormativeContext,
  expedientes,
  messages,
  messageSources,
} from '@/infrastructure/db/schema'
import { deleteExpedienteStorageFiles } from '@/infrastructure/supabase/deleteExpedienteStorageFiles'

interface DeleteExpedienteInput {
  expedienteId: string
  orgId: string
  ownerId: string
}

export async function deleteExpedientePermanently(
  input: DeleteExpedienteInput,
  dependencies: {
    database?: typeof db
    deleteStorageFiles?: typeof deleteExpedienteStorageFiles
  } = {}
) {
  const database = dependencies.database ?? db
  const deleteStorageFiles = dependencies.deleteStorageFiles ?? deleteExpedienteStorageFiles

  await database.transaction(async (tx) => {
    const lockedExpediente = await tx
      .select({ id: expedientes.id })
      .from(expedientes)
      .where(and(eq(expedientes.id, input.expedienteId), eq(expedientes.ownerId, input.ownerId)))
      .for('update')
      .limit(1)
    if (!lockedExpediente.length) throw new Error('Expediente is not available for deletion')

    const [documentRows, conversationRows] = await Promise.all([
      tx
        .select({ id: documents.id, storagePath: documents.storagePath })
        .from(documents)
        .where(eq(documents.expedienteId, input.expedienteId)),
      tx
        .select({ id: conversations.id })
        .from(conversations)
        .where(eq(conversations.expedienteId, input.expedienteId)),
    ])

    await deleteStorageFiles({
      orgId: input.orgId,
      expedienteId: input.expedienteId,
      registeredPaths: documentRows.map((document) => document.storagePath),
    })

    const conversationIds = conversationRows.map((conversation) => conversation.id)
    if (conversationIds.length) {
      const messageRows = await tx
        .select({ id: messages.id })
        .from(messages)
        .where(inArray(messages.conversationId, conversationIds))
      const messageIds = messageRows.map((message) => message.id)
      if (messageIds.length) {
        await tx.delete(messageSources).where(inArray(messageSources.messageId, messageIds))
        await tx.delete(messages).where(inArray(messages.id, messageIds))
      }
      await tx.delete(conversations).where(inArray(conversations.id, conversationIds))
    }

    await tx.delete(documentChunks).where(eq(documentChunks.expedienteId, input.expedienteId))
    await tx.delete(documents).where(eq(documents.expedienteId, input.expedienteId))
    await tx.delete(chatMessages).where(eq(chatMessages.expedienteId, input.expedienteId))
    await tx.delete(expedienteAfecciones).where(eq(expedienteAfecciones.expedienteId, input.expedienteId))
    await tx.delete(contextDetections).where(eq(contextDetections.expedienteId, input.expedienteId))
    await tx
      .delete(expedienteNormativeContext)
      .where(eq(expedienteNormativeContext.expedienteId, input.expedienteId))

    await tx.insert(adminAuditEvents).values({
      actorProfileId: input.ownerId,
      action: 'expediente_deleted',
      resourceType: 'expediente',
      resourceId: input.expedienteId,
      organizationId: input.orgId,
      result: 'success',
      metadata: {},
    })

    const deleted = await tx
      .delete(expedientes)
      .where(and(eq(expedientes.id, input.expedienteId), eq(expedientes.ownerId, input.ownerId)))
      .returning({ id: expedientes.id })
    if (deleted.length !== 1) throw new Error('Expediente deletion was not completed')
  })
}
