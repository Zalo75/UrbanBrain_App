import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

vi.mock('next/navigation', () => ({ usePathname: () => '/dashboard' }))
vi.mock('@/hooks/useOnlineStatus', () => ({ useOnlineStatus: () => true }))
vi.mock('@/app/(dashboard)/actions', () => ({ logout: vi.fn() }))

import { Header } from './Header'

describe.each([
  ['mobile', 390],
  ['desktop', 1440],
] as const)('Header logout on %s', (_label, width) => {
  it('exposes a visible submit control for closing the session', async () => {
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: width })
    render(<Header userProfile={{ fullName: 'Usuario piloto' }} />)
    fireEvent.click(screen.getByRole('button', { name: 'Menú de usuario' }))
    const logout = await screen.findByRole('menuitem', { name: 'Cerrar sesión' })
    expect(logout.getAttribute('type')).toBe('submit')
  })
})
