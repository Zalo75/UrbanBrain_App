import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  getUserId: vi.fn(),
  select: vi.fn(),
  from: vi.fn(),
  where: vi.fn(),
  redirect: vi.fn(),
}))

vi.mock('@/infrastructure/auth', () => ({
  authProvider: { getUserId: mocks.getUserId },
}))
vi.mock('@/infrastructure/db/client', () => ({
  db: { select: mocks.select },
}))
vi.mock('next/navigation', () => ({ redirect: mocks.redirect }))

import DashboardLayout from '@/app/(dashboard)/layout'
import OnboardingPage from './page'

describe('organization onboarding redirects', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.getUserId.mockResolvedValue('profile-a')
    mocks.select.mockReturnValue({ from: mocks.from })
    mocks.from.mockReturnValue({ where: mocks.where })
  })

  it('does not turn a dashboard database failure into an onboarding redirect', async () => {
    const error = Object.assign(new Error('(EMAXCONNSESSION) max clients reached in session mode'), {
      code: 'XX000',
    })
    mocks.where.mockRejectedValue(error)

    await expect(DashboardLayout({ children: null })).rejects.toBe(error)
    expect(mocks.redirect).not.toHaveBeenCalledWith('/onboarding')
  })

  it('does not render onboarding when its membership lookup fails', async () => {
    const error = Object.assign(new Error('(EMAXCONNSESSION) max clients reached in session mode'), {
      code: 'XX000',
    })
    mocks.where.mockRejectedValue(error)

    await expect(OnboardingPage()).rejects.toBe(error)
    expect(mocks.redirect).not.toHaveBeenCalledWith('/onboarding')
  })

  it('still redirects to onboarding when the membership lookup succeeds with no rows', async () => {
    mocks.where.mockResolvedValue([])
    mocks.redirect.mockImplementation((destination: string) => {
      throw new Error(`redirect:${destination}`)
    })

    await expect(DashboardLayout({ children: null })).rejects.toThrow('redirect:/onboarding')
    expect(mocks.redirect).toHaveBeenCalledWith('/onboarding')
  })
})
