import type {
  ClassificationCandidate,
  ClassificationDiscrepancy,
  ClassificationInstrumentTraceability,
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
  type SiotugaClassificationLayerRegistration,
} from '@/infrastructure/territorial-resolver/SiotugaClassificationRegistry';

type Point = [lng: number, lat: number];

interface Polygon {
  exterior: Point[];
  interiors: Point[][];
}

interface Feature {
  id: string;
  classificationCode: string;
  categoryCode?: string;
  denomination?: string;
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
  return (
    (planning.status === 'determined' || planning.status === 'partial') &&
    comparable(planning.instrument) === comparable(layer.instrument.name) &&
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
    features.push({
      id:
        /gml:id=["']([^"']+)["']/i.exec(fragment)?.[1] ??
        xmlValue(fragment, 'id_recinto') ??
        'feature-without-id',
      classificationCode,
      categoryCode: xmlValue(fragment, 'cat_homo'),
      denomination: xmlValue(fragment, 'denom'),
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

export class SiotugaClassificationAdapter implements PlanningPort {
  constructor(
    private readonly fallback: PlanningPort,
    private readonly fetcher: FetchLike = fetch,
    private readonly timeoutMs = 8_000,
    private readonly now: () => Date = () => new Date()
  ) {}

  async findApplicablePlanning(location: {
    municipalityCode?: string;
    coordinates?: TerritorialCoordinates;
    geometry?: ParcelGeometry;
  }): Promise<PlanningApplicability> {
    const planning = await this.fallback.findApplicablePlanning(location);
    const layer = getSiotugaClassificationLayer(location.municipalityCode);
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
    const evidence: TerritorialEvidence[] = [
      ...planning.evidence,
      { source: 'siotuga', sourceUrl: layer.instrument.inventoryUrl, retrievedAt, method: `registro de capa ${layer.layerName} vinculado al documento SIOTUGA ${layer.instrument.siotugaDocumentId}`, scope: 'planning_classification' },
      { source: 'siotuga', sourceUrl: url.toString(), retrievedAt, method: location.geometry ? 'WFS BBOX e intersección local con geometría parcelaria EPSG:4326' : 'WFS BBOX y punto en polígono EPSG:4326', scope: 'planning_classification' },
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
      ],
      evidence,
    });
    const selectedCandidate = classificationResolution.status === 'clear' ? candidates[0] : undefined;
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
