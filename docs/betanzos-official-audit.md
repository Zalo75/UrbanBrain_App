# Piloto territorial de Betanzos — auditoría oficial

Versión del registro: `2026-07-14.1`

Fecha de comprobación: 14/07/2026

Código INE: `15009`

## Criterio de trabajo

Esta auditoría sólo utiliza fuentes públicas oficiales. Un expediente inventariado no se considera espacialmente aplicable por el mero hecho de existir. Una fecha reciente tampoco prueba por sí sola que un documento sustituya al planeamiento general.

Fuentes principales:

- [Estado del planeamiento municipal en SIOTUGA](https://siotuga.xunta.gal/siotuga/urb?lang=es_ES)
- [Inventario municipal de Betanzos en SIOTUGA](https://siotuga.xunta.gal/siotuga/inventario.php?inv=1&idconcello=15009)
- [WMS municipal oficial](https://siotuga.xunta.gal/siotuga/ws?codine=15009&SERVICE=WMS&REQUEST=GetCapabilities)
- [WFS municipal oficial](https://siotuga.xunta.gal/siotuga/ws?codine=15009&SERVICE=WFS&VERSION=1.1.0&REQUEST=GetCapabilities)
- [Directorio oficial de afecciones del Plan Básico Autonómico](https://ideg.xunta.gal/servizos/rest/services/PBA)
- [Servicio oficial de patrimonio cultural](https://ideg.xunta.gal/servizos/rest/services/PBA/Afeccions_PatrimonioCultural/MapServer)
- [Servicio oficial de medio ambiente](https://ideg.xunta.gal/servizos/rest/services/PBA/Afeccions_MedioAmbiente_CN/MapServer)
- [Servicio oficial de aguas](https://ideg.xunta.gal/servizos/rest/services/PBA/Afeccions_Augas/MapServer)
- [Servicio oficial de transporte](https://ideg.xunta.gal/servizos/rest/services/PBA/Afeccions_Transporte/MapServer)

## Planeamiento general verificado

SIOTUGA identifica como planeamiento general vigente las **Normas Subsidiarias de Planeamiento**, no adaptadas a la LOUG. El expediente oficial `22221` corresponde al «Texto refundido da revisión».

Fechas que deben mantenerse separadas:

| Hito                            | Fecha oficial inventariada |
| ------------------------------- | -------------------------: |
| Aprobación definitiva           |                 27/06/1996 |
| Publicación BOP                 |                 13/08/1996 |
| Texto refundido                 |                 28/11/1996 |
| Publicación DOG                 |                 17/01/1997 |
| Publicación de normativa en BOP |                 24/01/1997 |

El inventario registra una incidencia jurídica: acuerdo plenario de 03/11/2006 relativo a una finca litigiosa y a la aplicación del artículo 35.1 de las NSP. El resolver no generaliza esa decisión a otras parcelas.

Las NSP históricas de 1987 (`26373`) están registradas como **históricas**. Las modificaciones `23086` (1992) y `23087` (1989) son anteriores al texto refundido de 1996; sin evidencia adicional de incorporación, el registro no las aplica automáticamente al instrumento vigente.

## Modificaciones e instrumentos de desarrollo

El registro versionado contiene todos los expedientes devueltos por el inventario municipal consultado: siete entradas de planeamiento general/modificaciones, 37 instrumentos de desarrollo y una entrada histórica. Entre las modificaciones posteriores al texto refundido figuran:

- `22222`, nuevo vial de conexión en el polígono de Piadela (2001).
- `22224`, centro de salud en finca Carregal (2002).
- `22225`, UEI-4 Praza do Rollo (2004).
- `28550`, cambio de uso dotacional educativo a sanitario-asistencial (2023).

Entre los instrumentos de desarrollo relevantes están el Plan Especial del casco histórico (`23313`), los planes parciales de Piadela y Pasatempo, el Plan Parcial SAUI-5 (`23308`) y su modificación de 2020 (`28306`).

**Límite operativo:** SIOTUGA los inventaría y ofrece documentos, pero el servicio municipal consultado no publica una cobertura vectorial homogénea de sus ámbitos. Por ello quedan como `catalogued_pending_spatial_validation`, nunca como automáticamente aplicables a una parcela.

## Capas cartográficas y atributos

El WMS 1.3.0 declara EPSG:25829 y EPSG:4326, permite consulta de información y publica:

- límite del instrumento `22221`;
- índice de hojas de ordenación;
- ordenación pormenorizada como capa WMS/raster;
- clasificación del suelo.

El WFS 1.1.0 sólo expone el límite, el índice de hojas y la clasificación. La capa de clasificación `_15009_NNSSPP_199606_AD_3CLAS_22221` contiene 101 recintos y atributos como `cla_homo`, `cat_homo`, `cat_plan`, `denom`, `uso`, `estado` y `version`.

Distribución observada el 14/07/2026:

| Código homogéneo | Categoría | Recintos | Lectura segura                                                          |
| ---------------- | --------- | -------: | ----------------------------------------------------------------------- |
| `SU`             | `SUSC`    |        9 | Suelo urbano                                                            |
| `SNR`            | `SNRSC`   |       85 | Suelo de núcleo rural; `denom` identifica núcleos cuando está informado |
| `SR`             | `SRSC`    |        7 | Suelo rústico                                                           |

Los sufijos de categoría se conservan como códigos oficiales; UrbanBrain no les atribuye un significado jurídico más preciso sin una tabla oficial de correspondencias.

El eje del WFS 1.1 para EPSG:4326 fue comprobado contra recintos oficiales: el filtro BBOX usa latitud/longitud. La geometría GML se transforma internamente a longitud/latitud antes de evaluar punto-en-polígono o intersección parcelaria.

## Correspondencia cartografía–normativa

El expediente `22221` enlaza cinco partes de la normativa publicada en el BOP de 24/01/1997 y cinco documentos de normas urbanísticas. También incluye 20 hojas raster de ordenación municipal y nueve hojas de suelo urbano de Betanzos.

No se ha encontrado en los servicios oficiales consultados una clave vectorial que vincule inequívocamente cada recinto a una ordenanza y a artículos con parámetros urbanísticos. En consecuencia:

- se puede resolver automáticamente clasificación, categoría codificada y núcleo cuando los atributos y la geometría son coherentes;
- no se asigna automáticamente ordenanza, edificabilidad, ocupación, altura, retranqueo u otro parámetro;
- los documentos generales se citan como contexto, no como norma específica de una zona;
- una modificación o plan de desarrollo sólo se declara aplicable tras validación espacial y normativa.

## Afecciones oficiales cubiertas

El adaptador IDEG consulta por intersección, usando la parcela completa cuando está disponible:

- patrimonio cultural: áreas BIC, contornos, catálogo, planes especiales y Camino de Santiago;
- Red Natura 2000: ZEC;
- aguas: policía de cauces, dominio público hidráulico cartografiado y zonas de flujo preferente;
- transporte: dominio público viario y zonas de afección de carreteras autonómicas, áreas de carreteras estatales/provinciales y proyectos viarios aprobados. Los identificadores consultables se contrastaron contra la actualización de junio de 2026 del servicio.

Una respuesta vacía nunca se transforma en «ausencia de afecciones». La cobertura sigue siendo parcial: faltan, entre otras, comprobaciones completas de costas, ferrocarril, montes, energía, riesgos, servidumbres aeronáuticas y otras fuentes sectoriales. La detección positiva es evidencia; la no detección no es certificado negativo.

## Estados de salida

- `partial`: instrumento vigente y una clasificación compatible, pero sin ordenanza/modificaciones vinculadas inequívocamente.
- `conflict`: la parcela intersecta varias clasificaciones/categorías o varios núcleos incompatibles.
- `not_determined`: falta municipio o no existe evidencia suficiente.

`canAnswerConcreteParameters` permanece en `false` para el piloto mientras no exista vinculación oficial zona–normativa. Si sólo hay un punto, el resultado advierte que el resto de la parcela puede diferir.

## Validación humana requerida

Requieren comprobación técnica: selección de la hoja raster correcta, lectura de ordenanza, delimitación de modificación o plan de desarrollo, correspondencia con artículos, parcelas atravesadas por límites, discrepancias entre punto y geometría, vigencia material de instrumentos anteriores a 1996 y afecciones no cubiertas por los servicios automáticos.

No se ha creado ni ejecutado ninguna migración. El registro es código versionado y trazable; una futura persistencia en base de datos deberá diseñarse y migrarse en una tarea separada.

## Prueba posterior con una referencia real

Una referencia real no debe incorporarse a fixtures ni al historial de Git. Se proporciona una comprobación manual opt-in:

```powershell
$env:BETANZOS_TEST_CADASTRAL_REFERENCE='REFERENCIA_LOCAL'
npm run verify:betanzos:live
Remove-Item Env:BETANZOS_TEST_CADASTRAL_REFERENCE
```

El comando enmascara la referencia en la salida y sólo muestra estados, códigos territoriales y advertencias. No escribe en la base de datos. La variable debe mantenerse exclusivamente en el entorno local.
