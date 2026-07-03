# Testing en UrbanBrain

## Estrategia de Base de Datos Efímera (Playwright E2E)

Para garantizar la integridad de los datos de desarrollo y cumplir con las mejores prácticas, los tests E2E **nunca** se ejecutarán contra la base de datos de Staging o Desarrollo compartida.

Se utilizará una instancia local de **Supabase en Docker** como base de datos efímera.

### Requisitos

*   **Docker Desktop** instalado y en ejecución.
*   **Supabase CLI** (instalado localmente como dependencia de NPM).

### Ejecutar los tests localmente

Hemos preparado un script que levanta el contenedor de Supabase, aplica las migraciones de Drizzle y ejecuta Playwright:

```bash
npm run test:e2e:local
```

### ¿Cómo funciona?

1.  `supabase start` lee `supabase/config.toml` y arranca la base de datos en los puertos por defecto (API en 54321, DB en 54322).
2.  Automáticamente, Supabase CLI aplica las migraciones que hemos versionado en `supabase/migrations/` (esquema de Drizzle + Políticas RLS).
3.  Playwright se inicializa usando `.env.test`, que sobreescribe las variables de entorno para que el frontend y el backend de Next.js apunten a la instancia local de Docker en lugar de a la nube.
4.  Si necesitas detener el entorno tras los tests, simplemente ejecuta: `npx supabase stop`.
