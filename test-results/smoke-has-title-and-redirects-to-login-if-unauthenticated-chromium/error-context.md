# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: smoke.spec.ts >> has title and redirects to login if unauthenticated
- Location: tests\e2e\smoke.spec.ts:3:5

# Error details

```
Error: expect(page).toHaveURL(expected) failed

Expected pattern: /.*login/
Received string:  "http://localhost:3000/"
Timeout: 5000ms

Call log:
  - Expect "toHaveURL" with timeout 5000ms
    14 × unexpected value "http://localhost:3000/"

```

```yaml
- banner:
  - link "Acceso Clientes":
    - /url: /login
    - button "Acceso Clientes"
- img "UrbanBrain Logo"
- paragraph: Consulta normativa, gestiona expedientes y automatiza documentación técnica.
- text: Consulta normativa en segundos. Automatiza tareas repetitivas. Centraliza documentación técnica y urbanística.
- img "Arquitectura 1"
- img "Arquitectura 2"
- img "Arquitectura 3"
- img "Arquitectura 4"
- img "Arquitectura 5"
- img "Arquitectura 6"
- img "Arquitectura 7"
- heading "De semanas a minutos." [level=2]
- heading "Planes adaptados a tu estudio" [level=2]
- text: Pago Mensual
- switch
- text: Pago Anual -20% cuota / -50% alta
- heading "FREE" [level=3]
- text: 0 €
- list:
  - listitem: 2 proyectos totales
  - listitem: 18 consultas totales
  - listitem: Sin caducidad
  - listitem: Acceso sujeto a validación manual durante la fase beta
- button "Comenzar"
- heading "PAY PER USE" [level=3]
- text: 20 €
- paragraph: IVA incluido / pago único
- list:
  - listitem: 1 proyecto
  - listitem: 10 consultas
  - listitem: Sin suscripción
  - listitem: Validez 12 meses desde la compra
- button "Comenzar"
- heading "BASIC" [level=3]
- text: 45 €
- paragraph: IVA incluido / mes
- paragraph: "+ Alta inicial: 150 €"
- list:
  - listitem: 1 proyecto al mes
  - listitem: 80 consultas al mes
- button "Comenzar"
- text: Más popular
- heading "PLUS" [level=3]
- text: 89 €
- paragraph: IVA incluido / mes
- paragraph: "+ Alta inicial: 300 €"
- list:
  - listitem: 10 proyectos al mes
  - listitem: 300 consultas al mes
- button "Comenzar"
- heading "PRO" [level=3]
- text: 119 €
- paragraph: IVA incluido / mes
- paragraph: "+ Alta inicial: 500 €"
- list:
  - listitem: 100 proyectos al mes
  - listitem: 2000 consultas al mes
  - listitem: Base normativa personalizada
  - listitem: Incorporación de normativa propia del estudio o administración
  - listitem: Soporte prioritario
- button "Comenzar"
- heading "ENTERPRISE" [level=3]
- text: Personalizado
- paragraph: Para grandes volúmenes
- list:
  - listitem: Base normativa personalizada avanzada
  - listitem: Integraciones y condiciones a medida
  - listitem: Soporte prioritario
  - listitem: Volumen personalizado
- button "Hablemos"
- paragraph: "Los PDF con texto seleccionable se procesan sin coste adicional. La documentación escaneada o basada en imágenes requiere OCR opcional: 15 € por cada 100 páginas procesadas."
- heading "¿Hablamos?" [level=2]
- paragraph: Solicita acceso a la beta o cuéntanos las necesidades específicas de tu estudio de arquitectura.
- heading "Contacto próximamente" [level=3]
- paragraph: El canal de contacto todavía no está habilitado. No se enviará ni almacenará información desde este formulario.
- contentinfo:
  - text: © 2026 UrbanBrain. Todos los derechos reservados.
  - button "Aviso Legal"
  - button "Política de Privacidad"
  - button "Política de Cookies"
  - button "Términos del Servicio"
- alert
```

# Test source

```ts
  1  | import { test, expect } from '@playwright/test';
  2  | 
  3  | test('has title and redirects to login if unauthenticated', async ({ page }) => {
  4  |   await page.goto('/');
  5  | 
  6  |   // The application should redirect to /login due to our Next.js middleware 
  7  |   // since we are not authenticated in this clean session.
> 8  |   await expect(page).toHaveURL(/.*login/);
     |                      ^ Error: expect(page).toHaveURL(expected) failed
  9  |   
  10 |   // Login page should have a Login title
  11 |   await expect(page.locator('h3, h1, .text-2xl')).toContainText('Login');
  12 | });
  13 | 
```