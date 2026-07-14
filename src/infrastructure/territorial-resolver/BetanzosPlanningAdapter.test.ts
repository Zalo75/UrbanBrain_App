import { describe, expect, it, vi } from 'vitest';

import type { ParcelGeometry, PlanningPort } from '@/domain/territorial-resolver/types';
import { BetanzosPlanningAdapter, parseSiotugaClassificationGml } from './BetanzosPlanningAdapter';
import { BETANZOS_REGISTRY } from '@/municipal-pilots/betanzos/registry';

const NOW = new Date('2026-07-14T10:00:00.000Z');

function feature(
  id: string,
  classificationCode: 'SU' | 'SNR' | 'SR',
  categoryCode: 'SUSC' | 'SNRSC' | 'SRSC',
  ring: Array<[number, number]>,
  denomination?: string,
  interior?: Array<[number, number]>
) {
  const axisOrdered = ring.map(([lng, lat]) => `${lat} ${lng}`).join(' ');
  const interiorAxisOrdered = interior?.map(([lng, lat]) => `${lat} ${lng}`).join(' ');
  return `<gml:featureMember>
    <ms:_15009_NNSSPP_199606_AD_3CLAS_22221 gml:id="${id}">
      <ms:geom><gml:MultiSurface><gml:surfaceMember><gml:Polygon>
        <gml:exterior><gml:LinearRing><gml:posList>${axisOrdered}</gml:posList></gml:LinearRing></gml:exterior>
        ${interiorAxisOrdered ? `<gml:interior><gml:LinearRing><gml:posList>${interiorAxisOrdered}</gml:posList></gml:LinearRing></gml:interior>` : ''}
      </gml:Polygon></gml:surfaceMember></gml:MultiSurface></ms:geom>
      <ms:id_recinto>${id}</ms:id_recinto>
      <ms:cla_homo>${classificationCode}</ms:cla_homo>
      <ms:cat_homo>${categoryCode}</ms:cat_homo>
      ${denomination ? `<ms:denom>${denomination}</ms:denom>` : ''}
      <ms:uso>residencial</ms:uso>
    </ms:_15009_NNSSPP_199606_AD_3CLAS_22221>
  </gml:featureMember>`;
}

function gml(...features: string[]) {
  return `<wfs:FeatureCollection xmlns:wfs="http://www.opengis.net/wfs" xmlns:gml="http://www.opengis.net/gml" xmlns:ms="http://mapserver.gis.umn.edu/mapserver">${features.join('')}</wfs:FeatureCollection>`;
}

const urbanRing: Array<[number, number]> = [
  [-8.27, 43.27],
  [-8.25, 43.27],
  [-8.25, 43.29],
  [-8.27, 43.29],
  [-8.27, 43.27],
];

function fallback(): PlanningPort {
  return {
    findApplicablePlanning: vi.fn(async () => ({
      status: 'not_determined',
      evidence: [],
      warnings: [{ code: 'fallback', message: 'fallback' }],
    })),
  };
}

function response(xml: string) {
  return vi.fn(async () => new Response(xml, { status: 200 }));
}

function parcel(ring: Array<[number, number]>): ParcelGeometry {
  return { type: 'MultiPolygon', coordinates: [[[...ring]]], crs: 'EPSG:4326' };
}

describe('BetanzosPlanningAdapter', () => {
  it('mantiene un registro versionado sin identificadores duplicados ni históricos vigentes', () => {
    const ids = BETANZOS_REGISTRY.instruments.map((item) => item.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(BETANZOS_REGISTRY.instruments.filter((item) => item.status === 'current')).toHaveLength(
      1
    );
    expect(BETANZOS_REGISTRY.instruments.find((item) => item.id === '26373')?.status).toBe(
      'historical'
    );
    expect(BETANZOS_REGISTRY.instruments.find((item) => item.id === '23087')).toMatchObject({
      relationToCurrent: 'predates_current_relation_unverified',
      status: 'catalogued_pending_spatial_validation',
    });
    expect(
      BETANZOS_REGISTRY.documents
        .filter((item) => item.instrumentId === '22221')
        .every((item) => item.binding === 'general')
    ).toBe(true);
    expect(BETANZOS_REGISTRY.documents.find((item) => item.id === '28306no002.pdf')).toMatchObject({
      instrumentId: '28306',
      binding: 'unverified_for_detected_area',
    });
  });

  it('interpreta el orden de ejes WFS 1.1 y conserva los códigos oficiales', () => {
    const parsed = parseSiotugaClassificationGml(
      gml(feature('22221_urban', 'SU', 'SUSC', urbanRing))
    );
    expect(parsed[0]).toMatchObject({
      id: '22221_urban',
      classificationCode: 'SU',
      categoryCode: 'SUSC',
    });
    expect(parsed[0].polygons[0].exterior[0]).toEqual([-8.27, 43.27]);
  });

  it('resuelve suelo urbano por punto sin convertirlo en una ordenanza', async () => {
    const fetcher = response(gml(feature('urban-1', 'SU', 'SUSC', urbanRing)));
    const result = await new BetanzosPlanningAdapter(
      fallback(),
      fetcher,
      1000,
      () => NOW
    ).findApplicablePlanning({
      municipalityCode: '15009',
      coordinates: { lat: 43.28, lng: -8.26 },
    });

    expect(result.status).toBe('partial');
    expect(result.classification).toMatchObject({ code: 'SU', categoryCode: 'SUSC' });
    expect(result.canAnswerConcreteParameters).toBe(false);
    expect(result.warnings.map((item) => item.code)).toEqual(
      expect.arrayContaining(['betanzos_zoning_raster_only', 'point_only_planning_analysis'])
    );
    const requestedUrl = new URL(String(fetcher.mock.calls[0][0]));
    const [minLat, minLng, maxLat, maxLng, crs] = requestedUrl.searchParams.get('BBOX')!.split(',');
    expect(Number(minLat)).toBeCloseTo(43.27998, 6);
    expect(Number(minLng)).toBeCloseTo(-8.26002, 6);
    expect(Number(maxLat)).toBeCloseTo(43.28002, 6);
    expect(Number(maxLng)).toBeCloseTo(-8.25998, 6);
    expect(crs).toBe('EPSG:4326');
    expect(requestedUrl.searchParams.get('SRSNAME')).toBe('EPSG:4326');
  });

  it('no clasifica un punto situado dentro de un hueco del polígono oficial', async () => {
    const hole: Array<[number, number]> = [
      [-8.265, 43.275],
      [-8.255, 43.275],
      [-8.255, 43.285],
      [-8.265, 43.285],
      [-8.265, 43.275],
    ];
    const result = await new BetanzosPlanningAdapter(
      fallback(),
      response(gml(feature('urban-with-hole', 'SU', 'SUSC', urbanRing, undefined, hole))),
      1000,
      () => NOW
    ).findApplicablePlanning({
      municipalityCode: '15009',
      coordinates: { lat: 43.28, lng: -8.26 },
    });

    expect(result.classification).toBeUndefined();
    expect(result.warnings.map((item) => item.code)).toContain('planning_classification_not_found');
  });

  it('resuelve un núcleo rural únicamente desde el atributo oficial denom', async () => {
    const ring: Array<[number, number]> = [
      [-8.24, 43.29],
      [-8.22, 43.29],
      [-8.22, 43.31],
      [-8.24, 43.31],
      [-8.24, 43.29],
    ];
    const result = await new BetanzosPlanningAdapter(
      fallback(),
      response(gml(feature('nucleus-1', 'SNR', 'SNRSC', ring, 'O CASTRO DE SAN FIZ'))),
      1000,
      () => NOW
    ).findApplicablePlanning({
      municipalityCode: '15009',
      geometry: parcel([
        [-8.235, 43.295],
        [-8.225, 43.295],
        [-8.225, 43.305],
        [-8.235, 43.305],
        [-8.235, 43.295],
      ]),
    });

    expect(result.classification?.code).toBe('SNR');
    expect(result.areas).toEqual([
      { type: 'nucleus', name: 'O CASTRO DE SAN FIZ', sourceFeatureIds: ['nucleus-1'] },
    ]);
  });

  it('resuelve suelo rústico con geometría parcelaria', async () => {
    const result = await new BetanzosPlanningAdapter(
      fallback(),
      response(gml(feature('rustic-1', 'SR', 'SRSC', urbanRing))),
      1000,
      () => NOW
    ).findApplicablePlanning({
      municipalityCode: '15009',
      geometry: parcel(urbanRing),
    });
    expect(result.classification).toMatchObject({ code: 'SR', categoryCode: 'SRSC' });
    expect(result.warnings.map((item) => item.code)).not.toContain('point_only_planning_analysis');
  });

  it('detecta una parcela atravesada por un límite aunque el punto caiga en una sola clase', async () => {
    const left: Array<[number, number]> = [
      [-8.28, 43.27],
      [-8.26, 43.27],
      [-8.26, 43.29],
      [-8.28, 43.29],
      [-8.28, 43.27],
    ];
    const right: Array<[number, number]> = [
      [-8.26, 43.27],
      [-8.24, 43.27],
      [-8.24, 43.29],
      [-8.26, 43.29],
      [-8.26, 43.27],
    ];
    const result = await new BetanzosPlanningAdapter(
      fallback(),
      response(
        gml(feature('urban-left', 'SU', 'SUSC', left), feature('rustic-right', 'SR', 'SRSC', right))
      ),
      1000,
      () => NOW
    ).findApplicablePlanning({
      municipalityCode: '15009',
      coordinates: { lat: 43.28, lng: -8.27 },
      geometry: parcel([
        [-8.27, 43.275],
        [-8.25, 43.275],
        [-8.25, 43.285],
        [-8.27, 43.285],
        [-8.27, 43.275],
      ]),
    });

    expect(result.status).toBe('conflict');
    expect(result.classification).toBeUndefined();
    expect(result.conflicts).toContain(
      'La geometría intersecta clasificaciones o categorías de suelo incompatibles.'
    );
    expect(result.conflicts).toContain(
      'La clasificación obtenida con el punto no coincide con todas las clases intersectadas por la geometría de parcela.'
    );
  });

  it('no declara aplicable una modificación que carece de vínculo espacial', async () => {
    const result = await new BetanzosPlanningAdapter(
      fallback(),
      response(gml(feature('urban-1', 'SU', 'SUSC', urbanRing))),
      1000,
      () => NOW
    ).findApplicablePlanning({
      municipalityCode: '15009',
      coordinates: { lat: 43.28, lng: -8.26 },
    });
    expect(result.applicableInstruments?.map((item) => item.id)).toEqual(['22221']);
    expect(result.cataloguedInstruments?.map((item) => item.id)).toContain('28550');
    expect(result.cataloguedInstruments?.map((item) => item.id)).not.toContain('23087');
  });

  it('mantiene el instrumento trazable y se abstiene si el WFS falla', async () => {
    const result = await new BetanzosPlanningAdapter(
      fallback(),
      vi.fn(async () => {
        throw new Error('timeout');
      }),
      1000,
      () => NOW
    ).findApplicablePlanning({
      municipalityCode: '15009',
      coordinates: { lat: 43.28, lng: -8.26 },
    });
    expect(result.instrument).toContain('Normas Subsidiarias');
    expect(result.classification).toBeUndefined();
    expect(result.warnings.map((item) => item.code)).toContain(
      'planning_classification_unavailable'
    );
  });

  it('delega cualquier otro municipio sin alterar la arquitectura validada', async () => {
    const delegated = fallback();
    await new BetanzosPlanningAdapter(delegated).findApplicablePlanning({
      municipalityCode: '15030',
      coordinates: { lat: 43.37, lng: -8.4 },
    });
    expect(delegated.findApplicablePlanning).toHaveBeenCalledWith({
      municipalityCode: '15030',
      coordinates: { lat: 43.37, lng: -8.4 },
    });
  });
});
