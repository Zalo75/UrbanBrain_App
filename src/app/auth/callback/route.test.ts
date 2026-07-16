import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  cookies: vi.fn(),
  createServerClient: vi.fn(),
  exchangeCodeForSession: vi.fn(),
}))

vi.mock('next/headers', () => ({ cookies: mocks.cookies }))
vi.mock('@supabase/ssr', () => ({ createServerClient: mocks.createServerClient }))

import { GET } from './route'

function callbackRequest(query: string) {
  return new Request(`http://localhost:3000/auth/callback?${query}`)
}

describe('OAuth callback redirects', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.stubEnv('NEXT_PUBLIC_SITE_URL', 'https://urbanbrain.es/')
    mocks.cookies.mockResolvedValue({ getAll: vi.fn(() => []), set: vi.fn() })
    mocks.createServerClient.mockReturnValue({
      auth: { exchangeCodeForSession: mocks.exchangeCodeForSession },
    })
    mocks.exchangeCodeForSession.mockResolvedValue({ error: null })
  })

  afterEach(() => vi.unstubAllEnvs())

  it('redirects a successful production callback to the canonical dashboard', async () => {
    const response = await GET(callbackRequest('code=valid-code'))

    expect(mocks.exchangeCodeForSession).toHaveBeenCalledWith('valid-code')
    expect(response.headers.get('location')).toBe('https://urbanbrain.es/dashboard')
  })

  it('redirects an exchange error to the canonical login', async () => {
    mocks.exchangeCodeForSession.mockResolvedValue({ error: new Error('invalid code') })

    const response = await GET(callbackRequest('code=invalid-code'))

    expect(response.headers.get('location')).toBe(
      'https://urbanbrain.es/login?message=auth_callback_failed'
    )
  })

  it.each(['https://evil.example/steal', '//evil.example/steal'])(
    'rejects the external next destination %s',
    async (externalDestination) => {
      const response = await GET(
        callbackRequest(`code=valid-code&next=${encodeURIComponent(externalDestination)}`)
      )

      expect(response.headers.get('location')).toBe('https://urbanbrain.es/dashboard')
    }
  )

  it('uses the request origin only during local development without a site URL', async () => {
    vi.stubEnv('NEXT_PUBLIC_SITE_URL', '')
    vi.stubEnv('NODE_ENV', 'development')

    const response = await GET(callbackRequest('code=valid-code&next=%2Fexpedientes'))

    expect(response.headers.get('location')).toBe('http://localhost:3000/expedientes')
  })

  it('does not fall back to the request origin outside development', async () => {
    vi.stubEnv('NEXT_PUBLIC_SITE_URL', '')
    vi.stubEnv('NODE_ENV', 'production')

    await expect(GET(callbackRequest('code=valid-code'))).rejects.toThrow(
      'NEXT_PUBLIC_SITE_URL is required outside development'
    )
    expect(mocks.exchangeCodeForSession).not.toHaveBeenCalled()
  })
})
