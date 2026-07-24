import { describe, expect, it } from 'vitest';

import { BASE_MAP_LAYERS, getBaseMapLayer } from './baseMapLayers';

describe('baseMapLayers', () => {
  it('registra únicamente las tres capas base aprobadas', () => {
    expect(BASE_MAP_LAYERS.map((layer) => layer.id)).toEqual(['catastro', 'pnoa', 'osm']);
  });

  it('usa servicios HTTPS oficiales y conserva sus atribuciones', () => {
    const catastro = getBaseMapLayer('catastro');
    const pnoa = getBaseMapLayer('pnoa');
    const osm = getBaseMapLayer('osm');

    expect(catastro).toMatchObject({ kind: 'wms', layers: 'CATASTRO' });
    expect(catastro.url).toMatch(/^https:\/\/ovc\.catastro\.meh\.es\//);
    expect(pnoa.url).toMatch(/^https:\/\/tms-pnoa-ma\.idee\.es\//);
    expect(osm.url).toBe('https://tile.openstreetmap.org/{z}/{x}/{y}.png');
    expect(BASE_MAP_LAYERS.every((layer) => layer.attribution.length > 0)).toBe(true);
  });
});
