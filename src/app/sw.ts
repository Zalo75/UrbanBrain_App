/* eslint-disable @typescript-eslint/ban-ts-comment */
// @ts-nocheck
import { defaultCache } from "@serwist/next/worker";
import type { PrecacheEntry, SerwistGlobalConfig } from "@serwist/sw";
import { installSerwist } from "@serwist/sw";

declare global {
  interface WorkerGlobalScope extends SerwistGlobalConfig {
    __SW_MANIFEST: (PrecacheEntry | string)[] | undefined;
  }
}

declare const self: ServiceWorkerGlobalScope;

// Filtramos el defaultCache para asegurar que no se cachean rutas API ni el dashboard
const safeCache = defaultCache.filter((cacheRule) => {
  // Evitar cualquier regla que intente cachear HTML de navegación de forma agresiva
  if (cacheRule.options?.cacheName === "pages") return false;
  return true;
});

installSerwist({
  precacheEntries: self.__SW_MANIFEST,
  skipWaiting: true,
  clientsClaim: true,
  navigationPreload: true,
  runtimeCaching: [
    ...safeCache,
  ],
  fallbacks: {
    entries: [
      {
        url: "/offline",
        matcher({ request }) {
          return request.destination === "document";
        },
      },
    ],
  },
});
