/* eslint-disable @typescript-eslint/ban-ts-comment */
// @ts-nocheck
import type { PrecacheEntry, SerwistGlobalConfig } from '@serwist/sw'
import { installSerwist } from '@serwist/sw'

import { isSafePrecacheUrl, isSafePublicResponse, isSafeRuntimeRequest, LEGACY_PRIVATE_CACHE_NAMES } from '@/application/pwa/cachePolicy'

declare global {
  interface WorkerGlobalScope extends SerwistGlobalConfig {
    __SW_MANIFEST: (PrecacheEntry | string)[] | undefined
  }
}

declare const self: ServiceWorkerGlobalScope

self.addEventListener('activate', (event) => {
  event.waitUntil(Promise.all(LEGACY_PRIVATE_CACHE_NAMES.map((name) => caches.delete(name))))
})

const safePrecacheEntries = (self.__SW_MANIFEST ?? []).filter((entry) =>
  isSafePrecacheUrl(typeof entry === 'string' ? entry : entry.url)
)

async function publicStaticHandler({ request }: { request: Request }) {
  const cache = await caches.open('urbanbrain-public-static-v1')
  const cached = await cache.match(request)
  if (cached) return cached

  // Static resources are fetched without cookies so an authenticated response
  // can never enter the cache, even if a public URL is misconfigured.
  const publicRequest = new Request(request, { credentials: 'omit' })
  const response = await fetch(publicRequest)
  const contentType = response.headers.get('Content-Type') ?? ''
  const cacheControl = response.headers.get('Cache-Control') ?? ''
  const safeResponse = isSafePublicResponse({
    ok: response.ok,
    setCookie: response.headers.has('Set-Cookie'),
    contentType,
    cacheControl,
  })
  if (safeResponse) await cache.put(request, response.clone())
  return response
}

installSerwist({
  precacheEntries: safePrecacheEntries,
  skipWaiting: true,
  clientsClaim: true,
  navigationPreload: true,
  runtimeCaching: [
    {
      matcher: ({ request, url }) =>
        isSafeRuntimeRequest({
          url: url.href,
          method: request.method,
          destination: request.destination,
          rscHeader: request.headers.get('RSC'),
          acceptHeader: request.headers.get('Accept'),
        }),
      handler: publicStaticHandler,
    },
    {
      matcher: () => true,
      handler: ({ request }) => fetch(request),
    },
  ],
  fallbacks: {
    entries: [
      {
        url: '/offline',
        matcher({ request }) {
          return request.destination === 'document'
        },
      },
    ],
  },
})
