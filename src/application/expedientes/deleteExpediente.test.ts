import { describe, expect, it, vi } from 'vitest'

vi.mock('@/infrastructure/db/client', () => ({ db: {} }))

import { deleteExpedientePermanently } from './deleteExpediente'
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
import type { db } from '@/infrastructure/db/client'

function queryResult<T>(rows: T[]) {
  const promise = Promise.resolve(rows)
  const chain = {
    where: () => chain,
    for: () => chain,
    limit: () => promise,
    then: promise.then.bind(promise),
  }
  return chain
}

function deletionDatabase() {
  const deletedTables: unknown[] = []
  const auditValues: unknown[] = []
  const rows = new Map<unknown, unknown[]>([
    [expedientes, [{ id: 'exp-a' }]],
    [documents, [{ id: 'doc-a', storagePath: 'organizations/org-a/expedientes/exp-a/doc-a.pdf' }]],
    [conversations, [{ id: 'conversation-a' }]],
    [messages, [{ id: 'message-a' }]],
  ])
  const tx = {
    select: vi.fn(() => ({
      from: (table: unknown) => queryResult(rows.get(table) ?? []),
    })),
    delete: vi.fn((table: unknown) => {
      deletedTables.push(table)
      const promise = Promise.resolve(undefined)
      return {
        where: () => ({
          returning: async () => table === expedientes ? [{ id: 'exp-a' }] : [],
          then: promise.then.bind(promise),
        }),
      }
    }),
    insert: vi.fn((table: unknown) => ({
      values: async (values: unknown) => {
        if (table === adminAuditEvents) auditValues.push(values)
      },
    })),
  }
  const database = {
    transaction: vi.fn(async (callback: (transaction: typeof tx) => Promise<void>) => callback(tx)),
  } as unknown as typeof db
  return { database, deletedTables, auditValues }
}

describe('permanent expediente deletion', () => {
  it('removes only the target expediente graph and appends the minimal audit event', async () => {
    const { database, deletedTables, auditValues } = deletionDatabase()
    const deleteStorageFiles = vi.fn().mockResolvedValue(undefined)

    await deleteExpedientePermanently(
      { expedienteId: 'exp-a', orgId: 'org-a', ownerId: 'user-a' },
      { database, deleteStorageFiles }
    )

    expect(deleteStorageFiles).toHaveBeenCalledWith({
      orgId: 'org-a',
      expedienteId: 'exp-a',
      registeredPaths: ['organizations/org-a/expedientes/exp-a/doc-a.pdf'],
    })
    expect(deletedTables).toEqual(expect.arrayContaining([
      messageSources,
      messages,
      conversations,
      documentChunks,
      documents,
      chatMessages,
      expedienteAfecciones,
      contextDetections,
      expedienteNormativeContext,
      expedientes,
    ]))
    expect(auditValues).toEqual([
      expect.objectContaining({
        actorProfileId: 'user-a',
        action: 'expediente_deleted',
        resourceId: 'exp-a',
        organizationId: 'org-a',
        result: 'success',
        metadata: {},
      }),
    ])
  })

  it('propagates a storage failure so the database transaction cannot commit', async () => {
    const { database, deletedTables, auditValues } = deletionDatabase()

    await expect(deleteExpedientePermanently(
      { expedienteId: 'exp-a', orgId: 'org-a', ownerId: 'user-a' },
      {
        database,
        deleteStorageFiles: vi.fn().mockRejectedValue(new Error('storage unavailable')),
      }
    )).rejects.toThrow('storage unavailable')

    expect(deletedTables).toEqual([])
    expect(auditValues).toEqual([])
  })
})
