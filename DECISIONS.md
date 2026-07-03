# Registro de Decisiones Técnicas (ADR)

Este documento mantiene un registro histórico de las decisiones de arquitectura e implementación importantes.

## Formato
* **Fecha:** YYYY-MM-DD
* **Decisión tomada:** Qué se ha decidido.
* **Motivo:** Por qué se ha tomado la decisión.
* **Alternativas descartadas:** Qué otras opciones se valoraron y por qué se rechazaron.
* **Impacto futuro:** Consecuencias a largo plazo de esta decisión.

---

### [2026-06-25] Estrategia de Caché PWA (Seguridad vs Offline)
* **Decisión tomada:** Configurar `@serwist/next` para excluir estrictamente las páginas de expedientes, el dashboard privado y las rutas `/api` del caché offline. El Service Worker solo interceptará navegación web para proveer el Application Shell público y un *fallback* estático (`/offline`).
* **Motivo:** Evitar que datos sensibles y normativa privada se queden "atrapados" en la caché local del dispositivo de los usuarios, lo que sería un riesgo legal y de privacidad si comparten tablet.
* **Alternativas descartadas:** Cachear las respuestas del motor de IA o los JSON del expediente localmente (Workbox `NetworkFirst` o `StaleWhileRevalidate`). Descartado por el enorme peso de los PDFs y el riesgo GDPR.
* **Impacto futuro:** La app siempre requerirá conexión para ser útil (algo esperado en consulta de normativa). La PWA se usará por sus beneficios de UI (Standalone, Safe-Areas, iconos) y no por capacidades offline avanzadas.

### [2026-06-25] Modelo de Usuario (Identidad vs Perfil)
* **Decisión tomada:** Eliminar la tabla duplicada `users`. Delegar el 100% de la identidad, credenciales y autenticación a Supabase Auth (`auth.users`). Crear una tabla `public.profiles` mapeada por ID para almacenar nombre, avatar y preferencias.
* **Motivo:** Evitar sincronizar estados entre dos tablas (evitando duplicar emails, resets de contraseña o borrados de cuenta). Mantener una única fuente de verdad para la sesión.
* **Alternativas descartadas:** Mantener una tabla `users` propia con triggers en Postgres para sincronizar (descartado por complejidad y propensión a errores de concurrencia).
* **Impacto futuro:** Crea un cierto grado de acoplamiento ("Vendor Lock-in") a nivel de base de datos con Supabase Auth (ya que `profiles.id` depende lógicamente del UUID generado por `auth.users`), pero es el estándar de la industria para este stack y sus beneficios de seguridad superan la desventaja.

### [2026-06-25] Principios Arquitectónicos Permanentes: Clean Architecture y Zero Vendor Lock-in
* **Decisión tomada:** Adoptar Clean Architecture estructurando `/src` en `domain/`, `application/`, `infrastructure/`, `adapters/` y `shared/`. Obligar al uso del patrón Adapter para cualquier proveedor externo.
* **Motivo:** Garantizar que UrbanBrain sea agnóstico a los proveedores subyacentes (Supabase, OpenRouter, Stripe) y separar estrictamente la lógica de negocio de la UI (Next.js).
* **Alternativas descartadas:** Arquitectura estándar de Next.js (`/app`, `/components`, `/lib`) mezclando lógica de negocio con Server Actions (descartada por generar alto acoplamiento a Vercel/Next.js y deuda técnica a largo plazo).
* **Impacto futuro:** Permitirá cambiar de ORM, de proveedor LLM o de pasarela de pago sin tocar los casos de uso (application) ni las entidades (domain). Aumenta la complejidad inicial pero garantiza supervivencia a largo plazo.

### [2026-06-25] Sistema de Notificaciones: Sustitución de Toast por Sonner
* **Decisión tomada:** Utilizar `sonner` en lugar de la primitiva `toast` clásica de shadcn/ui.
* **Motivo:** Durante el andamiaje del Bloque A, el CLI de shadcn marcó `toast` como obsoleto e impidió su instalación. `sonner` es el nuevo estándar recomendado en el ecosistema React.
* **Alternativas descartadas:** Forzar la instalación manual del código antiguo de `toast` (descartado por generar deuda técnica inmediata) o usar `react-hot-toast` (rompe la homogeneidad de la librería UI).
* **Impacto futuro:** `sonner` simplifica el estado de los toasts (no requiere un Provider complejo en el layout superior) y ofrece un diseño apilado moderno.

### [2026-06-25] Nombre del Proyecto NPM y mayúsculas
* **Decisión tomada:** Forzar el nombre del paquete en `package.json` a `urbanbrain-app` en minúsculas, manteniendo el nombre de la carpeta raíz (`UrbanBrain_App`) intacto.
* **Motivo:** NPM prohíbe nombres de proyectos con letras mayúsculas en las nuevas versiones.
* **Alternativas descartadas:** Renombrar la carpeta raíz del proyecto y el entorno de trabajo del usuario (descartado por intrusivo y posible rotura de rutas absolutas).
* **Impacto futuro:** Nulo. Es puramente un metadato interno del `package.json`.
