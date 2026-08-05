'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import type { GeoJsonObject } from 'geojson'
import L from 'leaflet'
import {
  CircleMarker,
  GeoJSON,
  MapContainer,
  TileLayer,
  Tooltip,
  useMap,
  WMSTileLayer,
} from 'react-leaflet'
import { Crosshair, MapPinned } from 'lucide-react'
import 'leaflet/dist/leaflet.css'

import type { ParcelGeometry } from '@/domain/territorial-resolver/types'

type ViewerMode = 'actual' | 'planeamiento' | 'comparar'

const MODE_DEFAULTS: Record<ViewerMode, { label: string; pordOpacity: number; baseOpacity: number }> = {
  actual: { label: 'Actual', pordOpacity: 0, baseOpacity: 1 },
  planeamiento: { label: 'Planeamiento', pordOpacity: 0.9, baseOpacity: 0.18 },
  comparar: { label: 'Comparar', pordOpacity: 0.55, baseOpacity: 1 },
}

interface Props {
  municipality?: string
  instrument?: string
  tileIndex?: string
  parcelGeometry?: ParcelGeometry
  actionAreaGeometry?: ParcelGeometry
  wmsLayer?: string
}

function boundsForGeometry(geometry?: ParcelGeometry) {
  if (!geometry) return undefined
  const bounds = L.geoJSON(geometry as GeoJsonObject).getBounds()
  return bounds.isValid() ? bounds : undefined
}

function MapViewport({
  parcelGeometry,
  actionAreaGeometry,
  centerTrigger,
}: Pick<Props, 'parcelGeometry' | 'actionAreaGeometry'> & { centerTrigger: number }) {
  const map = useMap()
  const fitActiveArea = useCallback(() => {
    const bounds = boundsForGeometry(actionAreaGeometry) ?? boundsForGeometry(parcelGeometry)
    if (bounds) map.fitBounds(bounds.pad(0.25), { maxZoom: 18 })
  }, [actionAreaGeometry, map, parcelGeometry])

  useEffect(() => {
    fitActiveArea()
  }, [centerTrigger, fitActiveArea])

  return null
}

function GeometryLabel({
  geometry,
  label,
  color,
}: {
  geometry?: ParcelGeometry
  label: string
  color: string
}) {
  const bounds = boundsForGeometry(geometry)
  if (!bounds) return null

  return (
    <CircleMarker center={bounds.getCenter()} radius={5} pathOptions={{ color, fillColor: '#ffffff', fillOpacity: 1, weight: 2 }}>
      <Tooltip permanent direction="top" offset={[0, -5]} className="pord-geometry-label">
        {label}
      </Tooltip>
    </CircleMarker>
  )
}

export default function LeafletPordViewer({
  municipality,
  instrument,
  tileIndex,
  parcelGeometry,
  actionAreaGeometry,
  wmsLayer,
}: Props) {
  const [mode, setMode] = useState<ViewerMode>('actual')
  const [pordOpacity, setPordOpacity] = useState(MODE_DEFAULTS.actual.pordOpacity)
  const [centerTrigger, setCenterTrigger] = useState(0)
  const [wmsFailed, setWmsFailed] = useState(false)

  const modeConfig = MODE_DEFAULTS[mode]
  const wmsUrl = useMemo(() => {
    const municipalityCode = wmsLayer?.split('_')[1]
    return municipalityCode
      ? `https://siotuga.xunta.gal/siotuga/ws?codine=${municipalityCode}`
      : 'https://siotuga.xunta.gal/siotuga/ws'
  }, [wmsLayer])

  function selectMode(nextMode: ViewerMode) {
    setMode(nextMode)
    setPordOpacity(MODE_DEFAULTS[nextMode].pordOpacity)
  }

  const mapCenter: [number, number] = [43.28, -8.21]

  return (
    <section className="space-y-3" aria-label="Visor comparativo PORD">
      <p role="note" className="rounded-md border border-amber-200 bg-amber-50 p-3 text-xs text-amber-950 dark:border-amber-900 dark:bg-amber-950/30 dark:text-amber-100">
        Este visor superpone la parcela actual sobre el plano oficial histórico. La correspondencia visual debe ser comprobada por el técnico.
      </p>

      <div className="flex flex-col gap-3 rounded-lg border bg-muted/30 p-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="inline-flex w-fit rounded-md border bg-background p-1" role="group" aria-label="Modo de visualización">
          {(Object.keys(MODE_DEFAULTS) as ViewerMode[]).map((item) => (
            <button
              key={item}
              type="button"
              aria-pressed={mode === item}
              onClick={() => selectMode(item)}
              className={`rounded px-3 py-1.5 text-sm font-medium transition-colors ${
                mode === item ? 'bg-primary text-primary-foreground shadow-sm' : 'hover:bg-muted'
              }`}
            >
              {MODE_DEFAULTS[item].label}
            </button>
          ))}
        </div>

        <label className="flex items-center gap-3 text-xs font-medium text-muted-foreground">
          Intensidad del plano
          <input
            aria-label="Intensidad del plano"
            type="range"
            min="0"
            max="100"
            step="5"
            value={Math.round(pordOpacity * 100)}
            onChange={(event) => setPordOpacity(Number(event.target.value) / 100)}
            className="w-28 accent-primary"
          />
          <output className="w-8 text-right text-foreground">{Math.round(pordOpacity * 100)}%</output>
        </label>
      </div>

      <div className="relative h-[480px] w-full overflow-hidden rounded-lg border bg-muted shadow-inner sm:h-[560px]">
        <MapContainer center={mapCenter} zoom={16} style={{ height: '100%', width: '100%', zIndex: 0 }}>
          <TileLayer
            url="https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png"
            maxZoom={20}
            opacity={modeConfig.baseOpacity}
            attribution="© OpenStreetMap contributors © CARTO"
          />

          {wmsLayer && !wmsFailed && (
            <WMSTileLayer
              url={wmsUrl}
              layers={wmsLayer}
              format="image/png"
              transparent
              version="1.1.1"
              opacity={pordOpacity}
              maxZoom={20}
              crs={L.CRS.EPSG4326}
              zIndex={10}
              eventHandlers={{ tileerror: () => setWmsFailed(true) }}
            />
          )}

          {parcelGeometry && (
            <GeoJSON
              data={parcelGeometry as GeoJsonObject}
              style={{ color: '#be123c', weight: 4, fillColor: '#be123c', fillOpacity: 0.03 }}
            />
          )}
          {actionAreaGeometry && (
            <GeoJSON
              data={actionAreaGeometry as GeoJsonObject}
              style={{ color: '#2563eb', weight: 5, fillColor: '#3b82f6', fillOpacity: 0.22 }}
            />
          )}

          <GeometryLabel geometry={parcelGeometry} label="Parcela" color="#be123c" />
          <GeometryLabel geometry={actionAreaGeometry} label="Actuación" color="#2563eb" />
          <MapViewport
            parcelGeometry={parcelGeometry}
            actionAreaGeometry={actionAreaGeometry}
            centerTrigger={centerTrigger}
          />
        </MapContainer>

        <button
          type="button"
          onClick={() => setCenterTrigger((value) => value + 1)}
          className="absolute bottom-4 right-4 z-[1000] inline-flex items-center gap-2 rounded-md border bg-background px-3 py-2 text-xs font-medium shadow-md hover:bg-muted"
        >
          <Crosshair className="h-4 w-4" /> Centrar actuación
        </button>
      </div>

      {wmsFailed && (
        <p role="status" className="text-xs text-amber-800 dark:text-amber-300">
          El plano oficial no respondió. La parcela y la zona de trabajo siguen disponibles sobre la cartografía actual.
        </p>
      )}

      <div className="flex flex-wrap gap-4 text-xs text-muted-foreground" aria-label="Leyenda">
        {parcelGeometry && <span className="inline-flex items-center gap-1"><i className="h-3 w-3 rounded-sm border-[3px] border-rose-700" /> Parcela</span>}
        {actionAreaGeometry && <span className="inline-flex items-center gap-1"><i className="h-3 w-3 rounded-sm border-[3px] border-blue-600 bg-blue-500/30" /> Actuación</span>}
      </div>

      <details className="rounded-md border bg-background p-3 text-xs text-muted-foreground">
        <summary className="cursor-pointer font-medium text-foreground">Información técnica</summary>
        <dl className="mt-3 grid gap-1.5 sm:grid-cols-2">
          <div><dt className="inline font-medium text-foreground">Municipio: </dt><dd className="inline">{municipality ?? 'No determinado'}</dd></div>
          <div><dt className="inline font-medium text-foreground">Instrumento: </dt><dd className="inline">{instrument ?? 'No determinado'}</dd></div>
          <div className="sm:col-span-2"><dt className="inline font-medium text-foreground">Capa WMS: </dt><dd className="inline break-all">{wmsLayer ?? 'No determinada'}</dd></div>
          <div><dt className="inline font-medium text-foreground">CRS: </dt><dd className="inline">EPSG:4326</dd></div>
          <div><dt className="inline font-medium text-foreground">Fecha de consulta: </dt><dd className="inline">{new Date().toLocaleString('es-ES')}</dd></div>
          {tileIndex && <div className="sm:col-span-2"><dt className="inline font-medium text-foreground">Hoja TILEINDEX: </dt><dd className="inline">{tileIndex}</dd></div>}
          <div className="sm:col-span-2"><dt className="inline font-medium text-foreground">Fuente: </dt><dd className="inline">SIOTUGA · Xunta de Galicia</dd></div>
        </dl>
      </details>
    </section>
  )
}
