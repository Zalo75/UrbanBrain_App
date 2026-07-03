# UrbanBrain 🏗️

UrbanBrain es el asistente urbanístico de próxima generación diseñado específicamente para estudios de arquitectura en España.

## Arquitectura

* **Frontend:** Next.js 15 (App Router), React 19, Tailwind CSS v4, shadcn/ui.
* **Backend:** Next.js Server Actions, Supabase (PostgreSQL + Auth).
* **ORM:** Drizzle ORM con soporte nativo para PostGIS (geometría espacial).
* **PWA:** Integración nativa offline-first (Application Shell) mediante `@serwist/next`.
* **Testing:** Vitest (Unit) + Playwright (E2E).

## Principios de Diseño

1. **Zero Vendor Lock-In:** Todos los proveedores externos (Supabase, LLMs, Pasarelas de Pago) están abstraídos tras interfaces en la capa `adapters/`.
2. **Clean Architecture:** Separación estricta entre `/domain` (entidades y lógica pura), `/application` (casos de uso y puertos), e `/infrastructure` (bases de datos y framework).

Para instrucciones de instalación en local, consulta [docs/setup.md](./docs/setup.md).
