import { describe, expect, it, vi } from 'vitest';
import type { Map as LeafletMap } from 'leaflet';

import type { ParcelGeometry } from '@/domain/territorial-resolver/types';
import { applyParcelViewport, parcelGeometryBounds } from './LeafletParcelMap';

const geometry: ParcelGeometry = {
  type: 'MultiPolygon',
  crs: 'EPSG:4326',
  coordinates: [
    [[[-8.218, 43.271], [-8.217, 43.272], [-8.216, 43.271], [-8.218, 43.271]]],
  ],
};

describe('LeafletParcelMap viewport', () => {
  it('convierte el orden GeoJSON longitud/latitud al orden esperado por Leaflet', () => {
    expect(parcelGeometryBounds(geometry)).toEqual([
      [43.271, -8.218],
      [43.272, -8.217],
      [43.271, -8.216],
      [43.271, -8.218],
    ]);
  });

  it('prioriza fitBounds para la geometría parcelaria', () => {
    const map = {
      fitBounds: vi.fn(),
      setView: vi.fn(),
    } as unknown as LeafletMap;

    applyParcelViewport(map, geometry, { lat: 43.27, lng: -8.21 });

    expect(map.fitBounds).toHaveBeenCalledWith(parcelGeometryBounds(geometry), {
      padding: [24, 24],
      maxZoom: 19,
    });
    expect(map.setView).not.toHaveBeenCalled();
  });

  it('centra el marcador cuando no existe geometría', () => {
    const map = {
      fitBounds: vi.fn(),
      setView: vi.fn(),
    } as unknown as LeafletMap;

    applyParcelViewport(map, undefined, { lat: 43.27, lng: -8.21 });

    expect(map.setView).toHaveBeenCalledWith([43.27, -8.21], 18);
    expect(map.fitBounds).not.toHaveBeenCalled();
  });
});
