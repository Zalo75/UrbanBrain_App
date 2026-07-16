# Resolver territorial de expedientes — Galicia

## Alcance y principio de seguridad

Esta entrega separa dos fases que no deben confundirse:

1. **Localización**: referencia catastral, coordenadas o dirección → parcela o punto normalizado.
2. **Aplicabilidad territorial**: localización ya resuelta → planeamiento y afecciones con evidencia.

El municipio nunca se usa como sustituto de una ordenanza, zona o ámbito. Una dirección ambigua no se convierte en parcela confirmada. Una consulta espacial sin resultados tampoco se interpreta como ausencia de afecciones.

La resolución persistente sólo recibe los datos del expediente cargado después de comprobar la pertenencia del usuario a su organización. La acción de previsualización exige autenticación y no persiste datos.

## Matriz de fuentes oficiales

| Fuente | Dato disponible | Acceso validado | Cobertura | Fiabilidad de uso | Integración actual | Limitaciones |
| --- | --- | --- | --- | --- | --- | --- |
| Dirección General del Catastro — WCF Callejero | Municipio, códigos territoriales y dirección por RC | REST/JSON `Consulta_DNPRC` | Territorio catastral común | Alta para identificación administrativa | Sí | Una RC de edificio puede devolver muchos inmuebles; se usa la RC de parcela (14 caracteres) y la dirección del centro catastral cuando existe. |
| Dirección General del Catastro — Coordenadas | Centro por RC y RC por punto | REST/JSON `Consulta_CPMRC` y `Consulta_RCCOOR`, EPSG:4326 | Territorio catastral común | Alta cuando el servicio devuelve resultado | Sí | Un punto próximo o situado en vial puede no devolver parcela. No se fuerza la parcela más cercana. |
| Catastro INSPIRE | Geometría oficial de parcela | WFS 2.0 `GetParcel` por `REFCAT` | Territorio catastral común | Alta, con precisión propia de la cartografía catastral | Sí | GML; puede no haber geometría o fallar de forma independiente. La ausencia activa el modo basado en punto. |
| IGN / CartoCiudad | Candidatos de dirección y dirección próxima a un punto | REST `candidates` y `reverseGeocode` | España; filtrada a Galicia (código CA 12) | Media para localizar; no acredita por sí sola una parcela | Sí | Candidatos no puntuales requieren una selección/consulta adicional. El reverse geocoder busca un portal o PK próximo, hasta 350 m según su documentación. |
| SIOTUGA | Inventario municipal, figura y fecha de aprobación, enlaces a inventario/WMS | Portal oficial e inventario municipal | Galicia | Alta como inventario oficial, sujeta a vigencia y modificaciones | No como consulta en vivo; sí mediante catálogo interno trazable | No se identificó un API estable documentado para consumir el inventario. Se evita scraping HTML. Los WMS deben registrarse y versionarse municipio a municipio. |
| IDEG / Xunta — REST ArcGIS | Intersecciones con capas territoriales | `MapServer/{layer}/query`, `esriSpatialRelIntersects` | Galicia | Alta para detectar una intersección en una capa concreta | Sí, cobertura inicial de patrimonio cultural | Las capas y fechas cambian. Cero resultados sólo significa “no detectado en las capas consultadas”, no “no afectado”. |
| IDEG / Xunta — WMS/OGC | PBA, costas, medio ambiente, transporte, aguas y otras afecciones | Directorio oficial WMS/REST | Galicia | Potencialmente alta tras validar capa, versión y semántica | Preparado mediante el puerto de afecciones; no activado salvo patrimonio | Un WMS de visualización no basta para una decisión espacial. Cada capa requiere contrato, pruebas y política de vigencia antes de activarse. |

Fuentes consultadas y contratos:

- Catastro, servicios web: <https://www.catastro.hacienda.gob.es/ayuda/servicios_web.htm>
- Catastro, ayuda WCF de coordenadas: <https://ovc.catastro.meh.es/OVCServWeb/OVCWcfCallejero/COVCCoordenadas.svc/json/help>
- Catastro, ayuda WCF de callejero: <https://ovc.catastro.meh.es/OVCServWeb/OVCWcfCallejero/COVCCallejero.svc/json/help>
- Catastro, servicios INSPIRE: <https://www.catastro.hacienda.gob.es/webinspire/index.html>
- Catastro, especificación WFS de parcelas: <https://www.catastro.hacienda.gob.es/webinspire/documentos/inspire-cp-WFS.pdf>
- CartoCiudad, servicios de geoprocesamiento: <https://www.cartociudad.es/web/portal/directorio-de-servicios/geoprocesamiento>
- SIOTUGA, situación del planeamiento: <https://siotuga.xunta.gal/siotuga/urb?lang=es_ES>
- IDEG, directorio oficial: <https://mapas.xunta.gal/es/coordinacion/servicios>
- IDEG, servicio PBA de patrimonio cultural: <https://ideg.xunta.gal/servizos/rest/services/PBA/Afeccions_PatrimonioCultural/MapServer>

El 13 de julio de 2026 se hicieron consultas exploratorias de sólo lectura y bajo volumen. Se validaron respuestas reales para una RC de A Coruña, el WFS `GetParcel`, candidatos y geocodificación inversa de CartoCiudad, y el catálogo REST de IDEG. Las pruebas automatizadas no dependen de estos servicios en vivo.

## Arquitectura

El dominio define un resultado independiente de Next.js y de proveedores:

- entrada priorizada: RC → coordenadas → dirección;
- estado: `confirmed`, `probable`, `ambiguous` o `unresolved`;
- confianza cualitativa;
- evidencia con fuente, URL, método y fecha de recuperación;
- avisos y conflictos por campo;
- geometría `MultiPolygon` EPSG:4326 cuando Catastro la proporciona;
- planeamiento y afecciones como resultados separados.

Los puertos `CatastroPort`, `GeocoderPort`, `PlanningPort` y `AffectPort` evitan acoplar el resolver a un servicio concreto. Los adaptadores oficiales tienen timeout y validación básica de forma. El orquestador degrada a un resultado no determinado ante caídas o respuestas inválidas.

### Flujo por referencia catastral

1. Normaliza separadores y acepta las longitudes oficiales de 14, 18 y 20 caracteres.
2. Usa los primeros 14 caracteres para identificar la parcela.
3. Consulta en paralelo datos administrativos, centro y geometría.
4. Conserva sólo datos con procedencia.
5. Compara, sin sobrescribir Catastro, las coordenadas, dirección y municipio declarados.
6. Ejecuta aplicabilidad sólo después de resolver la localización.

### Flujo por coordenadas

1. Valida WGS84 y la cobertura beta de Galicia.
2. Pregunta a Catastro por la parcela que contiene el punto.
3. Si obtiene RC, ejecuta el flujo preferente de RC.
4. Si no obtiene parcela o Catastro falla, usa CartoCiudad para contexto aproximado.
5. Sin parcela, el resultado queda `probable`, basado en punto y con abstención expresa sobre el resto de la parcela.

### Flujo por dirección

1. Solicita hasta cinco candidatos oficiales de CartoCiudad y filtra Galicia.
2. Cero candidatos: no resuelto. Más de uno: ambiguo. Un candidato sin coordenadas: ambiguo.
3. Un candidato puntual sigue siendo `probable`.
4. Sólo se eleva a `confirmed` cuando el candidato aporta RC y Catastro confirma esa parcela con evidencia.

## Planeamiento y afecciones reales

El planeamiento general sólo se considera determinado si el catálogo interno contiene exactamente un instrumento marcado como vigente, con código INE y URL de fuente. El catálogo actúa como registro trazable; esta entrega no extrae SIOTUGA mediante HTML ni infiere vigencia a partir del nombre del municipio.

La detección automática de afecciones activa inicialmente seis capas poligonales verificadas del servicio oficial PBA de patrimonio cultural: áreas BIC, contornos y amortiguamientos, contorno de catálogo, planes especiales y ámbito delimitado del Camino de Santiago. La consulta usa la geometría de parcela si existe y, en su defecto, el punto.

No se determina todavía de forma automática:

- clasificación, categoría, ordenanza o ámbito del PXOM/PXOU;
- vigencia consolidada de modificaciones de planeamiento;
- carreteras, aguas, costas, inundabilidad, Red Natura, montes, ferrocarril, aeropuertos y el resto de afecciones;
- ausencia de una afección, incluso en patrimonio cultural;
- cobertura de UI para crear expedientes en las cuatro provincias (el catálogo de formulario actual sigue siendo piloto de A Coruña).

## Persistencia e integración

No se añade ninguna tabla ni migración. El resultado resumido y el resultado trazable completo se guardan en `context_detections`, incluyendo si se obtuvo geometría y las fuentes consultadas. El contexto normativo del PR #2 consume el último resumen autorizado.

Esta rama está apilada sobre `agent/parcel-normative-context` (PR #2) e incorpora el commit de `agent/fix-chat-multitenancy` (PR #1) en su propia historia para resolver el solapamiento sin debilitar la seguridad. Los PR existentes no se modifican ni se cierran. El handler combinado mantiene:

- el guard centralizado y respuesta 404 del PR #1;
- la carga de contexto autorizada y el motor de aplicabilidad del PR #2;
- la prohibición de confiar en municipio enviado por el navegador.

## Riesgos y siguiente fase

- Los servicios oficiales no ofrecen un SLA de aplicación; los resultados deben mostrar fecha y avisos de indisponibilidad.
- Los identificadores y fechas de capas IDEG deben revisarse periódicamente. No hay caché compartida ni política de frescura persistente en esta entrega.
- Las consultas de afecciones se ejecutan en paralelo pero aumentan la latencia de creación del expediente.
- El catálogo de planeamiento necesita un proceso de ingestión oficial, versionado y revisión legal antes de determinar zonas.
- El siguiente incremento prioritario es un registro versionado de capas y planeamiento SIOTUGA/IDEG, empezando por un municipio piloto, con fixtures oficiales, validación espacial de parcela y revisión técnica del resultado.
