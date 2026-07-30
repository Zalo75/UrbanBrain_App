import { describe, expect, it, vi } from 'vitest';

import type { ParcelGeometry, PlanningPort } from '@/domain/territorial-resolver/types';
import { BetanzosPlanningAdapter } from './BetanzosPlanningAdapter';
import {
  matchesRegisteredInstrument,
  SiotugaClassificationAdapter,
} from './SiotugaClassificationAdapter';
import { SIOTUGA_CLASSIFICATION_LAYERS } from './SiotugaClassificationRegistry';
import { getActiveP1PlanningMunicipalities } from '@/infrastructure/planning-knowledge/PlanningKnowledgeBase';

const NOW = new Date('2026-07-21T12:00:00.000Z');
const culleredoRing: Array<[number, number]> = [
  [-8.414, 43.267],
  [-8.412, 43.267],
  [-8.412, 43.269],
  [-8.414, 43.269],
  [-8.414, 43.267],
];
const sadaRing: Array<[number, number]> = [
  [-8.2977, 43.37859],
  [-8.29759, 43.37859],
  [-8.29759, 43.37869],
  [-8.2977, 43.37869],
  [-8.2977, 43.37859],
];

function feature(
  id: string,
  classification: string,
  category: string,
  ring: Array<[number, number]>,
  denomination?: string,
  attributes?: {
    legalClassification?: string;
    legalCategory?: string;
    planningCategory?: string;
    use?: string;
    enclosureId?: string;
    geometryArea?: number;
    status?: string;
    version?: string;
  }
) {
  const positions = ring.map(([lng, lat]) => `${lat} ${lng}`).join(' ');
  return `<gml:featureMember><ms:classification gml:id="${id}"><ms:geom><gml:Polygon><gml:exterior><gml:LinearRing><gml:posList>${positions}</gml:posList></gml:LinearRing></gml:exterior></gml:Polygon></ms:geom><ms:cla_homo>${classification}</ms:cla_homo><ms:cat_homo>${category}</ms:cat_homo>${attributes?.legalClassification ? `<ms:cla_ley>${attributes.legalClassification}</ms:cla_ley>` : ''}${attributes?.legalCategory ? `<ms:cat_ley>${attributes.legalCategory}</ms:cat_ley>` : ''}${attributes?.planningCategory ? `<ms:cat_plan>${attributes.planningCategory}</ms:cat_plan>` : ''}${denomination ? `<ms:denom>${denomination}</ms:denom>` : ''}${attributes?.use ? `<ms:uso>${attributes.use}</ms:uso>` : ''}${attributes?.enclosureId ? `<ms:id_recinto>${attributes.enclosureId}</ms:id_recinto>` : ''}${attributes?.geometryArea !== undefined ? `<ms:geom_area>${attributes.geometryArea}</ms:geom_area>` : ''}${attributes?.status ? `<ms:estado>${attributes.status}</ms:estado>` : ''}${attributes?.version ? `<ms:version>${attributes.version}</ms:version>` : ''}</ms:classification></gml:featureMember>`;
}

function gml(...features: string[]) {
  return `<wfs:FeatureCollection xmlns:wfs="http://www.opengis.net/wfs" xmlns:gml="http://www.opengis.net/gml" xmlns:ms="http://mapserver.gis.umn.edu/mapserver">${features.join('')}</wfs:FeatureCollection>`;
}

function geometry(ring = culleredoRing): ParcelGeometry {
  return { type: 'MultiPolygon', coordinates: [[[...ring]]], crs: 'EPSG:4326' };
}

function coordinateRing(value: string, order: 'lng-lat' | 'lat-lng') {
  const numbers = value.trim().split(/\s+/).map(Number);
  const ring: Array<[number, number]> = [];
  for (let index = 0; index + 1 < numbers.length; index += 2) {
    ring.push(
      order === 'lng-lat'
        ? [numbers[index], numbers[index + 1]]
        : [numbers[index + 1], numbers[index]]
    );
  }
  return ring;
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

function sadaPlanning(): PlanningPort {
  return {
    findApplicablePlanning: vi.fn(async () => ({
      status: 'determined',
      instrument: 'Plan general de ordenación municipal',
      approvalDate: '2017-10-11T00:00:00.000Z',
      sourceUrl:
        'https://siotuga.xunta.gal/siotuga/inventario.php?inv=1&idconcello=15075',
      evidence: [],
      warnings: [],
    })),
  };
}

function response(xml: string) {
  return vi.fn(async () => new Response(xml, { status: 200 }));
}

describe('SiotugaClassificationAdapter', () => {
  it('obtains every P1 registration from the versioned PKB without manual duplicates', () => {
    for (const knowledge of getActiveP1PlanningMunicipalities()) {
      const registrations = SIOTUGA_CLASSIFICATION_LAYERS.filter(
        (layer) => layer.municipalityCode === knowledge.municipalityCode
      );
      expect(registrations).toHaveLength(1);
      expect(registrations[0]).toMatchObject({
        layerName: knowledge.classificationLayer.name,
        knowledgeVersion: knowledge.knowledgeVersion,
        status: 'active',
      });
    }
  });

  it.each(getActiveP1PlanningMunicipalities())(
    'resuelve clasificación y categoría para P1 $municipalityCode desde la PKB',
    async (knowledge) => {
      const fallback: PlanningPort = {
        findApplicablePlanning: vi.fn(async () => ({
          status: 'determined',
          instrument: knowledge.instrument.name,
          approvalDate: knowledge.instrument.approvalDate,
          sourceUrl: knowledge.instrument.inventoryUrl,
          evidence: [],
          warnings: [],
        })),
      };
      const fetcher = response(gml(feature('official-feature', 'SU', 'SUC', culleredoRing)));

      const result = await new SiotugaClassificationAdapter(
        fallback,
        fetcher,
        1_000,
        () => NOW
      ).findApplicablePlanning({
        municipalityCode: knowledge.municipalityCode,
        geometry: geometry(),
      });

      expect(result.classification).toMatchObject({ code: 'SU', categoryCode: 'SUC' });
      expect(result.classificationResolution?.status).toBe('clear');
      expect(new URL(String(fetcher.mock.calls[0][0])).searchParams.get('TYPENAME')).toBe(
        knowledge.classificationLayer.name
      );
    }
  );

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

  it('registra Sada y normaliza todos los atributos oficiales de una clasificación clara', async () => {
    const fetcher = response(
      gml(
        feature('sada.131', 'SNR', 'SNRT', sadaRing, undefined, {
          legalClassification: 'SNR',
          legalCategory: 'SNRT',
          planningCategory: 'SNRH',
          use: 'residencial',
          enclosureId: '28089_00131',
          geometryArea: 3770,
          status: 'alta',
          version: '28089',
        })
      )
    );
    const result = await new SiotugaClassificationAdapter(
      sadaPlanning(),
      fetcher,
      1_000,
      () => NOW
    ).findApplicablePlanning({ municipalityCode: '15075', geometry: geometry(sadaRing) });

    expect(result.classificationResolution).toMatchObject({
      status: 'clear',
      nextAction: 'auto_accept',
      automaticSelection: {
        classificationCode: 'SNR',
        categoryCode: 'SNRT',
      },
    });
    expect(result.classificationResolution?.candidates[0].officialAttributes).toEqual([
      {
        sourceFeatureId: 'sada.131',
        enclosureId: '28089_00131',
        classificationCode: 'SNR',
        categoryCode: 'SNRT',
        legalClassificationCode: 'SNR',
        legalCategoryCode: 'SNRT',
        planningCategoryCode: 'SNRH',
        denomination: undefined,
        use: 'residencial',
        geometryAreaSquareMetres: 3770,
        status: 'alta',
        version: '28089',
      },
    ]);
    const sada = SIOTUGA_CLASSIFICATION_LAYERS.find(
      (layer) => layer.municipalityCode === '15075'
    );
    expect(sada).toMatchObject({
      layerName: '_15075_PXOM_201710_AD_3CLAS_28089',
      status: 'active',
      instrument: { siotugaDocumentId: '28089', approvalDate: '2017-10-11' },
      source: { provider: 'siotuga' },
    });
    const url = new URL(String(fetcher.mock.calls[0][0]));
    expect(url.searchParams.get('TYPENAME')).toBe('_15075_PXOM_201710_AD_3CLAS_28089');
  });

  it('conserva varias intersecciones reales de Sada sin elegir el primer recinto', async () => {
    const left: Array<[number, number]> = [
      [-8.2977, 43.37859],
      [-8.297645, 43.37859],
      [-8.297645, 43.37869],
      [-8.2977, 43.37869],
      [-8.2977, 43.37859],
    ];
    const right: Array<[number, number]> = [
      [-8.297645, 43.37859],
      [-8.29759, 43.37859],
      [-8.29759, 43.37869],
      [-8.297645, 43.37869],
      [-8.297645, 43.37859],
    ];
    const result = await new SiotugaClassificationAdapter(
      sadaPlanning(),
      response(
        gml(
          feature('sada-rural', 'SR', 'SRPO', left, undefined, {
            status: 'alta',
            version: '28089',
          }),
          feature('sada-nucleus', 'SNR', 'SNRC', right, undefined, {
            status: 'alta',
            version: '28089',
          })
        )
      ),
      1_000,
      () => NOW
    ).findApplicablePlanning({ municipalityCode: '15075', geometry: geometry(sadaRing) });

    expect(result.classification).toBeUndefined();
    expect(result.classificationResolution).toMatchObject({
      status: 'multiple_intersections',
      nextAction: 'manual_selection',
    });
    expect(result.classificationResolution?.candidates).toHaveLength(2);
    expect(
      result.classificationResolution?.candidates.map(
        (candidate) => candidate.parcelCoverage?.parcelPercentage
      )
    ).toEqual([50, 50]);
  });

  it('exige revisión cuando un recinto urbano de Sada puede estar afectado por APT-UEI-8', async () => {
    const result = await new SiotugaClassificationAdapter(
      sadaPlanning(),
      response(
        gml(
          feature('sada-urban', 'SU', 'SUSC', sadaRing, undefined, {
            legalClassification: 'SU',
            legalCategory: 'SUSC',
            planningCategory: 'SU-R',
            enclosureId: '28089_00001',
            status: 'alta',
            version: '28089',
          })
        )
      ),
      1_000,
      () => NOW
    ).findApplicablePlanning({ municipalityCode: '15075', geometry: geometry(sadaRing) });

    expect(result.classification).toMatchObject({ code: 'SU', categoryCode: 'SUSC' });
    expect(result.classificationResolution).toMatchObject({
      status: 'probable',
      confidenceLevel: 'probable',
      nextAction: 'review_official_sources',
    });
    expect(result.classificationResolution?.reviewReasons).toContain(
      'planning_update_scope_pending'
    );
    expect(result.classificationResolution?.officialLinks).toContainEqual(
      expect.objectContaining({ label: expect.stringContaining('APT-UEI-8') })
    );
  });

  it('mantiene el instrumento de Sada si la fuente WFS no está disponible', async () => {
    const result = await new SiotugaClassificationAdapter(
      sadaPlanning(),
      vi.fn(async () => {
        throw new Error('network unavailable');
      })
    ).findApplicablePlanning({ municipalityCode: '15075', geometry: geometry(sadaRing) });

    expect(result.instrument).toBe('Plan general de ordenación municipal');
    expect(result.classification).toBeUndefined();
    expect(result.classificationResolution).toMatchObject({
      status: 'source_unavailable',
      nextAction: 'retry_source',
    });
  });

  it('mantiene compatibilidad con respuestas históricas sin los atributos ampliados', async () => {
    const result = await new SiotugaClassificationAdapter(
      sadaPlanning(),
      response(gml(feature('historical-shape', 'SNR', 'SNRT', sadaRing)))
    ).findApplicablePlanning({ municipalityCode: '15075', geometry: geometry(sadaRing) });

    expect(result.classificationResolution?.status).toBe('clear');
    expect(result.classificationResolution?.candidates[0].officialAttributes).toEqual([
      expect.objectContaining({
        sourceFeatureId: 'historical-shape',
        classificationCode: 'SNR',
        categoryCode: 'SNRT',
      }),
    ]);
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
    expect(result.classification).toMatchObject({ code: 'SU', categoryCode: 'SUC' });
    expect(result.classificationResolution).toMatchObject({
      status: 'probable',
      nextAction: 'review_official_sources',
      automaticSelection: { classificationCode: 'SU', categoryCode: 'SUC' },
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

  it('no convierte en rústica toda la parcela 15009A01300255 cuando SNR sólo intersecta su borde norte', async () => {
    const parcelRing = coordinateRing(
      `-8.217531 43.269062 -8.217539 43.26908 -8.217545 43.269098
      -8.217547 43.269114 -8.217546 43.269128 -8.217542 43.26914
      -8.217537 43.269151 -8.217529 43.26916 -8.217517 43.269169
      -8.217501 43.269179 -8.217481 43.269189 -8.217454 43.2692
      -8.217422 43.269212 -8.217383 43.269225 -8.217338 43.269239
      -8.217287 43.269255 -8.217246 43.269268 -8.217234 43.269271
      -8.217191 43.269286 -8.217183 43.269289 -8.217136 43.269306
      -8.217094 43.269323 -8.217056 43.269341 -8.21702 43.269358
      -8.216987 43.269376 -8.216958 43.269395 -8.216932 43.269416
      -8.216912 43.269441 -8.216895 43.26947 -8.216883 43.269505
      -8.216874 43.269545 -8.216868 43.269588 -8.216863 43.269634
      -8.216858 43.26968 -8.216854 43.269724 -8.216848 43.269767
      -8.216842 43.269807 -8.216836 43.269846 -8.216831 43.269884
      -8.216825 43.269921 -8.216817 43.269959 -8.216808 43.269995
      -8.216798 43.27003 -8.216787 43.270061 -8.216777 43.270086
      -8.216767 43.270107 -8.216757 43.270126 -8.216751 43.270138
      -8.216747 43.270147 -8.216735 43.270169 -8.216725 43.270194
      -8.216715 43.270223 -8.216708 43.270255 -8.216703 43.270289
      -8.216702 43.270325 -8.216703 43.270361 -8.216706 43.2704
      -8.21671 43.270439 -8.216715 43.270484 -8.216721 43.270539
      -8.21673 43.270612 -8.216742 43.270719 -8.216757 43.270882
      -8.216757 43.270921 -8.21671 43.2709 -8.216633 43.27088
      -8.216529 43.270862 -8.216472 43.270855 -8.21642 43.270852
      -8.216427 43.270793 -8.21643 43.270743 -8.216431 43.27071
      -8.216431 43.270683 -8.216431 43.27066 -8.216431 43.27064
      -8.216431 43.270621 -8.21643 43.270602 -8.216427 43.270584
      -8.216423 43.270565 -8.216418 43.270547 -8.216411 43.270528
      -8.216403 43.270508 -8.216394 43.270489 -8.216384 43.270469
      -8.216373 43.270449 -8.216361 43.27043 -8.216349 43.270412
      -8.216335 43.270395 -8.216317 43.270377 -8.216292 43.270355
      -8.216259 43.270326 -8.216219 43.270295 -8.216179 43.270263
      -8.21614 43.270234 -8.216135 43.27023 -8.216104 43.270207
      -8.21607 43.270181 -8.216035 43.270155 -8.215996 43.270126
      -8.215947 43.270091 -8.215885 43.270046 -8.215808 43.26999
      -8.21571 43.269918 -8.21612 43.269703 -8.21616 43.269689
      -8.216206 43.269673 -8.216255 43.269651 -8.21631 43.269628
      -8.216369 43.269605 -8.21643 43.269581 -8.216491 43.269556
      -8.216523 43.269541 -8.216549 43.269529 -8.216605 43.269499
      -8.216658 43.269468 -8.216708 43.269433 -8.216753 43.269397
      -8.216792 43.269364 -8.216827 43.269334 -8.216859 43.269308
      -8.216892 43.269284 -8.216922 43.269265 -8.216932 43.269259
      -8.216977 43.269236 -8.217026 43.269212 -8.217079 43.269188
      -8.217132 43.269165 -8.217181 43.269146 -8.217225 43.26913
      -8.217265 43.269117 -8.217306 43.269108 -8.217352 43.269098
      -8.217419 43.26908 -8.217523 43.269045 -8.217531 43.269062`,
      'lng-lat'
    );
    const officialRuralRing = coordinateRing(
      `43.272742 -8.217209 43.272634 -8.216811 43.272565 -8.216405
      43.272518 -8.215915 43.272499 -8.215501 43.272487 -8.215350
      43.272546 -8.215244 43.272617 -8.215047 43.272127 -8.214321
      43.271955 -8.214165 43.271969 -8.213811 43.271990 -8.213667
      43.272016 -8.213486 43.272158 -8.213295 43.272169 -8.213182
      43.272119 -8.213190 43.271982 -8.213253 43.271844 -8.213284
      43.271690 -8.213339 43.271704 -8.213671 43.271588 -8.213755
      43.271462 -8.213795 43.271352 -8.213879 43.271177 -8.213964
      43.271017 -8.214019 43.271047 -8.214411 43.271153 -8.214485
      43.271033 -8.214780 43.271094 -8.214795 43.271009 -8.215248
      43.271158 -8.215314 43.271054 -8.215406 43.270972 -8.215422
      43.270879 -8.215506 43.270824 -8.215643 43.270820 -8.215741
      43.270754 -8.215855 43.270667 -8.215954 43.270739 -8.216074
      43.270641 -8.216248 43.270383 -8.216320 43.270356 -8.216388
      43.270176 -8.216631 43.270099 -8.216745 43.270226 -8.216691
      43.270325 -8.216690 43.270926 -8.216780 43.270977 -8.216930
      43.271060 -8.217050 43.271254 -8.217206 43.271536 -8.217345
      43.271639 -8.217103 43.271816 -8.217176 43.272082 -8.217406
      43.272360 -8.217840 43.272742 -8.217209`,
      'lat-lng'
    );
    const result = await new SiotugaClassificationAdapter(
      new BetanzosPlanningAdapter(culleredoPlanning(), () => NOW),
      response(
        gml(
          feature(
            '_15009_NNSSPP_199606_AD_3CLAS_22221.916',
            'SNR',
            'SNRSC',
            officialRuralRing,
            'CASCAS'
          )
        )
      ),
      1_000,
      () => NOW
    ).findApplicablePlanning({
      municipalityCode: '15009',
      coordinates: { lat: 43.2699709058701, lng: -8.21652713669663 },
      geometry: geometry(parcelRing),
    });

    expect(result.classification).toBeUndefined();
    expect(result.classificationResolution).toMatchObject({
      status: 'review_required',
      nextAction: 'review_official_sources',
    });
    expect(result.classificationResolution?.proposal).toBeUndefined();
    expect(result.classificationResolution?.automaticSelection).toBeUndefined();
    expect(result.classificationResolution?.reviewReasons).toContain(
      'partial_parcel_coverage'
    );
    expect(result.classificationResolution?.candidates[0]).toMatchObject({
      classification: { code: 'SNR', categoryCode: 'SNRSC' },
      areas: [{ type: 'nucleus', name: 'CASCAS' }],
    });
    expect(
      result.classificationResolution?.candidates[0].parcelCoverage?.parcelPercentage
    ).toBeCloseTo(22.16, 1);
    expect(
      result.classificationResolution?.candidates[0].parcelCoverage
        ?.intersectionAreaSquareMetres
    ).toBeGreaterThan(0);
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
    expect(
      matchesRegisteredInstrument(
        {
          status: 'partial',
          instrument: 'Nombre consolidado distinto al inventario general',
          approvalDate: '1987-07-29',
          applicableInstruments: [
            {
              id: '22310',
              name: 'Instrumento vigente',
              kind: 'general',
              status: 'current',
              sourceUrl: culleredo.instrument.inventoryUrl,
            },
          ],
          evidence: [],
          warnings: [],
        },
        culleredo
      )
    ).toBe(true);
  });
});
