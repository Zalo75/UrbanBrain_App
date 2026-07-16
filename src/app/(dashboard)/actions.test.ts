import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ logout: vi.fn(), revalidatePath: vi.fn(), redirect: vi.fn() }))
vi.mock('@/infrastructure/auth', () => ({ authProvider: { logout: mocks.logout } }))
vi.mock('next/cache', () => ({ revalidatePath: mocks.revalidatePath }))
vi.mock('next/navigation', () => ({ redirect: mocks.redirect }))

import { logout } from './actions'

describe('logout action', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.redirect.mockImplementation((url: string) => { throw new Error(`NEXT_REDIRECT:${url}`) })
  })

  it('invalidates the session and redirects to login', async () => {
    mocks.logout.mockResolvedValue({ error: null })
    await expect(logout()).rejects.toThrow('NEXT_REDIRECT:/login?message=signed_out')
    expect(mocks.logout).toHaveBeenCalledOnce()
    expect(mocks.revalidatePath).toHaveBeenCalledWith('/', 'layout')
  })

  it('shows a safe login error when invalidation fails', async () => {
    mocks.logout.mockResolvedValue({ error: 'provider detail' })
    await expect(logout()).rejects.toThrow('NEXT_REDIRECT:/login?message=logout_failed')
    expect(mocks.revalidatePath).not.toHaveBeenCalled()
  })
})
