import polygonClipping from 'polygon-clipping';

import type {
  ClassificationCandidate,
  ClassificationDiscrepancy,
  ClassificationInstrumentTraceability,
  OfficialClassificationAttributes,
  ClassificationParcelCoverage,
  ClassificationSourcePort,
  ClassificationSourceResult,
  ClassificationSourceCheck,
  ParcelGeometry,
  PlanningApplicability,
  PlanningArea,
  PlanningPort,
  TerritorialCoordinates,
  TerritorialEvidence,
  TerritorialWarning,
} from '@/domain/territorial-resolver/types';
import { evaluateClassificationResolution } from '@/domain/territorial-resolver/classificationDecision';
import {
  fetchOfficial,
  isExternalServiceFailure,
  officialFailureKind,
  type FetchLike,
} from '@/infrastructure/territorial-resolver/officialHttp';
import {
  getSiotugaClassificationLayer,
  getSiotugaClassificationLayers,
  type SiotugaClassificationLayerRegistration,
} from '@/infrastructure/territorial-resolver/SiotugaClassificationRegistry';
import {
  discoverSiotugaResources,
  type SiotugaResourceCatalog,
} from './SiotugaResourceDiscovery'
import { geometrySurface } from '@/domain/territorial-resolver/parcelAccounting'

type Point = [lng: number, lat: number];

interface Polygon {
  exterior: Point[];
  interiors: Point[][];
}

interface Feature {
  id: string;
  enclosureId?: string;
  classificationCode: string;
  categoryCode?: string;
  legalClassificationCode?: string;
  legalCategoryCode?: string;
  planningCategoryCode?: string;
  denomination?: string;
  use?: string;
  geometryAreaSquareMetres?: number;
  status?: string;
  version?: string;
  polygons: Polygon[];
}

const WFS_URL = 'https://siotuga.xunta.gal/siotuga/ws';

function comparable(value?: string) {
  return value
    ?.normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLocaleLowerCase('es-ES')
    .replace(/[^a-z0-9]/g, '');
}

export function matchesRegisteredInstrument(
  planning: PlanningApplicability,
  layer: SiotugaClassificationLayerRegistration
) {
  const currentInstrument = planning.applicableInstruments?.find(
    (instrument) => instrument.status === 'current'
  );
  return (
    (planning.status === 'determined' || planning.status === 'partial') &&
    (currentInstrument?.id === layer.instrument.siotugaDocumentId ||
      comparable(planning.instrument) === comparable(layer.instrument.name)) &&
    planning.approvalDate?.slice(0, 10) === layer.instrument.approvalDate
  );
}

function xmlValue(fragment: string, tag: string) {
  const value = new RegExp(`<[^:>]+:${tag}>([^<]*)`, 'i').exec(fragment)?.[1];
  return value
    ?.replaceAll('&amp;', '&')
    .replaceAll('&lt;', '<')
    .replaceAll('&gt;', '>')
    .replaceAll('&quot;', '"')
    .replaceAll('&#39;', "'")
    .trim();
}

function numericXmlValue(fragment: string, tag: string) {
  const value = xmlValue(fragment, tag);
  if (!value) return undefined;
  const parsed = Number(value.replace(',', '.'));
  return Number.isFinite(parsed) ? parsed : undefined;
}

function parseRing(posList: string): Point[] {
  const values = posList.trim().split(/\s+/).map(Number).filter(Number.isFinite);
  const points: Point[] = [];
  for (let index = 0; index + 1 < values.length; index += 2) {
    // WFS 1.1 declara EPSG:4326 como latitud, longitud.
    points.push([values[index + 1], values[index]]);
  }
  return points;
}

export function parseSiotugaClassificationFeatures(xml: string): Feature[] {
  const features: Feature[] = [];
  for (const match of xml.matchAll(/<gml:featureMember>([\s\S]*?)<\/gml:featureMember>/gi)) {
    const fragment = match[1];
    const classificationCode = xmlValue(fragment, 'cla_homo');
    if (!classificationCode) continue;
    const polygons = [...fragment.matchAll(/<gml:Polygon[^>]*>([\s\S]*?)<\/gml:Polygon>/gi)]
      .map((polygonMatch): Polygon | undefined => {
        const polygon = polygonMatch[1];
        const exteriorMatch =
          /<gml:exterior>[\s\S]*?<gml:posList[^>]*>([\s\S]*?)<\/gml:posList>[\s\S]*?<\/gml:exterior>/i.exec(
            polygon
          );
        const exterior = exteriorMatch ? parseRing(exteriorMatch[1]) : [];
        if (exterior.length < 3) return undefined;
        const interiors = [
          ...polygon.matchAll(
            /<gml:interior>[\s\S]*?<gml:posList[^>]*>([\s\S]*?)<\/gml:posList>[\s\S]*?<\/gml:interior>/gi
          ),
        ]
          .map((ring) => parseRing(ring[1]))
          .filter((ring) => ring.length >= 3);
        return { exterior, interiors };
      })
      .filter((polygon): polygon is Polygon => Boolean(polygon));
    const enclosureId = xmlValue(fragment, 'id_recinto');
    features.push({
      id:
        /gml:id=["']([^"']+)["']/i.exec(fragment)?.[1] ??
        enclosureId ??
        'feature-without-id',
      enclosureId,
      classificationCode,
      categoryCode: xmlValue(fragment, 'cat_homo'),
      legalClassificationCode: xmlValue(fragment, 'cla_ley'),
      legalCategoryCode: xmlValue(fragment, 'cat_ley'),
      planningCategoryCode: xmlValue(fragment, 'cat_plan'),
      denomination: xmlValue(fragment, 'denom'),
      use: xmlValue(fragment, 'uso'),
      geometryAreaSquareMetres: numericXmlValue(fragment, 'geom_area'),
      status: xmlValue(fragment, 'estado'),
      version: xmlValue(fragment, 'version'),
      polygons,
    });
  }
  return features;
}

function orientation(a: Point, b: Point, c: Point) {
  const value = (b[1] - a[1]) * (c[0] - b[0]) - (b[0] - a[0]) * (c[1] - b[1]);
  if (Math.abs(value) < 1e-12) return 0;
  return value > 0 ? 1 : 2;
}

function onSegment(a: Point, b: Point, c: Point) {
  return (
    b[0] <= Math.max(a[0], c[0]) + 1e-12 &&
    b[0] >= Math.min(a[0], c[0]) - 1e-12 &&
    b[1] <= Math.max(a[1], c[1]) + 1e-12 &&
    b[1] >= Math.min(a[1], c[1]) - 1e-12
  );
}

function pointInRing(point: Point, ring: Point[]) {
  for (let index = 0; index < ring.length; index += 1) {
    const next = (index + 1) % ring.length;
    if (orientation(ring[index], point, ring[next]) === 0 && onSegment(ring[index], point, ring[next])) {
      return true;
    }
  }
  let inside = false;
  for (let current = 0, previous = ring.length - 1; current < ring.length; previous = current++) {
    const [x, y] = ring[current];
    const [previousX, previousY] = ring[previous];
    if (y > point[1] !== previousY > point[1] && point[0] < ((previousX - x) * (point[1] - y)) / (previousY - y) + x) inside = !inside;
  }
  return inside;
}

function pointInPolygon(point: Point, polygon: Polygon) {
  return pointInRing(point, polygon.exterior) && !polygon.interiors.some((ring) => pointInRing(point, ring));
}





function segmentsIntersect(a: Point, b: Point, c: Point, d: Point) {
  const o1 = orientation(a, b, c);
  const o2 = orientation(a, b, d);
  const o3 = orientation(c, d, a);
  const o4 = orientation(c, d, b);
  return (
    (o1 !== o2 && o3 !== o4) ||
    (o1 === 0 && onSegment(a, c, b)) ||
    (o2 === 0 && onSegment(a, d, b)) ||
    (o3 === 0 && onSegment(c, a, d)) ||
    (o4 === 0 && onSegment(c, b, d))
  );
}

function ringsIntersect(first: Point[], second: Point[]) {
  if (first.some((point) => pointInRing(point, second)) || second.some((point) => pointInRing(point, first))) return true;
  return first.some((point, index) =>
    second.some((other, otherIndex) =>
      segmentsIntersect(point, first[(index + 1) % first.length], other, second[(otherIndex + 1) % second.length])
    )
  );
}

function intersectsParcel(feature: Feature, geometry?: ParcelGeometry, coordinates?: TerritorialCoordinates) {
  const parcelRings = geometry?.coordinates.map((polygon) => polygon[0] as Point[]).filter(Boolean) ?? [];
  if (parcelRings.length) {
    return feature.polygons.some((polygon) =>
      parcelRings.some(
        (ring) =>
          ring.some((point) => pointInPolygon(point, polygon)) ||
          polygon.exterior.some((point) => pointInRing(point, ring)) ||
          ringsIntersect(polygon.exterior, ring)
      )
    );
  }
  return coordinates
    ? feature.polygons.some((polygon) => pointInPolygon([coordinates.lng, coordinates.lat], polygon))
    : false;
}

function boundingBox(geometry?: ParcelGeometry, coordinates?: TerritorialCoordinates) {
  const points = geometry
    ? geometry.coordinates.flatMap((polygon) => polygon.flatMap((ring) => ring.map(([lng, lat]) => [lng, lat] as Point)))
    : coordinates
      ? ([[coordinates.lng, coordinates.lat]] as Point[])
      : [];
  if (!points.length) return undefined;
  const lngs = points.map(([lng]) => lng);
  const lats = points.map(([, lat]) => lat);
  const padding = geometry ? 0.000001 : 0.00002;
  return { minLat: Math.min(...lats) - padding, minLng: Math.min(...lngs) - padding, maxLat: Math.max(...lats) + padding, maxLng: Math.max(...lngs) + padding };
}

function warning(code: string, message: string): TerritorialWarning {
  return { code, message };
}

function classificationLabel(code: string) {
  return ({ SU: 'Suelo urbano', SNR: 'Suelo de núcleo rural', SR: 'Suelo rústico' }[code] ?? `Clasificación oficial ${code}`);
}

export function categoryLabel(categoryCode?: string): string | undefined {
  if (!categoryCode) return undefined;
  const normalizedKey = categoryCode.toUpperCase().replace(/[^A-Z0-9]/g, '');
  const officialCategoryLabels: Record<string, string> = {
    SNRC: 'Núcleo rural común',
    SNRT: 'Núcleo rural tradicional',
    NR: 'Núcleo rural',
    NRC: 'Núcleo rural común',
    NRT: 'Núcleo rural tradicional',
    SUC: 'Suelo urbano consolidado',
    SUNC: 'Suelo urbano no consolidado',
    SUSC: 'Suelo urbano sin consolidar',
    SRO: 'Suelo rústico ordinario',
    SRP: 'Suelo rústico de protección',
    SRSC: 'Suelo rústico sin especial protección',
  };
  return officialCategoryLabels[normalizedKey] ?? `Categoría homogénea oficial ${categoryCode}`;
}

function normalizationStatus(code: string) {
  return ['SU', 'SNR', 'SR'].includes(code) ? ('mapped' as const) : ('unmapped' as const);
}

function traceability(
  planning: PlanningApplicability,
  layer: SiotugaClassificationLayerRegistration
): ClassificationInstrumentTraceability {
  if (layer.status === 'pending_traceability') return 'pending';
  return matchesRegisteredInstrument(planning, layer) ? 'verified' : 'mismatch';
}

function officialAttributes(feature: Feature): OfficialClassificationAttributes {
  return {
    sourceFeatureId: feature.id,
    enclosureId: feature.enclosureId,
    classificationCode: feature.classificationCode,
    categoryCode: feature.categoryCode,
    legalClassificationCode: feature.legalClassificationCode,
    legalCategoryCode: feature.legalCategoryCode,
    planningCategoryCode: feature.planningCategoryCode,
    denomination: feature.denomination,
    use: feature.use,
    geometryAreaSquareMetres: feature.geometryAreaSquareMetres,
    status: feature.status,
    version: feature.version,
  };
}

function matchesReviewScope(
  feature: Feature,
  scope: NonNullable<SiotugaClassificationLayerRegistration['reviewScopes']>[number]
) {
  return (
    scope.classificationCodes.includes(feature.classificationCode) &&
    (!scope.categoryCodes ||
      (feature.categoryCode !== undefined && scope.categoryCodes.includes(feature.categoryCode)))
  );
}

export class SiotugaClassificationAdapter implements PlanningPort {
  constructor(
    private readonly fallback: PlanningPort,
    private readonly fetcher: FetchLike = fetch,
    private readonly timeoutMs = 8_000,
    private readonly now: () => Date = () => new Date(),
    private readonly registeredLayer?: SiotugaClassificationLayerRegistration
  ) {}

  async findApplicablePlanning(location: {
    municipalityCode?: string;
    coordinates?: TerritorialCoordinates;
    geometry?: ParcelGeometry;
  }): Promise<PlanningApplicability> {
    const planning = await this.fallback.findApplicablePlanning(location);
    const layer = this.registeredLayer ?? getSiotugaClassificationLayer(location.municipalityCode);
    if (!layer) {
      return {
        ...planning,
        classificationResolution: evaluateClassificationResolution({
          candidates: [],
          sourceChecks: [],
          officialLinks: planning.sourceUrl
            ? [
                {
                  kind: 'planning_document',
                  label: 'Ver planeamiento oficial',
                  url: planning.sourceUrl,
                  source: 'siotuga',
                  scope: 'instrument',
                },
              ]
            : [],
          evidence: planning.evidence,
        }),
      };
    }

    const layerTraceability = traceability(planning, layer);
    const traceabilityWarnings = [
      ...(layer.status === 'pending_traceability'
        ? [
            warning(
              'planning_classification_pending_traceability',
              layer.note ??
                'La capa oficial todavía no está vinculada inequívocamente al instrumento vigente.'
            ),
          ]
        : []),
      ...(layer.status === 'active' && layerTraceability === 'mismatch'
        ? [
            warning(
              'planning_classification_instrument_mismatch',
              'La capa oficial no coincide de forma trazable con el instrumento vigente del catálogo.'
            ),
          ]
        : []),
    ];

    const bbox = boundingBox(location.geometry, location.coordinates);
    if (!bbox) {
      return {
        ...planning,
        classificationResolution: evaluateClassificationResolution({
          candidates: [],
          sourceChecks: [],
          officialLinks: [
            {
              kind: 'siotuga_viewer',
              label: 'Ver en SIOTUGA',
              url: layer.instrument.inventoryUrl,
              source: 'siotuga',
              scope: 'municipality',
            },
          ],
          evidence: planning.evidence,
        }),
        warnings: [
          ...planning.warnings,
          ...traceabilityWarnings,
          warning(
            'planning_geometry_missing',
            'Falta la geometría o el punto oficial para consultar la clasificación.'
          ),
        ],
      };
    }

    const retrievedAt = this.now().toISOString();
    const url = new URL(WFS_URL);
    url.search = new URLSearchParams({
      codine: layer.municipalityCode,
      SERVICE: 'WFS',
      VERSION: '1.1.0',
      REQUEST: 'GetFeature',
      TYPENAME: layer.layerName,
      MAXFEATURES: '1000',
      SRSNAME: 'EPSG:4326',
      BBOX: `${bbox.minLat},${bbox.minLng},${bbox.maxLat},${bbox.maxLng},EPSG:4326`,
    }).toString();

    let features: Feature[];
    let pointFeatures: Feature[] = [];
    try {
      const response = await fetchOfficial(this.fetcher, 'SIOTUGA WFS', url, this.timeoutMs);
      const allFeatures = parseSiotugaClassificationFeatures(await response.text());
      features = allFeatures.filter((feature) =>
        intersectsParcel(feature, location.geometry, location.coordinates)
      );
      if (location.geometry && location.coordinates) {
        pointFeatures = allFeatures.filter((feature) =>
          intersectsParcel(feature, undefined, location.coordinates)
        );
      }
    } catch (error) {
      const failure = officialFailureKind(error);
      const sourceCheck: ClassificationSourceCheck = {
        source: 'siotuga',
        status:
          failure === 'timeout'
            ? 'timeout'
            : failure === 'malformed'
              ? 'malformed'
              : 'unavailable',
        checkedAt: retrievedAt,
        message:
          'La capa oficial de clasificación no respondió. El instrumento documental se conserva y la clasificación queda pendiente.',
        requiredForAutomaticDecision: true,
      };
      return {
        ...planning,
        classification: undefined,
        classificationResolution: evaluateClassificationResolution({
          candidates: [],
          sourceChecks: [sourceCheck],
          officialLinks: [
            {
              kind: 'siotuga_viewer',
              label: 'Ver en SIOTUGA',
              url: layer.instrument.inventoryUrl,
              source: 'siotuga',
              scope: 'municipality',
            },
          ],
          evidence: planning.evidence,
        }),
        sourceChecks: [...(planning.sourceChecks ?? []), sourceCheck],
        warnings: [
          ...planning.warnings,
          ...traceabilityWarnings,
          warning(
            'planning_classification_unavailable',
            'La clasificación oficial no está disponible ahora; el instrumento documental se mantiene.'
          ),
        ],
      };
    }

    const groups = new Map<string, Feature[]>();
    for (const feature of features) {
      const key = `${feature.classificationCode}|${feature.categoryCode ?? ''}`;
      groups.set(key, [...(groups.get(key) ?? []), feature]);
    }
    const applicableReviewScopes = (layer.reviewScopes ?? []).filter((scope) =>
      features.some((feature) => matchesReviewScope(feature, scope))
    );
    const evidence: TerritorialEvidence[] = [
      ...planning.evidence,
      { source: 'siotuga', sourceUrl: layer.instrument.inventoryUrl, retrievedAt, method: `registro de capa ${layer.layerName} vinculado al documento SIOTUGA ${layer.instrument.siotugaDocumentId}`, scope: 'planning_classification' },
      { source: 'siotuga', sourceUrl: url.toString(), retrievedAt, method: location.geometry ? 'WFS BBOX e intersección local con geometría parcelaria EPSG:4326' : 'WFS BBOX y punto en polígono EPSG:4326', scope: 'planning_classification' },
      ...applicableReviewScopes.map((scope) => ({
        source: 'siotuga' as const,
        sourceUrl: scope.sourceUrl,
        retrievedAt,
        method: `control de vigencia del ámbito ${scope.id} frente al instrumento posterior SIOTUGA ${scope.instrumentId}`,
        scope: 'planning_classification' as const,
      })),
    ];
    const classificationSourceCheck: ClassificationSourceCheck = {
      source: 'siotuga',
      status: 'available',
      checkedAt: retrievedAt,
      message: 'SIOTUGA respondió correctamente para la capa registrada de clasificación.',
      requiredForAutomaticDecision: true,
    };
    const sourceChecks = [...(planning.sourceChecks ?? []), classificationSourceCheck];
    const evidenceBasis = location.geometry
      ? ('parcel_geometry' as const)
      : ('representative_point' as const);
    const candidates: ClassificationCandidate[] = [...groups.entries()].map(([key, matching]) => {
      const first = matching[0];
      const coverage = location.geometry
        ? parcelCoverage(location.geometry, matching, {
            municipalityCode: layer.municipalityCode,
            categoryCode: first.categoryCode ?? first.classificationCode,
          })
        : undefined;
      const areas: PlanningArea[] = [
        ...new Map(
          matching
            .filter((feature) => feature.denomination)
            .map((feature) => [feature.denomination!, feature])
        ).values(),
      ].map((feature) => ({
        type: feature.classificationCode === 'SNR' ? 'nucleus' : 'zone',
        name: feature.denomination!,
        sourceFeatureIds: [feature.id],
      }));
      return {
        id: `${layer.layerName}:${key}`,
        kind: 'official_classification',
        sourceKey: layer.layerName,
        classification: {
          code: first.classificationCode,
          categoryCode: first.categoryCode,
          label: classificationLabel(first.classificationCode),
          categoryLabel: categoryLabel(first.categoryCode),
          sourceFeatureIds: matching.map((feature) => feature.id),
        },
        areas,
        source: 'siotuga',
        evidence: evidence.filter((item) => item.scope === 'planning_classification'),
        confidence:
          layerTraceability === 'verified' && evidenceBasis === 'parcel_geometry'
            ? 'high'
            : 'medium',
        evidenceBasis,
        instrumentTraceability: layerTraceability,
        normalizationStatus: normalizationStatus(first.classificationCode),
        parcelCoverage: coverage,
        officialAttributes: matching.map(officialAttributes),
      };
    });

    if (location.geometry) {
      const complement = deriveComplementCandidate(
        location.geometry,
        candidates,
        layer.layerName,
        retrievedAt,
        layer.implicitBackgroundClassification
      );
      if (complement.candidate) {
        candidates.push(complement.candidate);
      }
      if (complement.evidence) {
        evidence.push(complement.evidence);
      }
    }

    const discrepancies: ClassificationDiscrepancy[] =
      layerTraceability === 'verified'
        ? []
        : [
            {
              reason:
                layerTraceability === 'pending'
                  ? 'instrument_traceability_pending'
                  : 'instrument_layer_mismatch',
              field: 'instrument',
              explanation:
                layer.note ??
                'La capa cartográfica no está vinculada inequívocamente al instrumento vigente.',
              assertions: candidates.filter((c) => c.kind === 'official_classification').map((candidate) => ({
                candidateId: candidate.id,
                value: layer.instrument.name,
                source: 'siotuga',
                evidence: candidate.evidence,
              })),
            },
          ];
    const unexpectedLayerFeatures = features.filter(
      (feature) =>
        (feature.status !== undefined && comparable(feature.status) !== 'alta') ||
        (feature.version !== undefined &&
          feature.version !== layer.instrument.siotugaDocumentId)
    );
    if (unexpectedLayerFeatures.length) {
      discrepancies.push({
        reason: 'instrument_layer_mismatch',
        field: 'instrument',
        explanation:
          'La respuesta WFS contiene recintos cuyo estado o versión no coincide con la capa registrada como activa.',
        assertions: candidates
          .filter((c) => c.kind === 'official_classification')
          .filter((candidate) =>
            candidate.officialAttributes?.some((attributes) =>
              unexpectedLayerFeatures.some(
                (feature) => feature.id === attributes.sourceFeatureId
              )
            )
          )
          .map((candidate) => ({
            candidateId: candidate.id,
            value: candidate.officialAttributes
              ?.map(
                (attributes) =>
                  `${attributes.enclosureId ?? attributes.sourceFeatureId}: estado ${attributes.status ?? '-'}, versión ${attributes.version ?? '-'}`
              )
              .join('; ') ?? 'Estado o versión no coincidente',
            source: 'siotuga',
            evidence: candidate.evidence,
          })),
      });
    }
    for (const scope of applicableReviewScopes) {
      const affectedCandidates = candidates.filter((candidate) =>
        candidate.kind === 'official_classification' &&
        candidate.officialAttributes?.some(
          (attributes) =>
            scope.classificationCodes.includes(attributes.classificationCode) &&
            (!scope.categoryCodes ||
              (attributes.categoryCode !== undefined &&
                scope.categoryCodes.includes(attributes.categoryCode)))
        )
      );
      discrepancies.push({
        reason: 'planning_update_scope_pending',
        field: 'instrument',
        explanation: scope.explanation,
        assertions: affectedCandidates.map((candidate) => ({
          candidateId: candidate.id,
          value: `${candidate.kind === 'official_classification' ? candidate.classification.code : ''}/${candidate.kind === 'official_classification' ? (candidate.classification.categoryCode ?? '-') : ''}; revisar ${scope.name} (${scope.instrumentId})`,
          source: 'siotuga',
          evidence: candidate.evidence,
        })),
      });
    }
    if (location.geometry && !layer.implicitBackgroundClassification) {
      const totalCoverage = parcelCoverage(location.geometry, features);
      if (!totalCoverage) {
        discrepancies.push({
          reason: 'insufficient_geometry',
          field: 'coverage',
          explanation:
            'No se pudo calcular de forma fiable la superficie intersectada por los recintos oficiales.',
          assertions: candidates.filter((c) => c.kind === 'official_classification').map((candidate) => ({
            candidateId: candidate.id,
            value: candidate.kind === 'official_classification' ? `${candidate.classification.code}/${candidate.classification.categoryCode ?? '-'}` : '',
            source: 'siotuga',
            evidence: candidate.evidence,
          })),
        });
      } else if (totalCoverage.parcelPercentage < COMPLETE_PARCEL_PERCENTAGE) {
        discrepancies.push({
          reason: 'partial_parcel_coverage',
          field: 'coverage',
          explanation:
            'Los recintos de clasificación devueltos por la capa oficial sólo cubren una parte de la parcela; el resto queda sin clasificación estructurada.',
          assertions: [
            ...candidates.filter((c) => c.kind === 'official_classification').map((candidate) => ({
              candidateId: candidate.id,
              value: candidate.kind === 'official_classification' ? `${candidate.classification.code}/${candidate.classification.categoryCode ?? '-'}: ${candidate.parcelCoverage?.intersectionAreaSquareMetres ?? 0} m² (${candidate.parcelCoverage?.parcelPercentage ?? 0} % de la parcela)` : '',
              source: 'siotuga' as const,
              evidence: candidate.evidence,
            })),
            {
              value: `${round(100 - totalCoverage.parcelPercentage, 2)} % sin clasificación estructurada`,
              source: 'siotuga',
              evidence: evidence.filter((item) => item.scope === 'planning_classification'),
            },
          ],
        });
      }
    }
    if (location.geometry && location.coordinates) {
      const geometryCodes = [...groups.keys()].sort();
      const pointCodes = [
        ...new Set(
          pointFeatures.map(
            (feature) => `${feature.classificationCode}|${feature.categoryCode ?? ''}`
          )
        ),
      ].sort();
      if (geometryCodes.join(',') !== pointCodes.join(',')) {
        discrepancies.push({
          reason: 'point_geometry_mismatch',
          field: 'classification',
          explanation:
            'La clasificación obtenida con el punto no coincide con las clases intersectadas por la geometría completa de la parcela.',
          assertions: [
            ...candidates.filter((c) => c.kind === 'official_classification').map((candidate) => ({
              candidateId: candidate.id,
              value: candidate.kind === 'official_classification' ? `${candidate.classification.code}/${candidate.classification.categoryCode ?? '-'}` : '',
              source: 'siotuga' as const,
              evidence: candidate.evidence,
            })),
            {
              value: pointCodes.length ? pointCodes.join(', ') : 'Sin resultado para el punto',
              source: 'siotuga',
              evidence: evidence.filter((item) => item.scope === 'planning_classification'),
            },
          ],
        });
      }
    }
    const classificationResolution = evaluateClassificationResolution({
      candidates,
      discrepancies,
      sourceChecks: [classificationSourceCheck],
      officialLinks: [
        {
          kind: 'siotuga_viewer',
          label: 'Ver en SIOTUGA',
          url: layer.instrument.inventoryUrl,
          source: 'siotuga',
          scope: 'municipality',
        },
        {
          kind: 'official_map',
          label: 'Consultar capa oficial',
          url: layer.source.wfsCapabilitiesUrl,
          source: 'siotuga',
          scope: 'layer',
        },
        ...applicableReviewScopes.map((scope) => ({
          kind: 'planning_document' as const,
          label: `Revisar ${scope.name}`,
          url: scope.sourceUrl,
          source: 'siotuga' as const,
          scope: 'instrument' as const,
        })),
      ],
      evidence,
    });
    const selectedCandidate = classificationResolution.automaticSelection
      ? candidates.find(
          (candidate) => candidate.id === classificationResolution.automaticSelection?.candidateId
        )
      : undefined;
    const implicitBackgroundAccredited = Boolean(
      classificationResolution.status === 'clear' &&
      selectedCandidate?.kind === 'official_classification' &&
      selectedCandidate.evidenceBasis === 'implicit_planning_background'
    );
    const reconciledPlanningWarnings = implicitBackgroundAccredited
      ? planning.warnings.filter((item) => item.code !== 'planning_classification_not_found')
      : planning.warnings;
    const areas = candidates.flatMap((candidate) => candidate.areas);
    return {
      ...planning,
      classification: selectedCandidate?.kind === 'official_classification' ? selectedCandidate.classification : undefined,
      classificationResolution,
      areas: areas.length ? areas : planning.areas,
      evidence,
      sourceChecks,
      warnings: [
        ...reconciledPlanningWarnings,
        ...traceabilityWarnings,
        ...applicableReviewScopes.map((scope) =>
          warning('planning_classification_update_scope_pending', scope.explanation)
        ),
        ...(features.length || implicitBackgroundAccredited
          ? []
          : [
              warning(
                'planning_classification_not_found',
                'La capa oficial no devolvió clasificación para la geometría consultada.'
              ),
            ]),
      ],
    };
  }
}

const COMPLETE_PARCEL_PERCENTAGE = 99.5;
const GEOMETRY_EPSILON = 1e-7;

function round(value: number, decimals: number) {
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
}

function parcelCoverage(
  geometry: ParcelGeometry,
  features: Feature[],
  context?: { municipalityCode?: string; categoryCode?: string }
): ClassificationParcelCoverage | undefined {
  const intersectionGeometry = computeValidatedIntersectionGeometry(
    geometry,
    features,
    context
  );
  if (!intersectionGeometry) return undefined;

  const parcelArea = geometrySurface(geometry);
  const intersectionArea = geometrySurface(intersectionGeometry);
  if (!parcelArea || !intersectionArea || intersectionArea <= GEOMETRY_EPSILON) return undefined;
  const boundedIntersectionArea = Math.min(parcelArea, intersectionArea);
  const referenceIntersectionArea = round(boundedIntersectionArea, 2);

  return {
    parcelAreaSquareMetres: round(parcelArea, 2),
    intersectionAreaSquareMetres: referenceIntersectionArea,
    parcelPercentage: round((boundedIntersectionArea / parcelArea) * 100, 2),
    method: 'polygon_intersection',
    intersectionGeometry,
  };
}

function cleanRing(ring: [number, number][]): [number, number][] | undefined {
  if (!ring || ring.length < 3) return undefined;
  const cleaned: [number, number][] = [];
  for (const pt of ring) {
    if (!pt || !Number.isFinite(pt[0]) || !Number.isFinite(pt[1])) continue;
    if (
      cleaned.length > 0 &&
      cleaned[cleaned.length - 1][0] === pt[0] &&
      cleaned[cleaned.length - 1][1] === pt[1]
    ) {
      continue;
    }
    cleaned.push([pt[0], pt[1]]);
  }
  if (cleaned.length < 3) return undefined;
  const first = cleaned[0];
  const last = cleaned[cleaned.length - 1];
  if (first[0] !== last[0] || first[1] !== last[1]) {
    cleaned.push([first[0], first[1]]);
  }
  return cleaned.length >= 4 ? cleaned : undefined;
}

function cleanPolygon(polygon: [number, number][][]): [number, number][][] | undefined {
  const exterior = cleanRing(polygon[0]);
  if (!exterior) return undefined;
  const interiors: [number, number][][] = [];
  for (let i = 1; i < polygon.length; i += 1) {
    const hole = cleanRing(polygon[i]);
    if (hole) interiors.push(hole);
  }
  return [exterior, ...interiors];
}

function computeValidatedIntersectionGeometry(
  parcelGeometry: ParcelGeometry,
  features: Feature[],
  context?: { municipalityCode?: string; categoryCode?: string }
): ParcelGeometry | undefined {
  try {
    const parcelPolys: [number, number][][][] = [];
    for (const poly of parcelGeometry.coordinates) {
      const cleaned = cleanPolygon(poly as [number, number][][]);
      if (cleaned) parcelPolys.push(cleaned);
    }
    if (!parcelPolys.length) return undefined;

    const featurePolys: [number, number][][][] = [];
    for (const feature of features) {
      for (const poly of feature.polygons) {
        const rawCoords: [number, number][][] = [
          poly.exterior,
          ...(poly.interiors ?? []),
        ];
        const cleaned = cleanPolygon(rawCoords);
        if (cleaned) featurePolys.push(cleaned);
      }
    }
    if (!featurePolys.length) return undefined;

    const clipped = polygonClipping.intersection(parcelPolys, featurePolys);
    if (!clipped || !clipped.length) return undefined;

    const outputCoords: [number, number][][][] = [];
    for (const poly of clipped) {
      const cleaned = cleanPolygon(poly as unknown as [number, number][][]);
      if (cleaned) outputCoords.push(cleaned);
    }
    if (!outputCoords.length) return undefined;

    const candidateGeometry: ParcelGeometry = {
      type: 'MultiPolygon',
      coordinates: outputCoords,
      crs: 'EPSG:4326',
    };
    const computedArea = geometrySurface(candidateGeometry);
    if (!computedArea || computedArea <= GEOMETRY_EPSILON) return undefined;

    return candidateGeometry;
  } catch (err) {
    console.warn('[SIOTUGA_GEOMETRY_INTERSECTION_FAILED]', {
      municipalityCode: context?.municipalityCode,
      categoryCode: context?.categoryCode,
      error: err instanceof Error ? err.message : String(err),
    });
    return undefined;
  }
}

function deriveComplementCandidate(
  geometry: ParcelGeometry,
  candidates: ClassificationCandidate[],
  layerName: string,
  retrievedAt: string,
  implicitBackground?: SiotugaClassificationLayerRegistration['implicitBackgroundClassification']
): { candidate?: ClassificationCandidate; evidence?: TerritorialEvidence } {
  try {
    const parcelPolys: [number, number][][][] = [];
    for (const poly of geometry.coordinates) {
      const cleaned = cleanPolygon(poly as [number, number][][]);
      if (cleaned) parcelPolys.push(cleaned);
    }
    if (!parcelPolys.length) return {};

    const intersectionPolys: [number, number][][][] = [];
    for (const candidate of candidates) {
      if (candidate.kind === 'official_classification' && candidate.parcelCoverage?.intersectionGeometry) {
        for (const poly of candidate.parcelCoverage.intersectionGeometry.coordinates) {
          const cleaned = cleanPolygon(poly as [number, number][][]);
          if (cleaned) intersectionPolys.push(cleaned);
        }
      }
    }
    if (!intersectionPolys.length && !implicitBackground) return {};

    const clipped = intersectionPolys.length > 0
      ? polygonClipping.difference(parcelPolys, intersectionPolys)
      : parcelPolys;

    if (!clipped || !clipped.length) return {};

    const outputCoords: [number, number][][][] = [];
    for (const poly of clipped) {
      const cleaned = cleanPolygon(poly as unknown as [number, number][][]);
      if (cleaned) outputCoords.push(cleaned);
    }
    if (!outputCoords.length) return {};

    const complementGeometry: ParcelGeometry = {
      type: 'MultiPolygon',
      coordinates: outputCoords,
      crs: 'EPSG:4326',
    };

    const computedArea = geometrySurface(complementGeometry);
    if (!computedArea) return {};
    const roundedArea = round(computedArea, 2);

    if (roundedArea >= 1.0) {
      const parcelArea = candidates.length > 0
        ? (candidates[0].parcelCoverage?.parcelAreaSquareMetres ?? roundedArea)
        : roundedArea;
      const coverage: ClassificationParcelCoverage = {
        parcelAreaSquareMetres: parcelArea,
        intersectionAreaSquareMetres: roundedArea,
        parcelPercentage: parcelArea > 0 ? round((roundedArea / parcelArea) * 100, 2) : 0,
        method: 'polygon_intersection',
        intersectionGeometry: complementGeometry,
      };

      if (implicitBackground) {
        return {
          candidate: {
            id: `${layerName}:implicit_background`,
            kind: 'official_classification',
            sourceKey: layerName,
            classification: {
              code: implicitBackground.classificationCode,
              label: classificationLabel(implicitBackground.classificationCode),
              sourceFeatureIds: [],
            },
            areas: [],
            source: 'siotuga',
            evidence: [
              {
                source: 'siotuga',
                sourceUrl: '',
                retrievedAt,
                method: implicitBackground.legalBasis ?? 'clasificación implícita por defecto',
                scope: 'planning_classification',
              },
            ],
            confidence: 'high',
            evidenceBasis: implicitBackground.evidenceBasis,
            instrumentTraceability: 'verified',
            normalizationStatus: 'mapped',
            parcelCoverage: coverage,
          },
        };
      }

      return {
        candidate: {
          id: `${layerName}:derived_complement`,
          kind: 'derived_unmapped_complement',
          source: 'derived_geometry_complement',
          areas: [],
          evidence: [],
          confidence: 'unknown',
          evidenceBasis: 'parcel_geometry',
          instrumentTraceability: 'pending',
          normalizationStatus: 'unmapped',
          parcelCoverage: coverage,
        },
      };
    } else if (roundedArea > 0) {
      return {
        evidence: {
          source: 'urbanbrain',
          sourceUrl: '',
          retrievedAt,
          method: `residuo geométrico sin cobertura de ${roundedArea} m² descartado por ser inferior a 1 m²`,
          scope: 'planning_classification',
        },
      };
    }
    return {};
  } catch (err) {
    console.warn('[SIOTUGA_COMPLEMENT_CALCULATION_FAILED]', {
      error: err instanceof Error ? err.message : String(err),
    });
    return {};
  }
}


/**
 * Fuente SIOTUGA para el agregador multi-fuente. Consulta todas las capas
 * compatibles registradas y devuelve evidencias; la decisión final se realiza
 * exclusivamente en MultiSourceClassificationResolver.
 */
export class SiotugaClassificationSourceAdapter implements ClassificationSourcePort {
  constructor(
    private readonly fetcher: FetchLike = fetch,
    private readonly timeoutMs = 8_000,
    private readonly now: () => Date = () => new Date()
  ) {}

  async findClassifications(
    planning: PlanningApplicability,
    location: {
      municipalityCode?: string;
      coordinates?: TerritorialCoordinates;
      geometry?: ParcelGeometry;
    }
  ): Promise<ClassificationSourceResult> {
    const startedAt = Date.now()
    let layers = getSiotugaClassificationLayers(location.municipalityCode);
    console.log('UB-DIAG siotuga-classification-start', JSON.stringify({ municipalityCode: location.municipalityCode ?? null, registeredLayerCount: layers.length }))
    let discoveredResources: SiotugaResourceCatalog | undefined
    if (layers.length === 0) {
      try {
        const discovered = await discoverSiotugaResources(
          location.municipalityCode,
          planning,
          this.fetcher,
          this.timeoutMs
        )
        discoveredResources = discovered.catalog
        if (discoveredResources?.classificationLayer) {
          const instrument = discoveredResources.instrument
          layers = [{
            municipalityCode: discoveredResources.municipalityCode,
            municipalityName: planning.instrument ?? discoveredResources.municipalityCode,
            layerName: discoveredResources.classificationLayer,
            status: 'active',
            instrument: {
              siotugaDocumentId: instrument.id,
              name: instrument.name,
              approvalDate: instrument.approvalDate ?? planning.approvalDate ?? '',
              inventoryUrl: instrument.sourceUrl,
            },
            source: {
              provider: 'siotuga',
              wfsCapabilitiesUrl: discoveredResources.capabilities.wfs,
              verifiedAt: this.now().toISOString().slice(0, 10),
            },
          }]
        }
      } catch (err) {
        console.log('UB-DIAG siotuga-classification-discovery-error', JSON.stringify({ municipalityCode: location.municipalityCode ?? null, error: err instanceof Error ? err.name : 'unknown', durationMs: Date.now() - startedAt }))
        if (!isExternalServiceFailure(err)) throw err
      }
    }
    const resources = discoveredResources ? {
      municipalityCode: discoveredResources.municipalityCode,
      instrumentId: discoveredResources.instrument.id,
      source: 'siotuga' as const,
      classificationLayer: discoveredResources.classificationLayer,
      detailedPlanningLayer: discoveredResources.detailedPlanningLayer,
      planningTileIndex: discoveredResources.planningTileIndex,
      boundaryLayer: discoveredResources.boundaryLayer,
      wfsCapabilitiesUrl: discoveredResources.capabilities.wfs,
      wmsCapabilitiesUrl: discoveredResources.capabilities.wms,
    } : undefined
    if (layers.length === 0) {
      console.log('UB-DIAG siotuga-classification-result', JSON.stringify({ municipalityCode: location.municipalityCode ?? null, status: 'no_layer', resources: Boolean(resources), durationMs: Date.now() - startedAt }))
      return {
        candidates: [],
        discrepancies: [],
        sourceChecks: [],
        officialLinks: planning.sourceUrl
          ? [{
              kind: 'planning_document',
              label: 'Ver planeamiento oficial',
              url: planning.sourceUrl,
              source: 'siotuga',
              scope: 'instrument',
            }]
          : [],
        evidence: [],
        warnings: [],
        resources,
      };
    }

    const fallback: PlanningPort = {
      findApplicablePlanning: async () => planning,
    };
    const results = await Promise.all(
      layers.map((layer) =>
        new SiotugaClassificationAdapter(
          fallback,
          this.fetcher,
          this.timeoutMs,
          this.now,
          layer
        ).findApplicablePlanning(location)
      )
    );

    const candidates = results.flatMap(
      (result) => result.classificationResolution?.candidates ?? []
    );
    const discrepancies = results.flatMap(
      (result) => result.classificationResolution?.discrepancies ?? []
    );
    const sourceChecks = results.flatMap(
      (result) => result.classificationResolution?.sourceChecks ?? []
    );
    const officialLinks = [
      ...new Map(
        results
          .flatMap((result) => result.classificationResolution?.officialLinks ?? [])
          .map((link) => [`${link.kind}|${link.url}`, link])
      ).values(),
    ];
    const evidence = [
      ...new Map(
        results
          .flatMap((result) => result.classificationResolution?.evidence ?? [])
          .filter((item) => item.scope === 'planning_classification')
          .map((item) => [`${item.source}|${item.sourceUrl}|${item.method}`, item])
      ).values(),
    ];
    const warnings = [
      ...new Map(
        results
          .flatMap((result) => result.warnings)
          .filter((item) => item.code.startsWith('planning_'))
          .map((item) => [`${item.code}|${item.message}`, item])
      ).values(),
    ];

    console.log('UB-DIAG siotuga-classification-result', JSON.stringify({ municipalityCode: location.municipalityCode ?? null, status: candidates.length ? 'candidates' : 'no_candidates', layerCount: layers.length, candidateCount: candidates.length, sourceCheckCount: sourceChecks.length, durationMs: Date.now() - startedAt }))
    return {
      candidates,
      discrepancies,
      sourceChecks,
      officialLinks,
      evidence,
      warnings,
      resources,
    };
  }
}


