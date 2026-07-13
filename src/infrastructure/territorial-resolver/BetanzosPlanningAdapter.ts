import type {
  ParcelGeometry,
  PlanningApplicability,
  PlanningArea,
  PlanningClassification,
  PlanningPort,
  TerritorialCoordinates,
  TerritorialEvidence,
  TerritorialWarning,
} from '@/domain/territorial-resolver/types';
import { fetchOfficial, type FetchLike } from '@/infrastructure/territorial-resolver/officialHttp';
import {
  BETANZOS_CURRENT_INSTRUMENT,
  BETANZOS_NON_SPATIALLY_BOUND_INSTRUMENTS,
  BETANZOS_REGISTRY,
} from '@/municipal-pilots/betanzos/registry';

type Point = [lng: number, lat: number];

interface Polygon {
  exterior: Point[];
  interiors: Point[][];
}

export interface SiotugaClassificationFeature {
  id: string;
  classificationCode: string;
  categoryCode?: string;
  planCategoryCode?: string;
  denomination?: string;
  use?: string;
  polygons: Polygon[];
}

function xmlValue(fragment: string, tag: string) {
  const value = new RegExp(`<[^:>]+:${tag}>([^<]*)`, 'i').exec(fragment)?.[1];
  if (!value) return undefined;
  return value
    .replaceAll('&amp;', '&')
    .replaceAll('&lt;', '<')
    .replaceAll('&gt;', '>')
    .replaceAll('&quot;', '"')
    .replaceAll('&#39;', "'")
    .trim();
}

function parseAxisOrderedRing(posList: string): Point[] {
  const values = posList.trim().split(/\s+/).map(Number).filter(Number.isFinite);
  const points: Point[] = [];
  for (let index = 0; index + 1 < values.length; index += 2) {
    // WFS 1.1 aplica el orden de ejes oficial EPSG:4326: latitud, longitud.
    points.push([values[index + 1], values[index]]);
  }
  return points;
}

export function parseSiotugaClassificationGml(xml: string): SiotugaClassificationFeature[] {
  const features: SiotugaClassificationFeature[] = [];
  for (const match of xml.matchAll(/<gml:featureMember>([\s\S]*?)<\/gml:featureMember>/gi)) {
    const fragment = match[1];
    const classificationCode = xmlValue(fragment, 'cla_homo');
    if (!classificationCode) continue;
    const id =
      /gml:id=["']([^"']+)["']/i.exec(fragment)?.[1] ??
      xmlValue(fragment, 'id_recinto') ??
      'feature-without-id';
    const polygons = [...fragment.matchAll(/<gml:Polygon[^>]*>([\s\S]*?)<\/gml:Polygon>/gi)]
      .map((polygonMatch): Polygon | null => {
        const polygon = polygonMatch[1];
        const exteriorMatch =
          /<gml:exterior>[\s\S]*?<gml:posList[^>]*>([\s\S]*?)<\/gml:posList>[\s\S]*?<\/gml:exterior>/i.exec(
            polygon
          );
        if (!exteriorMatch) return null;
        const exterior = parseAxisOrderedRing(exteriorMatch[1]);
        if (exterior.length < 3) return null;
        const interiors = [
          ...polygon.matchAll(
            /<gml:interior>[\s\S]*?<gml:posList[^>]*>([\s\S]*?)<\/gml:posList>[\s\S]*?<\/gml:interior>/gi
          ),
        ]
          .map((ring) => parseAxisOrderedRing(ring[1]))
          .filter((ring) => ring.length >= 3);
        return { exterior, interiors };
      })
      .filter((polygon): polygon is Polygon => polygon !== null);
    features.push({
      id,
      classificationCode,
      categoryCode: xmlValue(fragment, 'cat_homo'),
      planCategoryCode: xmlValue(fragment, 'cat_plan'),
      denomination: xmlValue(fragment, 'denom'),
      use: xmlValue(fragment, 'uso'),
      polygons,
    });
  }
  return features;
}

function pointInRing(point: Point, ring: Point[]) {
  for (let index = 0; index < ring.length; index += 1) {
    const next = (index + 1) % ring.length;
    if (
      orientation(ring[index], point, ring[next]) === 0 &&
      onSegment(ring[index], point, ring[next])
    ) {
      return true;
    }
  }
  let inside = false;
  for (let current = 0, previous = ring.length - 1; current < ring.length; previous = current++) {
    const [x, y] = ring[current];
    const [previousX, previousY] = ring[previous];
    const crosses =
      y > point[1] !== previousY > point[1] &&
      point[0] < ((previousX - x) * (point[1] - y)) / (previousY - y) + x;
    if (crosses) inside = !inside;
  }
  return inside;
}

function pointInPolygon(point: Point, polygon: Polygon) {
  return (
    pointInRing(point, polygon.exterior) &&
    !polygon.interiors.some((interior) => pointInRing(point, interior))
  );
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

function segmentsIntersect(a: Point, b: Point, c: Point, d: Point) {
  const o1 = orientation(a, b, c);
  const o2 = orientation(a, b, d);
  const o3 = orientation(c, d, a);
  const o4 = orientation(c, d, b);
  if (o1 !== o2 && o3 !== o4) return true;
  return (
    (o1 === 0 && onSegment(a, c, b)) ||
    (o2 === 0 && onSegment(a, d, b)) ||
    (o3 === 0 && onSegment(c, a, d)) ||
    (o4 === 0 && onSegment(c, b, d))
  );
}

function ringsIntersect(first: Point[], second: Point[]) {
  if (first.some((point) => pointInRing(point, second))) return true;
  if (second.some((point) => pointInRing(point, first))) return true;
  return ringEdgesIntersect(first, second);
}

function ringEdgesIntersect(first: Point[], second: Point[]) {
  for (let firstIndex = 0; firstIndex < first.length; firstIndex += 1) {
    const firstNext = (firstIndex + 1) % first.length;
    for (let secondIndex = 0; secondIndex < second.length; secondIndex += 1) {
      const secondNext = (secondIndex + 1) % second.length;
      if (
        segmentsIntersect(
          first[firstIndex],
          first[firstNext],
          second[secondIndex],
          second[secondNext]
        )
      ) {
        return true;
      }
    }
  }
  return false;
}

function polygonIntersectsRing(polygon: Polygon, ring: Point[]) {
  if (ring.some((point) => pointInPolygon(point, polygon))) return true;
  if (polygon.exterior.some((point) => pointInRing(point, ring))) return true;
  if (ringsIntersect(polygon.exterior, ring)) return true;
  return polygon.interiors.some((interior) => ringEdgesIntersect(interior, ring));
}

function parcelRings(geometry?: ParcelGeometry): Point[][] {
  return geometry?.coordinates.map((polygon) => polygon[0] as Point[]).filter(Boolean) ?? [];
}

function featureMatches(
  feature: SiotugaClassificationFeature,
  coordinates?: TerritorialCoordinates,
  geometry?: ParcelGeometry
) {
  const rings = parcelRings(geometry);
  if (rings.length) {
    return feature.polygons.some((featurePolygon) =>
      rings.some((parcelRing) => polygonIntersectsRing(featurePolygon, parcelRing))
    );
  }
  return coordinates
    ? feature.polygons.some((polygon) =>
        pointInPolygon([coordinates.lng, coordinates.lat], polygon)
      )
    : false;
}

function boundingBox(coordinates?: TerritorialCoordinates, geometry?: ParcelGeometry) {
  const points = geometry
    ? geometry.coordinates.flatMap((polygon) =>
        polygon.flatMap((ring) => ring.map(([lng, lat]): Point => [lng, lat]))
      )
    : coordinates
      ? ([[coordinates.lng, coordinates.lat]] as Point[])
      : [];
  if (!points.length) return null;
  const lngs = points.map(([lng]) => lng);
  const lats = points.map(([, lat]) => lat);
  const padding = geometry ? 0.000001 : 0.00002;
  return {
    minLat: Math.min(...lats) - padding,
    minLng: Math.min(...lngs) - padding,
    maxLat: Math.max(...lats) + padding,
    maxLng: Math.max(...lngs) + padding,
  };
}

function classificationLabel(code: string) {
  return (
    {
      SU: 'Suelo urbano',
      SNR: 'Suelo de núcleo rural',
      SR: 'Suelo rústico',
    }[code] ?? `Clasificación oficial ${code}`
  );
}

function warning(code: string, message: string): TerritorialWarning {
  return { code, message };
}

function registryEvidence(now: string): TerritorialEvidence {
  return {
    source: 'siotuga',
    sourceUrl: BETANZOS_REGISTRY.sources.inventory,
    retrievedAt: now,
    method: `registro municipal versionado ${BETANZOS_REGISTRY.registryVersion}`,
  };
}

export class BetanzosPlanningAdapter implements PlanningPort {
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
    if (location.municipalityCode !== BETANZOS_REGISTRY.municipality.ineCode) {
      return this.fallback.findApplicablePlanning(location);
    }

    const retrievedAt = this.now().toISOString();
    const base = {
      instrument: BETANZOS_CURRENT_INSTRUMENT.name,
      approvalDate: BETANZOS_CURRENT_INSTRUMENT.approvalDate,
      sourceUrl: BETANZOS_CURRENT_INSTRUMENT.sourceUrl,
      applicableInstruments: [BETANZOS_CURRENT_INSTRUMENT],
      cataloguedInstruments: BETANZOS_NON_SPATIALLY_BOUND_INSTRUMENTS,
      documents: BETANZOS_REGISTRY.documents,
      canAnswerConcreteParameters: false,
      evidence: [registryEvidence(retrievedAt)],
    } satisfies Partial<PlanningApplicability>;

    const bbox = boundingBox(location.coordinates, location.geometry);
    if (!bbox) {
      return {
        ...base,
        status: 'partial',
        warnings: [
          warning(
            'planning_geometry_missing',
            'Se identificó el planeamiento general, pero falta una geometría o punto para consultar la clasificación.'
          ),
        ],
      };
    }

    const url = new URL('https://siotuga.xunta.gal/siotuga/ws');
    url.search = new URLSearchParams({
      codine: '15009',
      SERVICE: 'WFS',
      VERSION: '1.1.0',
      REQUEST: 'GetFeature',
      TYPENAME: BETANZOS_REGISTRY.layers.classification,
      MAXFEATURES: '1000',
      // WFS 1.1 + EPSG:4326 usa latitud/longitud, verificado contra el servicio oficial.
      BBOX: `${bbox.minLat},${bbox.minLng},${bbox.maxLat},${bbox.maxLng},EPSG:4326`,
    }).toString();

    let features: SiotugaClassificationFeature[];
    let pointFeatures: SiotugaClassificationFeature[] = [];
    try {
      const response = await fetchOfficial(this.fetcher, 'SIOTUGA WFS', url, this.timeoutMs);
      const allFeatures = parseSiotugaClassificationGml(await response.text());
      features = allFeatures.filter((feature) =>
        featureMatches(feature, location.coordinates, location.geometry)
      );
      if (location.coordinates && location.geometry) {
        pointFeatures = allFeatures.filter((feature) =>
          featureMatches(feature, location.coordinates, undefined)
        );
      }
    } catch {
      return {
        ...base,
        status: 'partial',
        warnings: [
          warning(
            'planning_classification_unavailable',
            'Se verificó el instrumento general, pero el servicio vectorial oficial de clasificación no respondió.'
          ),
          ...this.commonLimitations(location),
        ],
      };
    }

    const groups = new Map<string, SiotugaClassificationFeature[]>();
    for (const feature of features) {
      const key = `${feature.classificationCode}|${feature.categoryCode ?? ''}`;
      groups.set(key, [...(groups.get(key) ?? []), feature]);
    }
    const nuclei = [
      ...new Map(
        features
          .filter((feature) => feature.classificationCode === 'SNR' && feature.denomination)
          .map((feature) => [feature.denomination!, feature])
      ).values(),
    ];
    const conflicts: string[] = [];
    if (groups.size > 1) {
      conflicts.push(
        'La geometría intersecta clasificaciones o categorías de suelo incompatibles.'
      );
    }
    if (nuclei.length > 1) {
      conflicts.push('La geometría intersecta más de un núcleo rural identificado.');
    }

    if (location.coordinates && location.geometry) {
      const geometryCodes = [...groups.keys()].sort();
      const pointCodes = [
        ...new Set(
          pointFeatures.map(
            (feature) => `${feature.classificationCode}|${feature.categoryCode ?? ''}`
          )
        ),
      ].sort();
      if (geometryCodes.join(',') !== pointCodes.join(',')) {
        conflicts.push(
          'La clasificación obtenida con el punto no coincide con todas las clases intersectadas por la geometría de parcela.'
        );
      }
    }

    const onlyGroup =
      groups.size === 1 && conflicts.length === 0 ? [...groups.values()][0] : undefined;
    const first = onlyGroup?.[0];
    const classification: PlanningClassification | undefined = first
      ? {
          code: first.classificationCode,
          categoryCode: first.categoryCode,
          label: classificationLabel(first.classificationCode),
          categoryLabel: first.categoryCode
            ? `Categoría homogénea oficial ${first.categoryCode}`
            : undefined,
          sourceFeatureIds: onlyGroup.map((feature) => feature.id),
        }
      : undefined;
    const areas: PlanningArea[] = nuclei.map((feature) => ({
      type: 'nucleus',
      name: feature.denomination!,
      sourceFeatureIds: [feature.id],
    }));

    return {
      ...base,
      status: conflicts.length ? 'conflict' : 'partial',
      classification,
      areas,
      conflicts,
      evidence: [
        ...base.evidence!,
        {
          source: 'siotuga',
          sourceUrl: url.toString(),
          retrievedAt,
          method: location.geometry
            ? 'WFS BBOX y comprobación local de intersección con geometría parcelaria'
            : 'WFS BBOX y comprobación local punto-en-polígono',
        },
      ],
      warnings: [
        ...(features.length
          ? []
          : [
              warning(
                'planning_classification_not_found',
                'La capa oficial no devolvió una clasificación para la ubicación consultada.'
              ),
            ]),
        ...this.commonLimitations(location),
      ],
    };
  }

  private commonLimitations(location: {
    coordinates?: TerritorialCoordinates;
    geometry?: ParcelGeometry;
  }): TerritorialWarning[] {
    return [
      warning(
        'betanzos_zoning_raster_only',
        'La ordenación pormenorizada de Betanzos no dispone de atributos vectoriales suficientes; no se asignan ordenanza ni parámetros automáticamente.'
      ),
      warning(
        'betanzos_instruments_need_spatial_validation',
        'Las modificaciones puntuales y el planeamiento de desarrollo están inventariados, pero su aplicabilidad espacial requiere validación técnica.'
      ),
      warning(
        'normative_binding_not_verified',
        'Los documentos normativos generales están enlazados, pero no existe una correspondencia oficial inequívoca entre el recinto detectado y artículos con parámetros concretos.'
      ),
      ...(location.geometry
        ? []
        : [
            warning(
              'point_only_planning_analysis',
              'La clasificación se ha comprobado sólo en un punto y puede diferir en el resto de la parcela.'
            ),
          ]),
    ];
  }
}
