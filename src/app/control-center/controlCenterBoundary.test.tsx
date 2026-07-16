import { render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  requirePlatformPermission: vi.fn(),
  redirect: vi.fn(),
  notFound: vi.fn(),
}))

vi.mock('@/application/authorization/platformAccess', () => ({
  requirePlatformPermission: mocks.requirePlatformPermission,
  isPlatformAuthorizationError: (error: unknown) =>
    typeof error === 'object' && error !== null && 'code' in error,
}))

vi.mock('next/navigation', () => ({
  redirect: mocks.redirect,
  notFound: mocks.notFound,
}))

import ControlCenterLayout from './layout'

describe('/control-center boundary', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.redirect.mockImplementation((destination: string) => {
      throw new Error(`redirect:${destination}`)
    })
    mocks.notFound.mockImplementation(() => {
      throw new Error('not-found')
    })
  })

  it('redirects an unauthenticated direct request to login', async () => {
    mocks.requirePlatformPermission.mockRejectedValue({ code: 'unauthenticated' })

    await expect(
      ControlCenterLayout({ children: <div>Protected content</div> })
    ).rejects.toThrow('redirect:/login?next=/control-center')
  })

  it.each(['not_platform_admin', 'inactive_platform_admin', 'permission_denied'])(
    'returns the same not-found boundary for %s',
    async (code) => {
      mocks.requirePlatformPermission.mockRejectedValue({ code })

      await expect(
        ControlCenterLayout({ children: <div>Protected content</div> })
      ).rejects.toThrow('not-found')
    }
  )

  it('renders only after the server guard returns an authorized identity', async () => {
    mocks.requirePlatformPermission.mockResolvedValue({
      profileId: 'synthetic-profile-id',
      fullName: 'Synthetic administrator',
      role: 'readonly',
      createdAt: new Date('2026-07-15T12:00:00.000Z'),
      lastReviewedAt: null,
    })

    render(await ControlCenterLayout({ children: <div>Protected content</div> }))

    expect(mocks.requirePlatformPermission).toHaveBeenCalledWith('control_center.access')
    expect(screen.getByText('UrbanBrain Control Center')).toBeTruthy()
    expect(screen.getByText('Synthetic administrator')).toBeTruthy()
    expect(screen.getByText('Protected content')).toBeTruthy()
  })
})
