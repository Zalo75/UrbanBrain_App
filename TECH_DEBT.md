# Registro de Deuda Técnica

Este documento enumera atajos temporales, optimizaciones pospuestas y refactorizaciones necesarias que hemos acordado aplazar para mantener la velocidad de entrega en la versión actual.

## Formato
* **Descripción:** Qué es exactamente lo que hay que arreglar o mejorar.
* **Motivo:** Por qué se ha aplazado.
* **Prioridad:** Alta / Media / Baja
* **Versión objetivo:** Cuándo se planea abordar (Ej. V1.1, V2.0).

---

### Limitaciones de PWA en iOS/Safari (Purga de Caché)
* **Descripción:** Safari en iOS impone una política muy agresiva de purga de almacenamiento local si el usuario no abre la PWA instalada en la pantalla de inicio durante 7 días consecutivos.
* **Motivo:** Política de privacidad y gestión de almacenamiento de Apple. Esto podría provocar deslogueos indeseados.
* **Prioridad:** Media (El uso de cookies Server-Side de Supabase mitiga gran parte del problema, pero el localStorage de Zustand/PWA se perderá).
* **Versión objetivo:** Seguimiento continuo (No hay solución técnica total, se requiere educación al usuario "Añadir a pantalla de inicio").

### Iconos PWA (Placeholders)
* **Descripción:** Los iconos actuales de la Progressive Web App (`icon-192x192.png`, `icon-512x512.png` y `icon-maskable.png`) son imágenes falsas de *placehold.co*.
* **Motivo:** Generados temporalmente para permitir que Lighthouse y los navegadores validen el Manifest de la PWA durante la Fase 0 sin romper el build.
* **Prioridad:** Alta (Deben cambiarse antes de cualquier despliegue a producción o prueba de usabilidad).
* **Versión objetivo:** V1.0 (Antes de QA)

### Procesamiento Asíncrono para Tareas Pesadas (OCR y PDF)
* **Descripción:** Extraer la lógica de OCR y exportación masiva de PDFs a un sistema de colas asíncronas (background workers).
* **Motivo:** Next.js App Router alojado en entornos serverless (ej. Vercel) tiene un timeout estricto (10s a 60s). Procesar miles de páginas de un PGOU excederá este límite y matará la petición, resultando en un error 504 para el usuario.
* **Prioridad:** Alta (Crítico antes de habilitar OCR completo).
* **Versión objetivo:** V1.5
