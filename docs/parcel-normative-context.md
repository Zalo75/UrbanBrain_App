# Contexto normativo de parcela

## Causa raíz de las mezclas

El chat V1 recuperaba por similitud y por un filtro textual de municipio, pero enviaba todos los
resultados coincidentes al modelo sin comprobar ordenanza, clase de suelo, ámbito, jerarquía o
vigencia. El municipio procedía además del navegador. En modo CTE V2, la respuesta se generaba con
chunks V2 mientras las fuentes visibles se construían con resultados V1. No había validación
posterior de citas ni una regla lógica que impidiese cifras urbanísticas con contexto incompleto.

## Solución

- El contexto se construye en servidor desde el expediente autorizado, la última detección de
  Catastro, las afecciones existentes y afirmaciones explícitas del usuario en el historial.
- Cada dato conserva procedencia, confianza y estado `confirmed`, `unverified` o `inferred`.
- Las preguntas sobre edificabilidad, ocupación, altura, retranqueos, usos y condiciones equivalentes
  sólo admiten cifras si parcela, municipio, clase de suelo, ordenanza/ámbito, instrumento y vigencia
  están confirmados.
- El motor clasifica la recuperación como `DETERMINADO`, `PARCIAL`, `CONFLICTIVO` o
  `NO_DETERMINADO` y bloquea municipios, ordenanzas, clases, ámbitos o vigencias incompatibles.
- El prompt recibe únicamente los chunks aplicables. Tras generar, se comprueba que todas las citas
  existan y que cada cifra aparezca en la fuente citada. Si falla, la respuesta se sustituye por una
  abstención segura.
- CTE V2 permanece separado de V1 y sus fuentes visibles se construyen desde los mismos chunks V2
  usados para responder.

## Límites conocidos

- El repositorio no contiene integración de geocodificación por dirección ni geocodificación inversa
  por coordenadas. Esos datos se reutilizan cuando ya constan en el expediente, pero no se inventa una
  resolución territorial.
- El RPC V1 sólo devuelve municipio, documento, título y texto. Cuando esos campos no demuestran la
  relación con una ordenanza o ámbito, el sistema se abstiene.
- No se ha añadido ninguna tabla ni migración. La vigencia sólo se considera confirmada cuando figura
  en una detección existente o cuando el contexto completo ha sido validado por un técnico.
- Esta rama parte de `main` y no incorpora el PR #1. Antes de integrar ambos trabajos debe resolverse
  el solapamiento del handler de chat conservando el guard centralizado de aquel PR.
