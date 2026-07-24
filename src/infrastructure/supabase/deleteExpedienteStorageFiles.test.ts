import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  from: vi.fn(),
  list: vi.fn(),
  remove: vi.fn(),
}))

vi.mock('@supabase/supabase-js', () => ({
  createClient: () => ({ storage: { from: mocks.from } }),
}))

import { deleteExpedienteStorageFiles } from './deleteExpedienteStorageFiles'

describe('expediente storage deletion', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'https://project.supabase.co')
    vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', 'service-role-test')
    mocks.from.mockReturnValue({ list: mocks.list, remove: mocks.remove })
    mocks.list.mockResolvedValue({ data: [{ name: 'unregistered.pdf' }], error: null })
    mocks.remove.mockResolvedValue({ data: [], error: null })
  })

  it('removes registered and discovered files under the exact expediente prefix', async () => {
    await deleteExpedienteStorageFiles({
      orgId: 'org-a',
      expedienteId: 'exp-a',
      registeredPaths: ['organizations/org-a/expedientes/exp-a/registered.pdf'],
    })

    expect(mocks.from).toHaveBeenCalledWith('expedientes')
    expect(mocks.list).toHaveBeenCalledWith('organizations/org-a/expedientes/exp-a', expect.any(Object))
    expect(mocks.remove).toHaveBeenCalledWith([
      'organizations/org-a/expedientes/exp-a/registered.pdf',
      'organizations/org-a/expedientes/exp-a/unregistered.pdf',
    ])
  })

  it('fails closed rather than deleting a registered path from another expediente', async () => {
    await expect(deleteExpedienteStorageFiles({
      orgId: 'org-a',
      expedienteId: 'exp-a',
      registeredPaths: ['organizations/org-a/expedientes/exp-b/must-survive.pdf'],
    })).rejects.toThrow('outside the expediente storage scope')

    expect(mocks.list).not.toHaveBeenCalled()
    expect(mocks.remove).not.toHaveBeenCalled()
  })

  it('fails closed when Storage cannot be inspected', async () => {
    mocks.list.mockResolvedValue({ data: null, error: { message: 'unavailable' } })

    await expect(deleteExpedienteStorageFiles({
      orgId: 'org-a',
      expedienteId: 'exp-a',
      registeredPaths: [],
    })).rejects.toThrow('Unable to inspect expediente storage')
    expect(mocks.remove).not.toHaveBeenCalled()
  })
})
