# Auditoría Técnica Fase 0 - UrbanBrain

**Rol:** CTO Senior / Arquitecto Principal
**Objetivo:** Identificar vulnerabilidades arquitectónicas, deuda técnica crítica, riesgos de escalabilidad y cuellos de botella antes de iniciar el desarrollo productivo.

---

## 🔴 CRÍTICO: Corregir obligatoriamente antes de la Fase 1

### 1. Versionado de Políticas RLS (Supabase + Drizzle)
* **Riesgo:** Drizzle ORM no maneja de forma nativa la creación de políticas RLS de PostgreSQL de forma fluida a través de su API TypeScript. Si las políticas se crean a mano en la interfaz de Supabase, perderemos el control de versiones.
* **Impacto:** Alta probabilidad de divergencia entre entornos (Local, Staging, Producción). Un despiste en un despliegue dejará datos de expedientes expuestos entre clientes (fuga de datos multitenant fatal).
* **Probabilidad:** 100% si no se sistematiza.
* **Solución:** Integrar Supabase CLI localmente y definir un sistema mixto: Drizzle genera las tablas, pero las políticas RLS se inyectan mediante scripts SQL manuales versionados en Git (`drizzle/custom-migrations`).

### 2. Incumplimiento del "Zero Vendor Lock-in" (Auth)
* **Riesgo:** En la Fase 0 hemos acoplado el middleware de Next.js y previsiblemente los Server Actions a `@supabase/ssr`. Esto rompe el principio fundacional arquitectónico de aislar los proveedores.
* **Impacto:** Si Supabase sube los precios y queremos migrar a AWS Cognito o Auth0, habrá que reescribir la capa de red y las protecciones de ruta.
* **Probabilidad:** Media a largo plazo, pero el daño arquitectónico ya está hecho.
* **Solución:** Crear un `AuthPort` estricto en el dominio y un `SupabaseAuthAdapter` en infraestructura. El middleware debe consumir la interfaz, no la librería directa.

### 3. Aislamiento de Entornos E2E (Playwright vs BD)
* **Riesgo:** Hemos configurado Playwright para un "smoke test", pero en cuanto la Fase 1 comience, Playwright ejecutará tests contra la base de datos de desarrollo.
* **Impacto:** Colisiones de datos, tests inestables (flaky) y falsos positivos. Playwright borrará datos que el desarrollador está usando.
* **Probabilidad:** 100% en cuanto haya tests mutacionales.
* **Solución:** Exigir que Playwright se conecte exclusivamente a una base de datos efímera (Supabase Local con Docker) o mockear por completo el `DatabaseAdapter` en entorno E2E.

---

## 🟡 ADVERTENCIA: Conviene mejorarlo antes de la Fase 1

### 4. Robustez del PII Stripper (RGPD)
* **Riesgo:** El `piiStripper.ts` actual se basa en expresiones regulares ingenuas. En el mundo real de la arquitectura, los usuarios escriben teléfonos como "6 0 0 1 2 3 4 5 6" o DNIs como "12345678-A".
* **Impacto:** Fuga silenciosa de datos personales hacia el LLM, violando el RGPD y los acuerdos de confidencialidad de los estudios de arquitectura.
* **Probabilidad:** Alta. Los usuarios no formatean los textos perfectamente.
* **Solución:** Implementar una librería de procesamiento de lenguaje natural (NLP) ligera en el servidor o usar heurísticas mucho más agresivas.

### 5. Índices Espaciales (PostGIS)
* **Riesgo:** Hemos definido un `customType` para coordenadas, pero el esquema de Drizzle no incluye índices espaciales (GIST).
* **Impacto:** Cuando UrbanBrain intente calcular "qué expedientes hay en este radio" o "a qué polígono normativo pertenece esta parcela" sobre 50.000 parcelas, la consulta degradará a un Full Table Scan (O(N)), matando el rendimiento y disparando el coste de lectura de la BD.
* **Probabilidad:** 100% a medida que el volumen de datos crezca.
* **Solución:** Añadir `index("spatial_idx").using("gist", table.geom)` (o SQL raw) en la definición de Drizzle antes de crear las migraciones iniciales.

### 6. Vulnerabilidad a ataques DDoS y Costes LLM
* **Riesgo:** Next.js Server Actions no tienen Rate Limiting por defecto.
* **Impacto:** Un script malicioso (o un bot) puede llamar a la acción de chat miles de veces por segundo, drenando la cuota mensual de peticiones al LLM y la transferencia de Supabase en horas.
* **Probabilidad:** Media/Alta si la app es pública.
* **Solución:** Implementar una capa de Rate Limiting (ej. Upstash Redis o tablas en memoria) a nivel de Middleware / Server Action, limitando las consultas por IP/Usuario.

---

## 🟢 ESTABLE: Puede quedarse así

### 7. Estrategia PWA y Caché
* **Análisis:** La decisión de Serwist y cachear solo el App Shell es correcta. No intentamos sincronizar expedientes offline mediante IndexedDB (que introduciría una complejidad titánica en V1). La gestión pasiva de la PWA minimiza riesgos.
* **Veredicto:** Aprobado.

### 8. Elección de Drizzle sobre Prisma
* **Análisis:** Prisma es lento en entornos Edge/Serverless y muy opaco con las queries generadas. Drizzle ofrece control transaccional preciso y SQL real, fundamental para consultas geográficas (PostGIS).
* **Veredicto:** Aprobado. Excelente decisión técnica a 5 años vista.

### 9. Arquitectura de Carpetas y Next.js App Router
* **Análisis:** La separación `(dashboard)` y `(auth)` con layout maestro es el estándar de oro actual en Next.js. El uso de Tailwind + shadcn es mantenible, no introduce dependencias pesadas y permite hacer tree-shaking eficientemente.
* **Veredicto:** Aprobado.

### 10. Costes Futuros e Infraestructura
* **Análisis:** Next.js (Vercel/Self-hosted) + Supabase (Postgres) es el stack con menor coste de entrada y mayor techo de escalabilidad pre-Kubernetes. Al mantener la IA fuera del sistema core (Agente Normativas separado), se evita ahogar el servidor principal con tareas de larga duración.
* **Veredicto:** Aprobado.
