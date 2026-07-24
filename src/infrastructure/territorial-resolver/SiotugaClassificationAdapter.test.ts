import { describe, expect, it, vi } from 'vitest';

import type { ParcelGeometry, PlanningPort } from '@/domain/territorial-resolver/types';
import { BetanzosPlanningAdapter } from './BetanzosPlanningAdapter';
import {
  matchesRegisteredInstrument,
  SiotugaClassificationAdapter,
} from './SiotugaClassificationAdapter';
import { SIOTUGA_CLASSIFICATION_LAYERS } from './SiotugaClassificationRegistry';

const NOW = new Date('2026-07-21T12:00:00.000Z');
const culleredoRing: Array<[number, number]> = [
  [-8.414, 43.267],
  [-8.412, 43.267],
  [-8.412, 43.269],
  [-8.414, 43.269],
  [-8.414, 43.267],
];

function feature(
  id: string,
  classification: string,
  category: string,
  ring: Array<[number, number]>,
  denomination?: string
) {
  const positions = ring.map(([lng, lat]) => `${lat} ${lng}`).join(' ');
  return `<gml:featureMember><ms:classification gml:id="${id}"><ms:geom><gml:Polygon><gml:exterior><gml:LinearRing><gml:posList>${positions}</gml:posList></gml:LinearRing></gml:exterior></gml:Polygon></ms:geom><ms:cla_homo>${classification}</ms:cla_homo><ms:cat_homo>${category}</ms:cat_homo>${denomination ? `<ms:denom>${denomination}</ms:denom>` : ''}</ms:classification></gml:featureMember>`;
}

function gml(...features: string[]) {
  return `<wfs:FeatureCollection xmlns:wfs="http://www.opengis.net/wfs" xmlns:gml="http://www.opengis.net/gml" xmlns:ms="http://mapserver.gis.umn.edu/mapserver">${features.join('')}</wfs:FeatureCollection>`;
}

function geometry(ring = culleredoRing): ParcelGeometry {
  return { type: 'MultiPolygon', coordinates: [[[...ring]]], crs: 'EPSG:4326' };
}

function culleredoPlanning(): PlanningPort {
  return {
    findApplicablePlanning: vi.fn(async () => ({
      status: 'determined',
      instrument: 'Plan general de ordenación urbana',
      approvalDate: '1987-07-29T00:00:00.000Z',
      sourceUrl: 'https://siotuga.xunta.gal/siotuga/inventario.php?inv=1&idconcello=15031',
      evidence: [],
      warnings: [],
    })),
  };
}

function response(xml: string) {
  return vi.fn(async () => new Response(xml, { status: 200 }));
}

describe('SiotugaClassificationAdapter', () => {
  it('activa Culleredo solamente con el instrumento SIOTUGA registrado y devuelve SU/SUSC/LEDOÑO', async () => {
    const fetcher = response(gml(feature('22310_00089', 'SU', 'SUSC', culleredoRing, 'LEDOÑO')));
    const result = await new SiotugaClassificationAdapter(
      culleredoPlanning(),
      fetcher,
      1_000,
      () => NOW
    ).findApplicablePlanning({ municipalityCode: '15031', geometry: geometry() });

    expect(result.status).toBe('determined');
    expect(result.classification).toMatchObject({
      code: 'SU',
      categoryCode: 'SUSC',
      sourceFeatureIds: ['22310_00089'],
    });
    expect(result.classificationResolution).toMatchObject({
      status: 'clear',
      nextAction: 'auto_accept',
      automaticSelection: {
        classificationCode: 'SU',
        categoryCode: 'SUSC',
        areaNames: ['LEDOÑO'],
      },
    });
    expect(result.classificationResolution?.candidates[0].evidence).not.toHaveLength(0);
    expect(result.areas).toEqual([
      { type: 'zone', name: 'LEDOÑO', sourceFeatureIds: ['22310_00089'] },
    ]);
    const url = new URL(String(fetcher.mock.calls[0][0]));
    expect(url.searchParams.get('TYPENAME')).toBe('_15031_PXOU_198707_AD_3CLAS_22310');
    expect(url.searchParams.get('SRSNAME')).toBe('EPSG:4326');
    expect(url.searchParams.get('BBOX')?.split(',').at(-1)).toBe('EPSG:4326');
  });

  it('conserva Oleiros como evidencia sin activarlo: la capa 26746 no está vinculada al instrumento vigente 27891', async () => {
    const fetcher = response(gml(feature('26746_00010', 'SU', 'SUC', culleredoRing)));
    const result = await new SiotugaClassificationAdapter(
      {
        findApplicablePlanning: vi.fn(async () => ({
          status: 'determined',
          instrument: 'Plan general de ordenación municipal',
          approvalDate: '2014-12-11T00:00:00.000Z',
          evidence: [],
          warnings: [],
        })),
      },
      fetcher
    ).findApplicablePlanning({ municipalityCode: '15058', geometry: geometry() });

    expect(fetcher).toHaveBeenCalledOnce();
    expect(result.classification).toBeUndefined();
    expect(result.classificationResolution).toMatchObject({
      status: 'review_required',
      nextAction: 'review_official_sources',
      proposal: { requiresProfessionalReview: true },
    });
    expect(result.classificationResolution?.candidates[0].classification).toMatchObject({
      code: 'SU',
      categoryCode: 'SUC',
    });
    expect(result.classificationResolution?.reviewReasons).toContain(
      'instrument_traceability_pending'
    );
    expect(result.warnings.map((item) => item.code)).toContain(
      'planning_classification_pending_traceability'
    );
  });

  it('preserva Betanzos y su abstención ante conflicto entre punto y geometría', async () => {
    const left: Array<[number, number]> = [
      [-8.218, 43.269],
      [-8.216, 43.269],
      [-8.216, 43.271],
      [-8.218, 43.271],
      [-8.218, 43.269],
    ];
    const right: Array<[number, number]> = [
      [-8.216, 43.269],
      [-8.214, 43.269],
      [-8.214, 43.271],
      [-8.216, 43.271],
      [-8.216, 43.269],
    ];
    const result = await new SiotugaClassificationAdapter(
      new BetanzosPlanningAdapter(culleredoPlanning(), () => NOW),
      response(gml(feature('urban', 'SU', 'SUSC', left), feature('rural', 'SNR', 'SNRSC', right))),
      1_000,
      () => NOW
    ).findApplicablePlanning({
      municipalityCode: '15009',
      coordinates: { lat: 43.27, lng: -8.217 },
      geometry: geometry([
        [-8.217, 43.2695],
        [-8.215, 43.2695],
        [-8.215, 43.2705],
        [-8.217, 43.2705],
        [-8.217, 43.2695],
      ]),
    });

    expect(result.status).toBe('partial');
    expect(result.classification).toBeUndefined();
    expect(result.classificationResolution).toMatchObject({
      status: 'multiple_intersections',
      nextAction: 'manual_selection',
    });
  });

  it('propone la evidencia geométrica de Betanzos cuando el punto no coincide', async () => {
    const betanzosRing: Array<[number, number]> = [
      [-8.218, 43.269],
      [-8.216, 43.269],
      [-8.216, 43.271],
      [-8.218, 43.271],
      [-8.218, 43.269],
    ];
    const result = await new SiotugaClassificationAdapter(
      new BetanzosPlanningAdapter(culleredoPlanning(), () => NOW),
      response(gml(feature('rural-cascas', 'SNR', 'SNRSC', betanzosRing, 'CASCAS'))),
      1_000,
      () => NOW
    ).findApplicablePlanning({
      municipalityCode: '15009',
      coordinates: { lat: 43.27, lng: -8.214 },
      geometry: geometry(betanzosRing),
    });

    expect(result.classification).toBeUndefined();
    expect(result.classificationResolution).toMatchObject({
      status: 'review_required',
      nextAction: 'review_official_sources',
      proposal: { requiresProfessionalReview: true },
    });
    expect(result.classificationResolution?.candidates[0]).toMatchObject({
      classification: { code: 'SNR', categoryCode: 'SNRSC' },
      areas: [{ type: 'nucleus', name: 'CASCAS' }],
    });
    expect(result.classificationResolution?.proposal?.candidateId).toContain('SNR|SNRSC');
  });

  it('mantiene el instrumento documental si el municipio no tiene capa registrada', async () => {
    const fallback = culleredoPlanning();
    const result = await new SiotugaClassificationAdapter(fallback).findApplicablePlanning({
      municipalityCode: '15030',
      geometry: geometry(),
    });
    expect(result.instrument).toBe('Plan general de ordenación urbana');
    expect(result.classification).toBeUndefined();
    expect(result.classificationResolution).toMatchObject({
      status: 'not_available',
      nextAction: 'manual_selection',
    });
  });

  it('se abstiene si la capa no devuelve recintos para la geometría', async () => {
    const result = await new SiotugaClassificationAdapter(
      culleredoPlanning(),
      response(gml())
    ).findApplicablePlanning({ municipalityCode: '15031', geometry: geometry() });
    expect(result.status).toBe('determined');
    expect(result.classification).toBeUndefined();
    expect(result.classificationResolution).toMatchObject({
      status: 'not_available',
      nextAction: 'manual_selection',
    });
    expect(result.warnings.map((item) => item.code)).toContain('planning_classification_not_found');
  });

  it('conserva varios recintos reales sin tratarlos como conflicto', async () => {
    const result = await new SiotugaClassificationAdapter(
      culleredoPlanning(),
      response(gml(feature('urban', 'SU', 'SUSC', culleredoRing), feature('rural', 'SR', 'SRSC', culleredoRing)))
    ).findApplicablePlanning({ municipalityCode: '15031', geometry: geometry() });
    expect(result.status).toBe('determined');
    expect(result.classification).toBeUndefined();
    expect(result.classificationResolution).toMatchObject({
      status: 'multiple_intersections',
      nextAction: 'manual_selection',
    });
    expect(result.classificationResolution?.candidates).toHaveLength(2);
  });

  it('mantiene el instrumento y no rompe la creación cuando WFS falla', async () => {
    const result = await new SiotugaClassificationAdapter(
      culleredoPlanning(),
      vi.fn(async () => {
        throw new Error('network unavailable');
      })
    ).findApplicablePlanning({ municipalityCode: '15031', geometry: geometry() });
    expect(result.status).toBe('determined');
    expect(result.instrument).toBe('Plan general de ordenación urbana');
    expect(result.classification).toBeUndefined();
    expect(result.classificationResolution).toMatchObject({
      status: 'source_unavailable',
      nextAction: 'retry_source',
    });
    expect(result.warnings.map((item) => item.code)).toContain('planning_classification_unavailable');
  });

  it('exige coincidencia de nombre y fecha antes de enlazar capa e instrumento', () => {
    const culleredo = SIOTUGA_CLASSIFICATION_LAYERS.find(
      (layer) => layer.municipalityCode === '15031'
    )!;
    expect(
      matchesRegisteredInstrument(
        { status: 'determined', instrument: 'Plan General de Ordenacion Urbana', approvalDate: '1987-07-29T00:00:00.000Z', evidence: [], warnings: [] },
        culleredo
      )
    ).toBe(true);
    expect(
      matchesRegisteredInstrument(
        { status: 'determined', instrument: 'Plan General de Ordenacion Urbana', approvalDate: '1988-09-30T00:00:00.000Z', evidence: [], warnings: [] },
        culleredo
      )
    ).toBe(false);
  });
});
