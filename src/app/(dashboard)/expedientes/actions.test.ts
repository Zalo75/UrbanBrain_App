import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  getExpedienteAccess: vi.fn(), update: vi.fn(), set: vi.fn(), where: vi.fn(), revalidatePath: vi.fn(),
  deleteExpedientePermanently: vi.fn(),
}))
vi.mock('@/application/authorization/expedienteAccess', () => ({ getExpedienteAccess: mocks.getExpedienteAccess }))
vi.mock('@/application/expedientes/deleteExpediente', () => ({ deleteExpedientePermanently: mocks.deleteExpedientePermanently }))
vi.mock('@/infrastructure/db/client', () => ({ db: { update: mocks.update } }))
vi.mock('next/cache', () => ({ revalidatePath: mocks.revalidatePath }))

import { archiveExpediente, deleteExpediente, updateExpediente } from './actions'

function access(role: 'owner' | 'admin' | 'member' | 'viewer') {
  return { ok: true as const, userId: 'user-a', orgId: 'org-a', membershipRole: role, expediente: { id: 'exp-a', orgId: 'org-a', ownerId: 'user-a' } }
}

describe('expediente mutation roles', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.update.mockReturnValue({ set: mocks.set })
    mocks.set.mockReturnValue({ where: mocks.where })
    mocks.where.mockResolvedValue(undefined)
    mocks.deleteExpedientePermanently.mockResolvedValue(undefined)
  })

  it('denies edit and archive to viewers before any write', async () => {
    mocks.getExpedienteAccess.mockResolvedValue(access('viewer'))
    const form = new FormData()
    form.set('name', 'Proyecto')
    form.set('municipio', 'Betanzos')
    await expect(updateExpediente('exp-a', form)).rejects.toThrow('access denied')
    await expect(archiveExpediente('exp-a')).rejects.toThrow('access denied')
    expect(mocks.update).not.toHaveBeenCalled()
  })

  it('allows a member to edit but not archive', async () => {
    mocks.getExpedienteAccess.mockResolvedValue(access('member'))
    const form = new FormData()
    form.set('name', 'Proyecto')
    form.set('municipio', 'Betanzos')
    await updateExpediente('exp-a', form)
    expect(mocks.update).toHaveBeenCalledOnce()
    mocks.update.mockClear()
    await expect(archiveExpediente('exp-a')).rejects.toThrow('access denied')
    expect(mocks.update).not.toHaveBeenCalled()
  })

  it.each(['owner', 'admin'] as const)('allows %s to archive', async (role) => {
    mocks.getExpedienteAccess.mockResolvedValue(access(role))
    await archiveExpediente('exp-a')
    expect(mocks.update).toHaveBeenCalledOnce()
  })

  it.each(['owner', 'admin', 'member', 'viewer'] as const)('allows the individual owner to permanently delete its expediente regardless of organization role %s', async (role) => {
    mocks.getExpedienteAccess.mockResolvedValue(access(role))

    await expect(deleteExpediente('exp-a')).resolves.toEqual({ success: true })
    expect(mocks.deleteExpedientePermanently).toHaveBeenCalledWith({
      expedienteId: 'exp-a',
      orgId: 'org-a',
      ownerId: 'user-a',
    })
  })

  it('does not reveal or delete an expediente from another organization', async () => {
    mocks.getExpedienteAccess.mockResolvedValue({ ok: false, reason: 'not_found_or_forbidden' })

    await expect(deleteExpediente('exp-b')).resolves.toMatchObject({ success: false })
    expect(mocks.deleteExpedientePermanently).not.toHaveBeenCalled()
  })

  it('returns a clear error and does not revalidate when deletion fails', async () => {
    mocks.getExpedienteAccess.mockResolvedValue(access('owner'))
    mocks.deleteExpedientePermanently.mockRejectedValue(new Error('storage failure'))

    await expect(deleteExpediente('exp-a')).resolves.toEqual({
      success: false,
      error: 'No se ha podido completar la eliminación. El expediente no se ha eliminado.',
    })
    expect(mocks.revalidatePath).not.toHaveBeenCalled()
  })
})
