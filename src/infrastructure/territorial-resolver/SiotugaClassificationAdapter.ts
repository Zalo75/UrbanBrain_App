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
  officialFailureKind,
  type FetchLike,
} from '@/infrastructure/territorial-resolver/officialHttp';
import {
  getSiotugaClassificationLayer,
  getSiotugaClassificationLayers,
  type SiotugaClassificationLayerRegistration,
} from '@/infrastructure/territorial-resolver/SiotugaClassificationRegistry';

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
        ? parcelCoverage(location.geometry, matching)
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
        sourceKey: layer.layerName,
        classification: {
          code: first.classificationCode,
          categoryCode: first.categoryCode,
          label: classificationLabel(first.classificationCode),
          categoryLabel: first.categoryCode
            ? `Categoría homogénea oficial ${first.categoryCode}`
            : undefined,
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
              assertions: candidates.map((candidate) => ({
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
          value: `${candidate.classification.code}/${candidate.classification.categoryCode ?? '-'}; revisar ${scope.name} (${scope.instrumentId})`,
          source: 'siotuga',
          evidence: candidate.evidence,
        })),
      });
    }
    if (location.geometry) {
      const totalCoverage = parcelCoverage(location.geometry, features);
      if (!totalCoverage) {
        discrepancies.push({
          reason: 'insufficient_geometry',
          field: 'coverage',
          explanation:
            'No se pudo calcular de forma fiable la superficie intersectada por los recintos oficiales.',
          assertions: candidates.map((candidate) => ({
            candidateId: candidate.id,
            value: `${candidate.classification.code}/${candidate.classification.categoryCode ?? '-'}`,
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
            ...candidates.map((candidate) => ({
              candidateId: candidate.id,
              value: `${candidate.classification.code}/${candidate.classification.categoryCode ?? '-'}: ${candidate.parcelCoverage?.intersectionAreaSquareMetres ?? 0} m² (${candidate.parcelCoverage?.parcelPercentage ?? 0} % de la parcela)`,
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
            ...candidates.map((candidate) => ({
              candidateId: candidate.id,
              value: `${candidate.classification.code}/${candidate.classification.categoryCode ?? '-'}`,
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
    const areas = candidates.flatMap((candidate) => candidate.areas);
    return {
      ...planning,
      classification: selectedCandidate?.classification,
      classificationResolution,
      areas: areas.length ? areas : planning.areas,
      evidence,
      sourceChecks,
      warnings: [
        ...planning.warnings,
        ...traceabilityWarnings,
        ...applicableReviewScopes.map((scope) =>
          warning('planning_classification_update_scope_pending', scope.explanation)
        ),
        ...(features.length
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

type MetricPoint = [x: number, y: number];

interface MetricPolygon {
  exterior: MetricPoint[];
  interiors: MetricPoint[][];
}

interface Triangle {
  points: [MetricPoint, MetricPoint, MetricPoint];
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

const EARTH_RADIUS_METRES = 6_371_008.8;
const COMPLETE_PARCEL_PERCENTAGE = 99.5;
const GEOMETRY_EPSILON = 1e-7;

function cross(a: MetricPoint, b: MetricPoint, c: MetricPoint) {
  return (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
}

function signedRingArea(ring: MetricPoint[]) {
  return ring.reduce((area, point, index) => {
    const next = ring[(index + 1) % ring.length];
    return area + point[0] * next[1] - next[0] * point[1];
  }, 0) / 2;
}

function sameMetricPoint(left: MetricPoint, right: MetricPoint) {
  return (
    Math.abs(left[0] - right[0]) <= GEOMETRY_EPSILON &&
    Math.abs(left[1] - right[1]) <= GEOMETRY_EPSILON
  );
}

function cleanMetricRing(ring: MetricPoint[]) {
  const withoutDuplicates = ring.filter(
    (point, index) => index === 0 || !sameMetricPoint(point, ring[index - 1])
  );
  if (
    withoutDuplicates.length > 1 &&
    sameMetricPoint(withoutDuplicates[0], withoutDuplicates.at(-1)!)
  ) {
    withoutDuplicates.pop();
  }

  let cleaned = withoutDuplicates;
  let changed = true;
  while (changed && cleaned.length > 3) {
    changed = false;
    cleaned = cleaned.filter((point, index, points) => {
      const previous = points[(index - 1 + points.length) % points.length];
      const next = points[(index + 1) % points.length];
      if (Math.abs(cross(previous, point, next)) > GEOMETRY_EPSILON) return true;
      changed = true;
      return false;
    });
  }
  return signedRingArea(cleaned) < 0 ? [...cleaned].reverse() : cleaned;
}

function pointInMetricTriangle(point: MetricPoint, triangle: [MetricPoint, MetricPoint, MetricPoint]) {
  return (
    cross(triangle[0], triangle[1], point) >= -GEOMETRY_EPSILON &&
    cross(triangle[1], triangle[2], point) >= -GEOMETRY_EPSILON &&
    cross(triangle[2], triangle[0], point) >= -GEOMETRY_EPSILON
  );
}

function triangle(points: [MetricPoint, MetricPoint, MetricPoint]): Triangle {
  const xs = points.map(([x]) => x);
  const ys = points.map(([, y]) => y);
  return {
    points,
    minX: Math.min(...xs),
    minY: Math.min(...ys),
    maxX: Math.max(...xs),
    maxY: Math.max(...ys),
  };
}

function triangulate(ring: MetricPoint[]): Triangle[] | undefined {
  const points = cleanMetricRing(ring);
  if (points.length < 3 || Math.abs(signedRingArea(points)) <= GEOMETRY_EPSILON) return undefined;
  if (points.length === 3) return [triangle([points[0], points[1], points[2]])];

  const remaining = points.map((_, index) => index);
  const triangles: Triangle[] = [];
  while (remaining.length > 3) {
    let earFound = false;
    for (let position = 0; position < remaining.length; position += 1) {
      const previous = remaining[(position - 1 + remaining.length) % remaining.length];
      const current = remaining[position];
      const next = remaining[(position + 1) % remaining.length];
      const ear: [MetricPoint, MetricPoint, MetricPoint] = [
        points[previous],
        points[current],
        points[next],
      ];
      if (cross(ear[0], ear[1], ear[2]) <= GEOMETRY_EPSILON) continue;
      const containsOtherVertex = remaining.some(
        (index) =>
          index !== previous &&
          index !== current &&
          index !== next &&
          pointInMetricTriangle(points[index], ear)
      );
      if (containsOtherVertex) continue;
      triangles.push(triangle(ear));
      remaining.splice(position, 1);
      earFound = true;
      break;
    }
    if (!earFound) return undefined;
  }
  triangles.push(
    triangle([points[remaining[0]], points[remaining[1]], points[remaining[2]]])
  );
  return triangles;
}

function lineIntersection(
  firstStart: MetricPoint,
  firstEnd: MetricPoint,
  secondStart: MetricPoint,
  secondEnd: MetricPoint
): MetricPoint {
  const firstDirection: MetricPoint = [
    firstEnd[0] - firstStart[0],
    firstEnd[1] - firstStart[1],
  ];
  const secondDirection: MetricPoint = [
    secondEnd[0] - secondStart[0],
    secondEnd[1] - secondStart[1],
  ];
  const denominator =
    firstDirection[0] * secondDirection[1] - firstDirection[1] * secondDirection[0];
  if (Math.abs(denominator) <= GEOMETRY_EPSILON) return firstEnd;
  const offset: MetricPoint = [
    secondStart[0] - firstStart[0],
    secondStart[1] - firstStart[1],
  ];
  const distance =
    (offset[0] * secondDirection[1] - offset[1] * secondDirection[0]) / denominator;
  return [
    firstStart[0] + distance * firstDirection[0],
    firstStart[1] + distance * firstDirection[1],
  ];
}

function clippedTriangleArea(subject: Triangle, clip: Triangle) {
  let output: MetricPoint[] = [...subject.points];
  for (let edge = 0; edge < clip.points.length; edge += 1) {
    const clipStart = clip.points[edge];
    const clipEnd = clip.points[(edge + 1) % clip.points.length];
    const input = output;
    output = [];
    if (!input.length) break;
    let previous = input.at(-1)!;
    for (const current of input) {
      const currentInside = cross(clipStart, clipEnd, current) >= -GEOMETRY_EPSILON;
      const previousInside = cross(clipStart, clipEnd, previous) >= -GEOMETRY_EPSILON;
      if (currentInside) {
        if (!previousInside) {
          output.push(lineIntersection(previous, current, clipStart, clipEnd));
        }
        output.push(current);
      } else if (previousInside) {
        output.push(lineIntersection(previous, current, clipStart, clipEnd));
      }
      previous = current;
    }
  }
  return output.length >= 3 ? Math.abs(signedRingArea(output)) : 0;
}

function ringsIntersectionArea(first: MetricPoint[], second: MetricPoint[]) {
  const firstTriangles = triangulate(first);
  const secondTriangles = triangulate(second);
  if (!firstTriangles || !secondTriangles) return undefined;
  let area = 0;
  for (const firstTriangle of firstTriangles) {
    for (const secondTriangle of secondTriangles) {
      if (
        firstTriangle.maxX < secondTriangle.minX ||
        secondTriangle.maxX < firstTriangle.minX ||
        firstTriangle.maxY < secondTriangle.minY ||
        secondTriangle.maxY < firstTriangle.minY
      ) {
        continue;
      }
      area += clippedTriangleArea(firstTriangle, secondTriangle);
    }
  }
  return area;
}

function polygonsIntersectionArea(first: MetricPolygon, second: MetricPolygon) {
  const exterior = ringsIntersectionArea(first.exterior, second.exterior);
  if (exterior === undefined) return undefined;
  let area = exterior;
  for (const hole of first.interiors) {
    const removed = ringsIntersectionArea(hole, second.exterior);
    if (removed === undefined) return undefined;
    area -= removed;
  }
  for (const hole of second.interiors) {
    const removed = ringsIntersectionArea(first.exterior, hole);
    if (removed === undefined) return undefined;
    area -= removed;
  }
  for (const firstHole of first.interiors) {
    for (const secondHole of second.interiors) {
      const restored = ringsIntersectionArea(firstHole, secondHole);
      if (restored === undefined) return undefined;
      area += restored;
    }
  }
  return Math.max(0, area);
}

function round(value: number, decimals: number) {
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
}

function parcelCoverage(
  geometry: ParcelGeometry,
  features: Feature[]
): ClassificationParcelCoverage | undefined {
  const points = geometry.coordinates.flatMap((polygon) =>
    polygon.flatMap((ring) => ring.map(([lng, lat]) => [lng, lat] as Point))
  );
  if (!points.length) return undefined;
  const referenceLng = points.reduce((sum, [lng]) => sum + lng, 0) / points.length;
  const referenceLat = points.reduce((sum, [, lat]) => sum + lat, 0) / points.length;
  const radians = Math.PI / 180;
  const project = ([lng, lat]: Point): MetricPoint => [
    EARTH_RADIUS_METRES * (lng - referenceLng) * radians * Math.cos(referenceLat * radians),
    EARTH_RADIUS_METRES * (lat - referenceLat) * radians,
  ];
  const parcelPolygons: MetricPolygon[] = geometry.coordinates.map((polygon) => ({
    exterior: polygon[0].map(([lng, lat]) => project([lng, lat])),
    interiors: polygon.slice(1).map((ring) => ring.map(([lng, lat]) => project([lng, lat]))),
  }));
  const classificationPolygons: MetricPolygon[] = features.flatMap((feature) =>
    feature.polygons.map((polygon) => ({
      exterior: polygon.exterior.map(project),
      interiors: polygon.interiors.map((ring) => ring.map(project)),
    }))
  );
  const parcelArea = parcelPolygons.reduce(
    (total, polygon) =>
      total +
      Math.abs(signedRingArea(polygon.exterior)) -
      polygon.interiors.reduce((holes, ring) => holes + Math.abs(signedRingArea(ring)), 0),
    0
  );
  if (parcelArea <= GEOMETRY_EPSILON) return undefined;

  let intersectionArea = 0;
  for (const parcelPolygon of parcelPolygons) {
    for (const classificationPolygon of classificationPolygons) {
      const area = polygonsIntersectionArea(parcelPolygon, classificationPolygon);
      if (area === undefined) return undefined;
      intersectionArea += area;
    }
  }
  intersectionArea = Math.min(parcelArea, Math.max(0, intersectionArea));
  return {
    parcelAreaSquareMetres: round(parcelArea, 2),
    intersectionAreaSquareMetres: round(intersectionArea, 2),
    parcelPercentage: round((intersectionArea / parcelArea) * 100, 2),
    method: 'polygon_intersection',
  };
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
    const layers = getSiotugaClassificationLayers(location.municipalityCode);
    if (layers.length === 0) {
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

    return {
      candidates,
      discrepancies,
      sourceChecks,
      officialLinks,
      evidence,
      warnings,
    };
  }
}
