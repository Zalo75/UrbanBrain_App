export type BaseMapLayerId = 'catastro' | 'pnoa' | 'osm';

interface BaseLayerCommon {
  id: BaseMapLayerId;
  label: string;
  attribution: string;
  maxZoom: number;
}

export interface XyzBaseMapLayer extends BaseLayerCommon {
  kind: 'xyz';
  url: string;
  maxNativeZoom: number;
}

export interface WmsBaseMapLayer extends BaseLayerCommon {
  kind: 'wms';
  url: string;
  layers: string;
  format: 'image/png';
  transparent: boolean;
  version: '1.1.1';
}

export type BaseMapLayer = XyzBaseMapLayer | WmsBaseMapLayer;

export const BASE_MAP_LAYERS: readonly BaseMapLayer[] = [
  {
    id: 'catastro',
    label: 'Catastro',
    kind: 'wms',
    url: 'https://ovc.catastro.meh.es/Cartografia/WMS/ServidorWMS.aspx',
    layers: 'CATASTRO',
    format: 'image/png',
    transparent: false,
    version: '1.1.1',
    attribution:
      '&copy; <a href="https://www.catastro.hacienda.gob.es/">Dirección General del Catastro</a>',
    maxZoom: 21,
  },
  {
    id: 'pnoa',
    label: 'PNOA',
    kind: 'xyz',
    url: 'https://tms-pnoa-ma.idee.es/1.0.0/pnoa-ma/{z}/{x}/{-y}.jpeg',
    attribution: '&copy; <a href="https://www.ign.es/">Instituto Geográfico Nacional</a>',
    maxNativeZoom: 19,
    maxZoom: 21,
  },
  {
    id: 'osm',
    label: 'OpenStreetMap',
    kind: 'xyz',
    url: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png',
    attribution:
      '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
    maxNativeZoom: 19,
    maxZoom: 21,
  },
];

export function getBaseMapLayer(id: BaseMapLayerId): BaseMapLayer {
  return BASE_MAP_LAYERS.find((layer) => layer.id === id) ?? BASE_MAP_LAYERS[0];
}
