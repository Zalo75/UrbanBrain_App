'use client';

import { useEffect, useMemo } from 'react';
import type { Feature, MultiPolygon } from 'geojson';
import type { Map as LeafletMap } from 'leaflet';
import polygonClipping from 'polygon-clipping';
import {
  CircleMarker,
  GeoJSON,
  MapContainer,
  TileLayer,
  useMap,
  WMSTileLayer,
} from 'react-leaflet';

import type {
  ClassificationCandidate,
  ParcelGeometry,
  TerritorialCoordinates,
} from '@/domain/territorial-resolver/types';
import { getBaseMapLayer, type BaseMapLayerId } from './baseMapLayers';

interface Props {
  geometry?: ParcelGeometry;
  coordinates?: TerritorialCoordinates;
  candidates?: ClassificationCandidate[];
  baseLayerId: BaseMapLayerId;
}

export function getCategoryStyle(
  categoryCode?: string,
  classificationCode?: string,
  index = 0
): { color: string; fillColor: string } {
  const code = (categoryCode || classificationCode || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  const knownStyles: Record<string, { color: string; fillColor: string }> = {
    SNRC: { color: '#047857', fillColor: '#10b981' },
    SNRT: { color: '#b45309', fillColor: '#f59e0b' },
    NR: { color: '#047857', fillColor: '#10b981' },
    NRC: { color: '#047857', fillColor: '#10b981' },
    NRT: { color: '#b45309', fillColor: '#f59e0b' },
    SUC: { color: '#1d4ed8', fillColor: '#3b82f6' },
    SUNC: { color: '#6d28d9', fillColor: '#8b5cf6' },
    SUSC: { color: '#7e22ce', fillColor: '#a855f7' },
    SRO: { color: '#374151', fillColor: '#6b7280' },
    SRP: { color: '#be123c', fillColor: '#f43f5e' },
    SRSC: { color: '#4b5563', fillColor: '#9ca3af' },
  };

  if (knownStyles[code]) return knownStyles[code];

  const fallbackPalette = [
    { color: '#047857', fillColor: '#10b981' },
    { color: '#b45309', fillColor: '#f59e0b' },
    { color: '#1d4ed8', fillColor: '#3b82f6' },
    { color: '#6d28d9', fillColor: '#8b5cf6' },
    { color: '#be123c', fillColor: '#f43f5e' },
  ];
  return fallbackPalette[index % fallbackPalette.length];
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

export default function LeafletParcelMap({ geometry, coordinates, candidates, baseLayerId }: Props) {
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
  const activeCandidates = (candidates ?? []).filter(
    (c) => c.parcelCoverage?.intersectionGeometry
  );

  const coveredPercentage = activeCandidates.reduce(
    (sum, c) => sum + (c.parcelCoverage?.parcelPercentage ?? 0),
    0
  );
  const uncoveredPercentage = Math.max(0, Math.round((100 - coveredPercentage) * 100) / 100);

  const uncoveredGeometry: ParcelGeometry | undefined = useMemo(() => {
    if (!geometry || activeCandidates.length === 0 || uncoveredPercentage < 0.5) {
      return undefined;
    }
    try {
      const parcelPolys = geometry.coordinates as [number, number][][][];
      const coveredPolys = activeCandidates.flatMap(
        (c) => c.parcelCoverage!.intersectionGeometry!.coordinates as [number, number][][][]
      );
      const diff = polygonClipping.difference(parcelPolys, coveredPolys);
      if (!diff || !diff.length) return undefined;
      return {
        type: 'MultiPolygon',
        coordinates: diff as [number, number][][][],
        crs: 'EPSG:4326',
      };
    } catch {
      return undefined;
    }
  }, [geometry, activeCandidates, uncoveredPercentage]);

  const uncoveredFeature: Feature<MultiPolygon> | undefined = uncoveredGeometry
    ? {
        type: 'Feature',
        properties: {
          title: 'Sin cobertura vectorial',
          percentage: uncoveredPercentage,
          description:
            'Esta zona no dispone de clasificación vectorial en la fuente SIOTUGA consultada. Requiere revisión profesional del planeamiento.',
        },
        geometry: {
          type: 'MultiPolygon',
          coordinates: uncoveredGeometry.coordinates,
        },
      }
    : undefined;

  return (
    <div
      role="region"
      aria-label="Mapa de localización de la parcela"
      className="relative h-[320px] w-full overflow-hidden rounded-md sm:h-[380px]"
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

        {uncoveredFeature && (
          <GeoJSON
            key={`uncovered-layer-${uncoveredPercentage}`}
            data={uncoveredFeature}
            style={{
              color: '#6b7280',
              weight: 1.5,
              fillColor: '#9ca3af',
              fillOpacity: 0.25,
              dashArray: '3,3',
            }}
            onEachFeature={(feat, layer) => {
              const p = feat.properties;
              const formattedPct = p.percentage.toLocaleString('es-ES', { maximumFractionDigits: 2 });
              const content = `
                <div style="font-family: sans-serif; font-size: 12px; line-height: 1.4; padding: 2px;">
                  <strong style="display: block; font-size: 13px; color: #374151; margin-bottom: 2px;">${p.title}</strong>
                  <span>Porcentaje: <strong>${formattedPct} % de la parcela</strong></span><br/>
                  <p style="margin-top: 4px; color: #4b5563; font-size: 11px;">${p.description}</p>
                </div>
              `;
              layer.bindTooltip(content, { sticky: true, direction: 'auto' });
              layer.bindPopup(content);
            }}
          />
        )}

        {activeCandidates.map((c, i) => {
          const geom = c.parcelCoverage!.intersectionGeometry!;
          const isOfficial = c.kind === 'official_classification';
          const style = isOfficial ? getCategoryStyle(c.classification.categoryCode, c.classification.code, i) : getCategoryStyle('', '', i);
          const name = isOfficial ? (c.classification.categoryLabel ?? c.classification.label) : 'Zona sin cobertura vectorial de clasificación';
          const code = isOfficial ? (c.classification.categoryCode ?? c.classification.code) : 'ND';
          const area = c.parcelCoverage!.intersectionAreaSquareMetres;
          const pct = c.parcelCoverage!.parcelPercentage;

          const categoryFeature: Feature<MultiPolygon> = {
            type: 'Feature',
            properties: {
              candidateId: c.id,
              title: name,
              code,
              area,
              percentage: pct,
            },
            geometry: {
              type: 'MultiPolygon',
              coordinates: geom.coordinates,
            },
          };

          return (
            <GeoJSON
              key={`cat-geom-${c.id}`}
              data={categoryFeature}
              style={{
                color: style.color,
                weight: 2,
                fillColor: style.fillColor,
                fillOpacity: 0.4,
              }}
              onEachFeature={(feat, layer) => {
                const p = feat.properties;
                const formattedArea = p.area.toLocaleString('es-ES', { maximumFractionDigits: 2 });
                const formattedPct = p.percentage.toLocaleString('es-ES', { maximumFractionDigits: 2 });
                const content = `
                  <div style="font-family: sans-serif; font-size: 12px; line-height: 1.4; padding: 2px;">
                    <strong style="display: block; font-size: 13px; margin-bottom: 2px;">${p.title}</strong>
                    <span style="color: #666; font-family: monospace;">Código: ${p.code}</span><br/>
                    <span>Superficie: <strong>${formattedArea} m²</strong></span><br/>
                    <span>Porcentaje: <strong>${formattedPct} % de la parcela</strong></span>
                  </div>
                `;
                layer.bindTooltip(content, { sticky: true, direction: 'auto' });
                layer.bindPopup(content);
              }}
            />
          );
        })}

        {parcelFeature ? (
          <GeoJSON
            key={geometryKey}
            data={parcelFeature}
            style={
              activeCandidates.length > 0
                ? {
                    color: '#ea580c',
                    weight: 3,
                    fillColor: 'transparent',
                    fillOpacity: 0,
                    dashArray: '5,5',
                  }
                : {
                    color: '#f97316',
                    weight: 3,
                    fillColor: '#f97316',
                    fillOpacity: 0.22,
                  }
            }
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

      {activeCandidates.length > 0 && (
        <div
          data-testid="map-category-legend"
          className="bg-background/95 border-border/80 absolute bottom-3 left-3 z-[1000] max-w-[280px] rounded-md border p-2.5 shadow-md backdrop-blur-sm sm:max-w-xs text-xs"
        >
          <p className="font-semibold text-[11px] uppercase tracking-wider text-muted-foreground mb-1.5">
            Categorías urbanísticas
          </p>
          <ul className="space-y-1">
            {activeCandidates.map((c, i) => {
              const isOfficial = c.kind === 'official_classification';
              const style = isOfficial ? getCategoryStyle(c.classification.categoryCode, c.classification.code, i) : getCategoryStyle('', '', i);
              const name = isOfficial ? (c.classification.categoryLabel ?? c.classification.label) : 'Zona sin cobertura vectorial de clasificación';
              const code = isOfficial ? (c.classification.categoryCode ?? c.classification.code) : 'ND';
              const pct = c.parcelCoverage?.parcelPercentage ?? 0;
              const formattedPct = pct.toLocaleString('es-ES', { maximumFractionDigits: 2 });
              return (
                <li key={c.id} className="flex items-start gap-2">
                  <span
                    className="mt-1 h-3 w-3 shrink-0 rounded-full border border-black/20"
                    style={{ backgroundColor: style.fillColor }}
                  />
                  <div className="flex-1">
                    <span className="block font-semibold">
                      {c.kind === 'official_classification'
                        ? (c.classification.categoryLabel ?? c.classification.label)
                        : 'Zona sin cobertura vectorial de clasificación'}
                    </span>
                    <span className="text-muted-foreground mt-0.5 block font-mono text-[10px]">
                      {c.kind === 'official_classification' && (
                        <>
                          {c.classification.code}
                          {c.classification.categoryCode ? ` / ${c.classification.categoryCode}` : ''}
                        </>
                      )}
                    </span>
                  </div>
                  <span className="ml-auto font-mono text-[11px] text-muted-foreground mt-1">
                    — {formattedPct} %
                  </span>
                </li>
              );
            })}
            {uncoveredPercentage >= 0.5 && (
              <li
                key="uncovered-legend-item"
                className="flex items-center gap-2 font-medium text-muted-foreground pt-1 border-t border-border/50"
              >
                <span className="h-3 w-3 shrink-0 rounded-full border border-dashed border-gray-500 bg-gray-300 dark:bg-gray-600" />
                <span className="truncate">Sin cobertura vectorial</span>
                <span className="ml-auto font-mono text-[11px] text-muted-foreground">
                  — {uncoveredPercentage.toLocaleString('es-ES', { maximumFractionDigits: 2 })} %
                </span>
              </li>
            )}
          </ul>
        </div>
      )}
    </div>
  );
}
