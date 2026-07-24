'use client';

import { useEffect } from 'react';
import type { Feature, MultiPolygon } from 'geojson';
import type { Map as LeafletMap } from 'leaflet';
import {
  CircleMarker,
  GeoJSON,
  MapContainer,
  TileLayer,
  useMap,
  WMSTileLayer,
} from 'react-leaflet';

import type {
  ParcelGeometry,
  TerritorialCoordinates,
} from '@/domain/territorial-resolver/types';
import { getBaseMapLayer, type BaseMapLayerId } from './baseMapLayers';

interface Props {
  geometry?: ParcelGeometry;
  coordinates?: TerritorialCoordinates;
  baseLayerId: BaseMapLayerId;
}

export function parcelGeometryBounds(
  geometry: ParcelGeometry
): [number, number][] | undefined {
  const points = geometry.coordinates.flatMap((polygon) =>
    polygon.flatMap((ring) => ring.map(([lng, lat]) => [lat, lng] as [number, number]))
  );
  return points.length ? points : undefined;
}

export function applyParcelViewport(
  map: LeafletMap,
  geometry?: ParcelGeometry,
  coordinates?: TerritorialCoordinates
) {
  const bounds = geometry ? parcelGeometryBounds(geometry) : undefined;
  if (bounds) {
    map.fitBounds(bounds, { padding: [24, 24], maxZoom: 19 });
  } else if (coordinates) {
    map.setView([coordinates.lat, coordinates.lng], 18);
  }
}

function MapViewportController({ geometry, coordinates }: Omit<Props, 'baseLayerId'>) {
  const map = useMap();

  useEffect(() => {
    applyParcelViewport(map, geometry, coordinates);
  }, [coordinates, geometry, map]);

  useEffect(() => {
    const container = map.getContainer();
    const observer = new ResizeObserver(([entry]) => {
      if (!entry || entry.contentRect.width === 0 || entry.contentRect.height === 0) return;
      map.invalidateSize({ animate: false });
      applyParcelViewport(map, geometry, coordinates);
    });
    observer.observe(container);
    return () => observer.disconnect();
  }, [coordinates, geometry, map]);

  return null;
}

function initialCenter(
  geometry?: ParcelGeometry,
  coordinates?: TerritorialCoordinates
): [number, number] {
  if (coordinates) return [coordinates.lat, coordinates.lng];
  const first = geometry?.coordinates[0]?.[0]?.[0];
  return first ? [first[1], first[0]] : [42.8, -8];
}

export default function LeafletParcelMap({ geometry, coordinates, baseLayerId }: Props) {
  const baseLayer = getBaseMapLayer(baseLayerId);
  const parcelFeature: Feature<MultiPolygon> | undefined = geometry
    ? {
        type: 'Feature',
        properties: {},
        geometry: {
          type: 'MultiPolygon',
          coordinates: geometry.coordinates,
        },
      }
    : undefined;
  const geometryKey = geometry ? JSON.stringify(geometry.coordinates) : 'no-geometry';

  return (
    <div
      role="region"
      aria-label="Mapa de localización de la parcela"
      className="h-[320px] w-full overflow-hidden rounded-md sm:h-[380px]"
    >
      <MapContainer
        center={initialCenter(geometry, coordinates)}
        zoom={18}
        minZoom={3}
        maxZoom={21}
        scrollWheelZoom
        className="h-full w-full"
      >
        {baseLayer.kind === 'wms' ? (
          <WMSTileLayer
            key={baseLayer.id}
            url={baseLayer.url}
            layers={baseLayer.layers}
            format={baseLayer.format}
            transparent={baseLayer.transparent}
            version={baseLayer.version}
            attribution={baseLayer.attribution}
            maxZoom={baseLayer.maxZoom}
          />
        ) : (
          <TileLayer
            key={baseLayer.id}
            url={baseLayer.url}
            attribution={baseLayer.attribution}
            maxNativeZoom={baseLayer.maxNativeZoom}
            maxZoom={baseLayer.maxZoom}
          />
        )}

        {parcelFeature ? (
          <GeoJSON
            key={geometryKey}
            data={parcelFeature}
            style={{
              color: '#f97316',
              weight: 3,
              fillColor: '#f97316',
              fillOpacity: 0.22,
            }}
          />
        ) : coordinates ? (
          <CircleMarker
            center={[coordinates.lat, coordinates.lng]}
            radius={8}
            pathOptions={{
              color: '#c2410c',
              weight: 3,
              fillColor: '#f97316',
              fillOpacity: 0.75,
            }}
          />
        ) : null}

        <MapViewportController geometry={geometry} coordinates={coordinates} />
      </MapContainer>
    </div>
  );
}
