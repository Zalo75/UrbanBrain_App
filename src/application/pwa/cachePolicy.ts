const PRIVATE_PREFIXES = ['/api', '/dashboard', '/expedientes', '/documents'] as const
const PUBLIC_SHELL_PATHS = new Set(['/offline'])
const PUBLIC_FILES = new Set(['/favicon.ico', '/manifest.json', '/manifest.webmanifest', '/icon-192x192.png', '/icon-512x512.png'])
const STATIC_EXTENSIONS = /\.(?:avif|css|gif|ico|jpe?g|js|png|svg|webp|woff2?)$/i
export const LEGACY_PRIVATE_CACHE_NAMES = ['serwist-runtime'] as const

function pathnameFromUrl(value: string) {
  try {
    return new URL(value, 'https://urbanbrain.invalid').pathname
  } catch {
    return ''
  }
}

export function isPrivateApplicationPath(pathname: string) {
  return PRIVATE_PREFIXES.some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`))
}

export function isSafePublicStaticPath(pathname: string) {
  if (isPrivateApplicationPath(pathname)) return false
  if (PUBLIC_FILES.has(pathname) || pathname.startsWith('/_next/static/')) return true
  return pathname.startsWith('/images/') && STATIC_EXTENSIONS.test(pathname)
}

export function isSafePrecacheUrl(value: string) {
  const pathname = pathnameFromUrl(value)
  return PUBLIC_SHELL_PATHS.has(pathname) || isSafePublicStaticPath(pathname)
}

export function isSafeRuntimeRequest(input: { url: string; method: string; destination: string; rscHeader?: string | null; acceptHeader?: string | null }) {
  if (input.method !== 'GET' || input.rscHeader === '1' || input.acceptHeader?.includes('text/x-component')) return false
  const pathname = pathnameFromUrl(input.url)
  if (!isSafePublicStaticPath(pathname)) return false
  return ['style', 'script', 'image', 'font', 'manifest'].includes(input.destination)
}

export function isSafePublicResponse(input: { ok: boolean; setCookie: boolean; contentType: string; cacheControl: string }) {
  return input.ok && !input.setCookie &&
    !input.contentType.includes('application/json') &&
    !input.contentType.includes('text/x-component') &&
    !/(?:private|no-store)/i.test(input.cacheControl)
}
