# Guía de Instalación Local

Esta guía describe cómo arrancar el entorno de desarrollo de **UrbanBrain** en tu máquina local.

## 1. Requisitos Previos

* Node.js v24.18.0 (LTS)
* npm
* Proyecto en Supabase (o Supabase CLI local)

## 2. Variables de Entorno

1. Duplica el archivo `.env.example` y renómbralo a `.env.local` (o simplemente `.env`).
2. Rellena los valores con tus credenciales de Supabase:
   * `NEXT_PUBLIC_SUPABASE_URL`
   * `NEXT_PUBLIC_SUPABASE_ANON_KEY`
   * `DATABASE_URL` (Debe ser la conexión Postgres con permisos de escritura, normalmente apuntando al pooler puerto 6543 en Supabase).

## 3. Base de Datos

Antes de arrancar la aplicación, debes instanciar la base de datos:

```bash
# Sincroniza el esquema local de Drizzle con tu base de datos remota
npm run db:push

# (Opcional) Puebla la base de datos con un usuario y organización demo
npm run db:seed
```

## 4. Arranque del Servidor

```bash
npm install
npm run dev
```

El servidor estará disponible en `http://localhost:3000`.

## 5. Scripts Útiles

* `npm run verify`: Ejecuta el linter, el typechecker, los tests unitarios y la build de Next.js (Script recomendado antes de hacer commits).
* `npm run test`: Ejecuta los tests unitarios con Vitest.
* `npm run test:e2e`: Lanza los tests de navegador con Playwright.
