import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  getExpedienteAccess: vi.fn(), update: vi.fn(), set: vi.fn(), where: vi.fn(), revalidatePath: vi.fn(),
}))
vi.mock('@/application/authorization/expedienteAccess', () => ({ getExpedienteAccess: mocks.getExpedienteAccess }))
vi.mock('@/infrastructure/db/client', () => ({ db: { update: mocks.update } }))
vi.mock('next/cache', () => ({ revalidatePath: mocks.revalidatePath }))

import { archiveExpediente, updateExpediente } from './actions'

function access(role: 'owner' | 'admin' | 'member' | 'viewer') {
  return { ok: true as const, userId: 'user-a', orgId: 'org-a', membershipRole: role, expediente: { id: 'exp-a', orgId: 'org-a' } }
}

describe('expediente mutation roles', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.update.mockReturnValue({ set: mocks.set })
    mocks.set.mockReturnValue({ where: mocks.where })
    mocks.where.mockResolvedValue(undefined)
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
})
