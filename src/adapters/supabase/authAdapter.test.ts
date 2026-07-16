import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ createServerClient: vi.fn(), signOut: vi.fn(), getAll: vi.fn(), set: vi.fn() }))
vi.mock('@supabase/ssr', () => ({ createServerClient: mocks.createServerClient }))
vi.mock('next/headers', () => ({ cookies: vi.fn(async () => ({ getAll: mocks.getAll, set: mocks.set })) }))

import { SupabaseAuthAdapter } from './authAdapter'

describe('SupabaseAuthAdapter logout', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.createServerClient.mockReturnValue({ auth: { signOut: mocks.signOut } })
  })

  it('invalidates the Supabase session', async () => {
    mocks.signOut.mockResolvedValue({ error: null })
    await expect(new SupabaseAuthAdapter().logout()).resolves.toEqual({ error: null })
    expect(mocks.signOut).toHaveBeenCalledOnce()
  })

  it('returns a provider failure without exposing it in the UI', async () => {
    mocks.signOut.mockResolvedValue({ error: { message: 'provider failure' } })
    await expect(new SupabaseAuthAdapter().logout()).resolves.toEqual({ error: 'provider failure' })
  })
})
