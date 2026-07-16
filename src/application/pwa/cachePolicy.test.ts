import { describe, expect, it } from 'vitest'
import { isSafePrecacheUrl, isSafePublicResponse, isSafeRuntimeRequest, LEGACY_PRIVATE_CACHE_NAMES } from './cachePolicy'

describe('service worker cache policy', () => {
  it('purges the legacy runtime cache that could contain private responses', () => {
    expect(LEGACY_PRIVATE_CACHE_NAMES).toContain('serwist-runtime')
  })
  it.each(['/api/chat', '/api/chat/history?expedienteId=private', '/dashboard', '/expedientes/private-id', '/documents/private-id'])('excludes private URL %s', (url) => {
    expect(isSafePrecacheUrl(url)).toBe(false)
  })

  it('excludes RSC, navigations, mutations and arbitrary JSON', () => {
    expect(isSafeRuntimeRequest({ url: 'https://test/_next/static/chunks/app.js', method: 'GET', destination: '', rscHeader: '1', acceptHeader: 'text/x-component' })).toBe(false)
    expect(isSafeRuntimeRequest({ url: 'https://test/api/chat', method: 'GET', destination: '', acceptHeader: 'application/json' })).toBe(false)
    expect(isSafeRuntimeRequest({ url: 'https://test/', method: 'GET', destination: 'document' })).toBe(false)
    expect(isSafeRuntimeRequest({ url: 'https://test/images/logo.png', method: 'POST', destination: 'image' })).toBe(false)
  })

  it('allows only the offline shell and static resources', () => {
    expect(isSafePrecacheUrl('/')).toBe(false)
    expect(isSafePrecacheUrl('/login')).toBe(false)
    for (const url of ['/offline', '/_next/static/chunks/app.js']) expect(isSafePrecacheUrl(url)).toBe(true)
    expect(isSafeRuntimeRequest({ url: 'https://test/images/logo.png', method: 'GET', destination: 'image' })).toBe(true)
  })

  it.each([
    { ok: true, setCookie: true, contentType: 'image/png', cacheControl: 'public' },
    { ok: true, setCookie: false, contentType: 'application/json', cacheControl: 'public' },
    { ok: true, setCookie: false, contentType: 'text/x-component', cacheControl: 'public' },
    { ok: true, setCookie: false, contentType: 'image/png', cacheControl: 'private, no-store' },
  ])('rejects authenticated or private response metadata %#', (metadata) => {
    expect(isSafePublicResponse(metadata)).toBe(false)
  })
})
