# Auditoría y diseño del Reasoning Composer sobre hechos factuales validados

Fecha: 14 de agosto de 2026  
Repositorio: `D:\UrbanBrain_App`  
Rama auditada: `agent/territorial-beta-recovery`  
HEAD auditado: `92094ad`

## Resumen ejecutivo

La respuesta actual es correcta a nivel de afirmaciones individuales, pero el sistema no compone una respuesta a la intención del usuario. El LLM factual selecciona operaciones, el validator comprueba cada operación de forma aislada y el renderer transforma casi cada operación en una frase. Ninguna capa exige una conclusión directa, cobertura completa de los hechos materialmente relevantes ni una síntesis no redundante entre hechos relacionados.

La omisión de SNRT 1,47 % se produce en la selección de operaciones del LLM factual. El contrato puede contener SNRC y SNRT; el validator no elimina operaciones y el renderer sí muestra SNRT cuando recibe una operación referida a ella. El resultado puede ser `valid` aunque el selector haya omitido una categoría relevante porque la validación actual comprueba veracidad, no completitud.

Se recomienda la **Opción B, dos capas LLM**, con dos condiciones:

1. cerrar antes la completitud de la selección factual mediante una política determinista de cobertura;
2. hacer que el Composer produzca un **plan semántico estructurado**, no texto libre confiado. Un safety determinista validaría ese plan y un renderer controlado produciría el texto final.

El Composer debe insertarse únicamente después de obtener operaciones validadas y antes de persistir la respuesta factual visible. Si falla, excede su presupuesto, contradice hechos o su output no pasa el safety, se utiliza el renderer factual actual. Nunca debe derivarse a Primary/RAG para reescribir una respuesta factual validada.

## 1. Causa exacta de la mala respuesta actual

La mala calidad no procede de un dato incorrecto, sino de la composición actual:

- `shadowSystemPrompt.ts` define al modelo como selector de operaciones y le prohíbe redactar texto libre.
- `factualValidator.ts` valida cada operación contra el hecho resuelto por `resolveFactRef`; no valida si la selección responde completamente a la pregunta ni si incluye todos los hechos materialmente relevantes.
- `factualRenderer.ts` recorre las operaciones validadas y genera frases por operación. Deduplica equivalencias muy concretas, como `state_conflict` frente a un `state_status: conflict` del mismo `factRef`, pero no sintetiza estados de classification y category ni construye una conclusión orientada a la pregunta.
- `visibleFactualRouting.ts` acepta cualquier resultado `valid` con operaciones, sin abstentions y con alguna línea renderizada; después concatena las líneas con saltos de párrafo.
- `route.ts` persiste y devuelve directamente esa concatenación.

En el caso observado, el selector escogió estados de classification y category, identidad/porcentaje/dominancia de SNRC y determinaciones no resueltas. Todas las operaciones individuales podían ser válidas. El renderer hizo exactamente aquello para lo que está diseñado: exponerlas como frases independientes. No existe una capa que determine primero «la respuesta estricta es no», explique después el predominio y cierre con una cautela proporcionada.

La repetición de `conflict` y `unresolved` tampoco es un fallo del hardening semántico: son hechos distintos referidos a classification y category. El problema es que no hay una política de materialidad que decida cuál de esos estados debe aparecer en la síntesis y cómo agruparlos.

## 2. Causa exacta de la omisión de SNRT 1,47 %

La pérdida se localiza en el LLM factual, antes del validator:

1. `buildFactualContract.ts` convierte todos los candidates de una category en conflicto en elementos de `categories`. Las pruebas de contrato de Sada comprueban expresamente SNRC 98,53 % y SNRT 1,47 %.
2. `contractSerializer.ts` serializa `factsByScope` completo; no filtra SNRT.
3. `shouldRunVisibleFactual` decide scope y elegibilidad, pero no recorta la lista de facts enviada al modelo.
4. `factualValidator.ts` no descarta operaciones. Acepta o rechaza el output completo según si cada operación es compatible con el contrato.
5. `factualRenderer.ts` renderiza SNRT cuando recibe `state_label`, `reference_code` o `state_percentage` para ese `factRef`. Existen pruebas específicas 98,53/1,47 y una prueba de route que exige ambas categorías.
6. `fallbackUsed: false` descarta la presencia de abstentions y confirma que existió texto renderizado elegible.

Por tanto, si SNRT hubiera llegado en una operación visible válida, el renderer la habría mostrado. La salida visible demuestra que el selector no emitió una operación útil para SNRT.

La razón estructural por la que esa omisión sigue siendo `valid` es que el validator impone **corrección de lo seleccionado**, pero no **cobertura de lo necesario**. El prompt dice «cada category pertinente», pero deja «pertinente» a criterio del modelo. Además, su ejemplo final solo contiene SNRC 98,53 % y predominio, lo que refuerza accidentalmente el patrón de seleccionar el candidato principal sin el minoritario.

### Matiz sobre la telemetría

`candidateCount: 2` no equivale necesariamente a «dos categorías seleccionables». La métrica cuenta arrays `candidates` anidados en el contrato, mientras que `buildFactualContract` aplana los candidates de category en `categories`. Es útil como diagnóstico de volumen, pero no prueba por sí sola que SNRC y SNRT estuvieran ambas en `categories` en esa ejecución concreta.

La tabla `factual_shadow_evaluations` persiste `structuredOutput` y `renderedAnswer`, por lo que el registro de producción permitiría confirmar la lista exacta de las nueve operaciones. No persiste una instantánea del contrato, así que la reconstrucción histórica completa depende también del estado del expediente. Esta auditoría no ha accedido a datos de producción.

## 3. Flujo factual actual real

```text
POST /api/chat
  -> autorización + slot
  -> loadAuthorizedParcelInputs
  -> buildNormalizedParcelContext
  -> persistir mensaje user
  -> buildTerritorialFactualContract
  -> shouldRunVisibleFactual
  -> runTerritorialFactualShadowPipeline
       -> serializeTerritorialFactualContract
       -> prompt selector + contrato + pregunta
       -> DeepSeek / chat.completions
       -> parse JSON
       -> validateStructuredFactualOutput
       -> renderFactualOutput
  -> assessVisibleFactualResult
  -> buildAnswerContract
  -> persistir mensaje assistant
  -> responder
```

El factual visible no utiliza corpus normativo ni RPC de recuperación. Primary/RAG solo aparece después si el factual no entrega una respuesta visible.

## 4. Opción A frente a Opción B

| Criterio | Opción A: selección + summary en una llamada | Opción B: selector validado + Composer |
|---|---|---|
| Seguridad | Acopla hechos y redacción. Un summary libre no puede validarse semánticamente de forma completa con reglas deterministas. | Separa autoridad factual y presentación. El Composer solo ve evidencia acotada y puede rechazarse sin perder el renderer actual. |
| Completitud | Puede repetir la omisión: el mismo modelo decide qué selecciona y qué resume. | Permite interponer una política determinista de cobertura antes del Composer. |
| Contaminación | La instrucción de redactar puede influir en la selección y favorecer una narrativa frente a hechos incómodos. | El selector conserva su responsabilidad actual; el Composer no puede alterar el contrato ni la validación factual. |
| Validación | Hay que validar operaciones y además intentar comprender texto libre. La segunda parte es intrínsecamente débil. | Puede validar un plan semántico con enums, refs y valores exactos. El texto visible puede renderizarse determinísticamente. |
| Latencia | No añade una segunda ida de red, aunque puede aumentar los tokens y la duración de la llamada ya lenta. | Añade una llamada secuencial, pero con DTO y output pequeños y un modelo rápido no razonador. |
| Fallback | Si falla la salida combinada, se pierde también la selección aunque las operaciones fueran aprovechables. | Si Composer falla, se conserva el resultado factual validado y su renderer actual. |
| Evolución | El schema factual queda mezclado con decisiones editoriales. | Permite versionar por separado evidencia, plan discursivo y renderers técnico/simplificado. |
| Informe de Parcela | Un summary único es poco reutilizable. | El mismo plan de claims/caveats/checks puede alimentar secciones y registros diferentes. |

### Conclusión de la comparación

La Opción A solo sería aceptable si `proposedSummary` no fuese texto, sino otro plan de claims completamente tipado. En ese punto seguiría conservando el problema de acoplar selección y composición, con un fallback peor. La Opción B ofrece una frontera de seguridad clara y es la recomendada.

## 5. Arquitectura recomendada

```text
pregunta
  -> selector factual actual
  -> validator factual actual
  -> política determinista de cobertura/materialidad
  -> EvidenceEnvelope canónico y validado
  -> Composer rápido (plan semántico JSON)
  -> ComposerSafety determinista
  -> renderer humano determinista
  -> safety final de integración
  -> persistencia visible

Si cualquier paso nuevo falla:
  -> factualRenderer actual
```

La política de cobertura es previa y obligatoria. Para una pregunta de homogeneidad sobre toda la parcela debe exigir:

- scope `parcel` exclusivamente;
- la categoría objetivo;
- todas las categorías del mismo scope con porcentaje positivo conocido;
- porcentajes exactos;
- predominio geométrico si se cumple;
- los estados `conflict`/`unresolved` materialmente ligados a la conclusión;
- classification solo cuando aporta identidad o un caveat material, no para duplicar estados sin valor explicativo.

La cobertura puede construir el envelope directamente desde facts resueltos del contrato. No debe copiar valores propuestos por el LLM: debe resolver cada `factRef` y tomar los valores canónicos. Así los hechos añadidos por completitud también quedan validados contra la única fuente factual.

## 6. Punto exacto de integración

El punto productivo es `src/app/api/chat/route.ts`, después de que `runTerritorialFactualShadowPipeline` devuelva un resultado `valid` y antes de persistir `answer`.

Secuencia recomendada:

1. conservar `factualResult.renderedText` como fallback inmutable;
2. aplicar la política de cobertura sobre `question + factualContract + structuredOutput`;
3. construir y validar `ComposerEvidenceEnvelope`;
4. llamar al Composer solo si el factual actual ya es elegible y el envelope está completo;
5. validar el `ComposerPlan`;
6. renderizar el plan;
7. utilizar el texto compuesto solo si todos los pasos pasan;
8. en cualquier fallo usar `factualResult.renderedText.join(...)`;
9. aplicar `buildAnswerContract`, persistir y responder igual que ahora.

No debe insertarse dentro de `factualValidator`, porque mezclaría verdad factual con estilo. Tampoco debe incorporarse a Primary, a los prompts normativos ni al RAG.

Conviene encapsularlo en una aplicación independiente, por ejemplo `application/parcel-context/reasoning-composer/`, y que `route.ts` solo orqueste.

## 7. DTO mínimo para el Composer

El DTO debe excluir identidad del expediente, referencias catastrales, geometrías, provenance libre, corpus normativo y cualquier chunk. Una forma mínima sería:

```ts
interface ComposerEvidenceEnvelope {
  schemaVersion: '1'
  question: string
  intent: {
    kind: 'identity' | 'distribution' | 'strict_homogeneity' | 'state_explanation'
    scope: 'parcel' | 'actionArea'
    targetCategoryCode?: string
  }
  facts: {
    classification?: ComposerFact
    categories: Array<ComposerCategoryFact>
  }
  requirements: {
    requiredFactRefs: ComposerFactRef[]
    materialStateRefs: ComposerFactRef[]
    allowedInferenceKinds: ComposerInferenceKind[]
  }
}

interface ComposerFact {
  ref: ComposerFactRef
  code?: string
  label?: string
  status: string
  determination: string
}

interface ComposerCategoryFact extends ComposerFact {
  parcelPercentage?: number
  geometricDominance: boolean
}
```

Para el caso real, el envelope incluiría SNRC 98,53, SNRT 1,47, predominio SNRC y los estados materiales. No incluiría causas supuestas del conflicto, dimensiones de la franja, normativa ni texto de evidencia.

Si en el futuro se necesitan candidates no aplanados, deben representarse con refs estables y los mismos campos canónicos; nunca como texto libre.

## 8. Output recomendado del Composer

No se recomienda este formato como output confiado:

```json
{
  "conclusion": "texto libre",
  "reasoning": ["texto libre"],
  "caveats": ["texto libre"],
  "recommendedChecks": ["texto libre"]
}
```

Aunque resulta natural, una regla determinista no puede demostrar que una paráfrasis arbitraria no introduce causalidad, consecuencias jurídicas o matices falsos.

Se recomienda un plan semántico:

```json
{
  "schemaVersion": "1",
  "verdict": "not_strictly_homogeneous",
  "claims": [
    { "kind": "category_share", "factRef": "category:parcel:SNRC" },
    { "kind": "geometric_dominance", "factRef": "category:parcel:SNRC" },
    { "kind": "minority_presence", "factRef": "category:parcel:SNRT" }
  ],
  "caveats": [
    { "kind": "conflict", "factRef": "category:parcel:SNRC" },
    { "kind": "unresolved_determination", "factRef": "category:parcel:SNRC" }
  ],
  "recommendedChecks": [
    { "kind": "verify_secondary_category_area", "factRef": "category:parcel:SNRT" }
  ],
  "register": "technical"
}
```

Los porcentajes, códigos y labels no tienen por qué repetirse en el output: el renderer los obtiene del envelope validado. Esto elimina deriva numérica. `register` puede seleccionar un renderer técnico o simplificado, pero no cambiar los hechos.

La naturalidad debe proceder de un renderer con microcopy bien diseñada y variaciones controladas, no de confiar texto jurídico libre. Si más adelante se permite un `draftText`, debe considerarse no confiable y nunca mostrarse sin una validación que, en la práctica, volvería a requerir otro modelo.

## 9. Safety determinista necesario

El nuevo `ComposerSafety` debe comprobar como mínimo:

1. schema estricto, versión conocida y rechazo de propiedades adicionales;
2. todos los `factRef` existen exactamente una vez en el envelope;
3. scope único y coincidente con la pregunta;
4. el conjunto `requiredFactRefs` está cubierto;
5. no aparecen códigos, labels o categorías ajenos;
6. los valores visibles se toman del envelope, nunca del output del Composer;
7. `geometric_dominance` solo es válido para porcentaje mayor de 50 y máximo del conjunto;
8. `minority_presence` solo es válido para porcentaje positivo inferior al dominante;
9. `not_strictly_homogeneous` es obligatorio si existe otra categoría con porcentaje positivo o si la categoría objetivo no alcanza 100;
10. nunca convertir 98,53 en 100 ni redondearlo semánticamente a «toda»;
11. nunca convertir predominio geométrico en estado `effective`;
12. conservar `conflict` y `unresolved` cuando estén en `materialStateRefs`;
13. no repetir caveats equivalentes sin necesidad;
14. `recommendedChecks` limitado a enums seguros; no admitir causas, soluciones técnicas concretas ni consecuencias jurídicas libres;
15. ninguna claim normativa si el envelope no admite explícitamente esa familia en una futura versión;
16. el renderer final no introduce números o nombres que no procedan del envelope.

La inferencia «1,47 % es minoritario» es verificable matemáticamente. El término «residual» debe definirse como descripción cuantitativa, nunca como irrelevancia jurídica. No debe inferirse ancho, forma, origen cartográfico ni solución del conflicto.

`responseSafety.ts` puede seguir construyendo el contrato de respuesta, pero no sustituye este safety semántico específico.

## 10. Fallback

El fallback debe ser local, determinista y sin nueva investigación:

- fallo de red o proveedor del Composer;
- timeout del Composer;
- JSON inválido;
- schema desconocido;
- refs o claims inválidas;
- cobertura incompleta;
- contradicción lógica;
- introducción de categorías o estados no autorizados;
- fallo del renderer del plan;

en todos esos casos se devuelve exactamente el texto del `factualRenderer` actual asociado al mismo `factualResult` validado.

No se debe llamar a Primary/RAG para reescribirlo. El intento del Composer y su rechazo deben ser observables, pero el log no debe contener pregunta, DTO ni texto completo.

## 11. Impacto estimado en latencia

La ejecución conocida consume:

- `totalMs`: 34.351 ms;
- `providerMs`: 34.151 ms;
- el proveedor factual representa aproximadamente el 99,4 % del tiempo factual.

Una segunda llamada siempre aumenta la latencia secuencial. Sin benchmark no puede darse una cifra garantizada. Para que la arquitectura sea aceptable, el Composer debería tener como objetivo aproximado:

- mediana de proveedor inferior a 1 segundo;
- p95 entre 2 y 3 segundos;
- output pequeño y reasoning desactivado;
- presupuesto propio corto, con fallback inmediato.

Con 0,5–2 segundos de Composer y safety local de pocos milisegundos, el total observado pasaría aproximadamente de 34,35 a 34,85–36,35 segundos. Un p95 de 3 segundos lo llevaría a unos 37,35 segundos.

Existe un riesgo operativo importante: `/api/chat` tiene un timeout general de 45 segundos y la llamada factual actual no recibe ese `AbortSignal`. La ejecución conocida deja unos 10,6 segundos nominales antes del timeout. Antes de activar el Composer de forma visible deben definirse cancelación y presupuesto de esta segunda llamada; este informe no propone cambiar ahora ningún timeout.

## 12. Impacto estimado en tokens y coste

La ejecución conocida usó 2.728 tokens de entrada y 4.394 de salida. Para nueve operaciones, 4.394 tokens de salida es una señal de que el endpoint/configuración puede estar consumiendo tokens de razonamiento aunque el texto JSON final sea pequeño. `shadowEvaluator.ts` no desactiva explícitamente `thinking`, mientras que la llamada Primary sí lo hace. Es una observación para benchmark, no una conclusión causal ni una propuesta de cambio en este bloque.

Un envelope específico del caso debería ocupar aproximadamente 1.500–2.500 caracteres. Sumando instrucciones y schema, el Composer podría mantenerse aproximadamente en:

- 800–1.400 tokens de entrada;
- 100–250 tokens de salida;
- 900–1.650 tokens totales.

Eso representa aproximadamente un 13–23 % del volumen total de tokens de la ejecución factual conocida. Con una clase de modelo pequeña y barata, el porcentaje de coste monetario debería ser menor que el porcentaje de tokens, pero debe medirse con tarifas y usage reales del proveedor seleccionado.

## 13. Modelo o clase de modelo recomendada

El Composer no necesita un modelo de razonamiento profundo. Necesita:

- baja latencia;
- seguimiento estricto de schema JSON;
- buena redacción en español indirectamente expresada como selección de un plan;
- temperatura 0;
- reasoning/thinking desactivado;
- límite de salida pequeño;
- soporte de cancelación y timeout por llamada;
- métricas de tokens y latencia.

La recomendación es una **clase small/mini/flash no razonadora con structured output**, accesible detrás de un adapter independiente. El primer benchmark debería realizarse con el endpoint más rápido del proveedor ya contratado, para evitar añadir transferencia de datos, credenciales y dependencia operativa. No se recomienda reutilizar sin medir la configuración factual que acaba de tardar 34 segundos.

Solo si el proveedor actual no cumple el SLO debería compararse un proveedor alternativo o un modelo pequeño alojado en la misma región. La decisión concreta debe basarse en un benchmark ciego con el corpus de casos de UrbanBrain, no en una elección nominal previa. Este bloque no cambia modelo ni proveedor.

## 14. Tests necesarios

### Cobertura factual

- La pregunta real de homogeneidad exige SNRC 98,53 y SNRT 1,47.
- Una selección LLM que omite SNRT se detecta como incompleta.
- No se mezclan `parcel` y `actionArea`.
- Una categoría con porcentaje cero sigue la política explícita definida; no se decide accidentalmente.
- Las categorías sin porcentaje no se inventan ni se eliminan si son materialmente relevantes.
- Classification se incluye cuando aporta identidad y no duplica estados irrelevantes.

### EvidenceEnvelope

- Solo copia valores resueltos del contrato.
- Rechaza refs inexistentes o ambiguas.
- No contiene identidad del expediente, geometría, provenance libre, corpus ni chunks.
- Mantiene labels parciales como parciales y nunca los completa.

### ComposerSafety

- Rechaza 98,53 transformado en 100.
- Rechaza «homogénea» cuando SNRT tiene porcentaje positivo.
- Rechaza dominance sobre una categoría no dominante.
- Rechaza `effective` para conflict/unresolved.
- Rechaza categorías, porcentajes, causas y parámetros normativos inventados.
- Rechaza omisión de SNRT y de estados materiales.
- Acepta `minority_presence` para 1,47 sin convertirlo en irrelevancia jurídica.
- Rechaza checks sobre Catastro desplazado, error cartográfico o IVG si esos hechos no existen.

### Renderer del plan

- Responde directamente a la pregunta antes de explicar.
- Menciona ambas categorías y porcentajes una sola vez.
- Distingue predominio geométrico de homogeneidad y efectividad.
- Conserva conflict/unresolved con lenguaje humano.
- Produce versiones técnica y simplificada semánticamente equivalentes.
- No introduce consecuencias jurídicas.

### Integración y fallback

- Composer válido reemplaza solo la presentación factual.
- Timeout, excepción, JSON inválido y safety reject usan el renderer factual actual.
- Nunca se llama a Primary/RAG para reescribir un factual validado.
- La persistencia guarda exactamente el texto finalmente mostrado.
- La instrumentación distingue `composerUsed`, `composerStatus`, `composerMs`, `composerFallbackReason` sin contenido sensible.
- El feature flag desactivado conserva byte a byte el comportamiento actual.

### Propiedades y regresión

- Tests parametrizados para porcentajes 0, 0,01, 49,99, 50, 50,01, 98,53 y 100.
- Tests con una, dos y más categorías.
- Tests de orden: cambiar el orden del contrato no cambia la conclusión.
- Tests hostiles de output con propiedades adicionales, instrucciones incrustadas y texto normativo.

## 15. Reutilización para Informe de Parcela

La separación propuesta permite reutilizar las piezas sin reutilizar una respuesta de chat:

- `EvidenceEnvelope` puede construirse por sección: identidad, parámetros, afecciones, discrepancias y estados.
- `ComposerPlan` puede añadir en futuras versiones tipos de claim específicos, siempre respaldados por refs canónicas.
- los renderers técnico y simplificado consumen el mismo plan validado;
- el Informe de Parcela puede agrupar planes por sección y conservar trazabilidad de cada claim;
- recomendaciones de comprobación se representan mediante enums y no mediante consejos libres;
- un formato de exportación puede mostrar fuentes/provenance mediante IDs resueltos fuera del Composer.

No debe diseñarse ahora un «summary universal». Es preferible versionar familias pequeñas de intent/claim con safety propio.

## 16. Riesgos

1. **Completitud falsa:** un Composer no puede recuperar SNRT si el evidence envelope no la contiene.
2. **Validación de texto libre:** prometer validación determinista plena de prosa arbitraria es una premisa falsa.
3. **Latencia acumulada:** una segunda red puede superar el presupuesto de 45 segundos en colas o picos.
4. **SLO del proveedor:** «flash» o «mini» no garantiza baja latencia en la configuración real.
5. **Materialidad:** decidir qué estados deben aparecer exige reglas explícitas por intent, no una heurística global.
6. **Lenguaje de residualidad:** «residual» debe significar solo cuantitativamente minoritario.
7. **Scope leakage:** el DTO debe bloquear mezcla de parcel/actionArea antes de llamar al modelo.
8. **Deriva de schemas:** envelope, plan y renderer necesitan versiones independientes y rechazo fail-closed.
9. **Duplicación futura:** añadir claims sin política de agrupación puede recrear la respuesta mecánica actual.
10. **Datos y proveedor:** un proveedor nuevo amplía el perímetro de tratamiento de la pregunta del usuario.
11. **Forense incompleto:** la telemetría actual no persiste la instantánea del contrato enviada en cada ejecución.

## 17. Plan de implementación por bloques pequeños

### Bloque 8D.1 — Completitud factual

- definir intents que requieren cobertura completa;
- implementar `requiredFactRefs` por scope;
- detectar la omisión SNRT antes del Composer;
- añadir tests del caso real;
- no cambiar renderer ni añadir segunda llamada todavía.

### Bloque 8D.2 — EvidenceEnvelope

- construir DTO canónico desde contrato + operaciones validadas;
- resolver valores exclusivamente mediante `resolveFactRef`;
- validar scope, cobertura, estados y ausencia de datos sensibles;
- tests unitarios y snapshots seguros.

### Bloque 8D.3 — Plan, safety y renderer sin LLM

- definir schema versionado de `ComposerPlan`;
- implementar `ComposerSafety`;
- implementar renderer técnico y fallback;
- alimentar manualmente planes de test, incluida la respuesta conceptual de Sada.

### Bloque 8D.4 — Adapter del Composer en shadow

- integrar un adapter de modelo rápido detrás de feature flag;
- reasoning desactivado, output limitado y presupuesto propio;
- medir latencia, tokens, rechazo y calidad;
- sin afectar respuesta visible.

### Bloque 8D.5 — Activación visible acotada

- habilitar solo intents ya cubiertos, comenzando por `strict_homogeneity`;
- insertar después del factual validado y antes de persistencia;
- fallback determinista obligatorio;
- canary y métricas de comparación con el renderer actual.

### Bloque 8D.6 — Extensión gradual

- añadir `distribution`, `state_explanation` e `identity` uno a uno;
- diseñar después familias separadas para parámetros y afecciones;
- reutilizar envelope/plan en Informe de Parcela únicamente tras estabilizar cada familia.

## Archivos principales implicados

- `src/app/api/chat/route.ts`
- `src/application/parcel-context/buildFactualContract.ts`
- `src/application/parcel-context/shadow/contractSerializer.ts`
- `src/application/parcel-context/shadow/shadowSystemPrompt.ts`
- `src/application/parcel-context/shadow/shadowEvaluator.ts`
- `src/application/parcel-context/shadow/shadowPipeline.ts`
- `src/application/parcel-context/shadow/factualValidator.ts`
- `src/application/parcel-context/shadow/factualRenderer.ts`
- `src/application/parcel-context/shadow/visibleFactualRouting.ts`
- `src/application/parcel-context/shadow/shadowIntegration.ts`
- `src/infrastructure/db/factualShadowEvaluationsRepository.ts`
- `src/infrastructure/db/schema/index.ts`

## Premisas corregidas o matizadas

- Un `summary` libre no puede validarse determinísticamente con garantías equivalentes a las operaciones actuales.
- `candidateCount: 2` no demuestra por sí solo que hubiera dos categories en el contrato.
- El Composer no debe ser la solución a la omisión de SNRT; esa omisión debe cerrarse en selección/cobertura antes de componer.
- Añadir una segunda llamada pequeña no garantiza baja latencia: debe medirse y respetar el timeout global existente.

## Alcance de esta auditoría

Se ha realizado inspección estática del repositorio y de sus pruebas. No se ha consultado producción, no se han ejecutado llamadas a proveedores, no se ha modificado código productivo y no se ha realizado commit, push ni deploy.
