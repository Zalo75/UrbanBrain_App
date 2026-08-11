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
import { Crosshair, Maximize2, MapPinned } from 'lucide-react'
import 'leaflet/dist/leaflet.css'

import type { ParcelGeometry } from '@/domain/territorial-resolver/types'

type ViewerMode = 'actual' | 'planeamiento' | 'comparar'
type ViewerLayer = 'parcel' | 'actionArea' | 'classification' | 'category' | 'affects' | 'historic'
type ViewTarget = 'adjust' | 'parcel' | 'action'

interface AffectLegendItem {
  category: string
  name: string
  confidence: string
}

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
  classificationCode?: string
  categoryCode?: string
  affects?: AffectLegendItem[]
}

const AFFECT_STYLES: Array<{ key: string; label: string; color: string }> = [
  { key: 'carretera', label: 'Carreteras', color: '#dc2626' },
  { key: 'camino', label: 'Camino de Santiago', color: '#d97706' },
  { key: 'dominio', label: 'Dominio público', color: '#7c3aed' },
  { key: 'natura', label: 'Red Natura', color: '#15803d' },
  { key: 'patrimonio', label: 'Patrimonio', color: '#a16207' },
  { key: 'agua', label: 'Aguas', color: '#0284c7' },
]

function classificationColor(classificationCode?: string, categoryCode?: string) {
  const category = categoryCode?.toUpperCase() ?? ''
  const classification = classificationCode?.toUpperCase() ?? ''
  if (category.includes('PROT') || category.includes('ESP') || classification.includes('SRP')) return '#166534'
  if (['SU', 'SUC', 'SUSC'].includes(classification) || category.startsWith('SU')) return '#6b7280'
  if (classification === 'SNR' || category.startsWith('SNR')) return '#f97316'
  if (['SUB', 'SUS', 'SUNP', 'SAU'].includes(classification)) return '#2563eb'
  if (classification === 'SR' || category.startsWith('SR')) return '#16a34a'
  return '#64748b'
}

function affectStyle(category: string) {
  const normalized = category.toLocaleLowerCase('es-ES')
  return AFFECT_STYLES.find((style) => normalized.includes(style.key)) ?? {
    label: category,
    color: '#64748b',
  }
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
  viewTarget,
}: Pick<Props, 'parcelGeometry' | 'actionAreaGeometry'> & { centerTrigger: number; viewTarget: ViewTarget }) {
  const map = useMap()
  const fitView = useCallback(() => {
    const bounds =
      viewTarget === 'action'
        ? boundsForGeometry(actionAreaGeometry) ?? boundsForGeometry(parcelGeometry)
        : boundsForGeometry(parcelGeometry) ?? boundsForGeometry(actionAreaGeometry)
    if (bounds) map.fitBounds(bounds.pad(0.25), { maxZoom: 18 })
  }, [actionAreaGeometry, map, parcelGeometry, viewTarget])

  useEffect(() => {
    fitView()
  }, [centerTrigger, fitView])

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
  classificationCode,
  categoryCode,
  affects = [],
}: Props) {
  const [mode, setMode] = useState<ViewerMode>('actual')
  const [pordOpacity, setPordOpacity] = useState(MODE_DEFAULTS.actual.pordOpacity)
  const [centerTrigger, setCenterTrigger] = useState(0)
  const [viewTarget, setViewTarget] = useState<ViewTarget>('adjust')
  const [wmsFailed, setWmsFailed] = useState(false)
  const [visibleLayers, setVisibleLayers] = useState<Record<ViewerLayer, boolean>>({
    parcel: true,
    actionArea: true,
    classification: true,
    category: true,
    affects: true,
    historic: false,
  })

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
    setVisibleLayers((current) => ({ ...current, historic: nextMode !== 'actual' }))
  }

  function setView(target: ViewTarget) {
    setViewTarget(target)
    setCenterTrigger((value) => value + 1)
  }

  function toggleLayer(layer: ViewerLayer) {
    setVisibleLayers((current) => ({ ...current, [layer]: !current[layer] }))
  }

  const mapCenter: [number, number] = [43.28, -8.21]
  const classifiedGeometry = actionAreaGeometry ?? parcelGeometry
  const classColor = classificationColor(classificationCode, categoryCode)

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
              opacity={visibleLayers.historic ? pordOpacity : 0}
              maxZoom={20}
              crs={L.CRS.EPSG4326}
              zIndex={10}
              eventHandlers={{ tileerror: () => setWmsFailed(true) }}
            />
          )}

          {visibleLayers.classification && classificationCode && classifiedGeometry && (
            <GeoJSON
              data={classifiedGeometry as GeoJsonObject}
              style={{ color: classColor, weight: 1, fillColor: classColor, fillOpacity: 0.26 }}
            />
          )}
          {visibleLayers.category && categoryCode && classifiedGeometry && (
            <GeoJSON
              data={classifiedGeometry as GeoJsonObject}
              style={{ color: classColor, weight: 3, dashArray: '7 5', fillOpacity: 0 }}
            />
          )}
          {visibleLayers.parcel && parcelGeometry && (
            <GeoJSON
              data={parcelGeometry as GeoJsonObject}
              style={{ color: '#be123c', weight: 4, fillColor: '#be123c', fillOpacity: 0.03 }}
            />
          )}
          {visibleLayers.actionArea && actionAreaGeometry && (
            <GeoJSON
              data={actionAreaGeometry as GeoJsonObject}
              style={{ color: '#2563eb', weight: 5, fillColor: '#3b82f6', fillOpacity: 0.22 }}
            />
          )}

          {visibleLayers.parcel && <GeometryLabel geometry={parcelGeometry} label="Parcela" color="#be123c" />}
          {visibleLayers.actionArea && <GeometryLabel geometry={actionAreaGeometry} label="Actuación" color="#2563eb" />}
          <MapViewport
            parcelGeometry={parcelGeometry}
            actionAreaGeometry={actionAreaGeometry}
            centerTrigger={centerTrigger}
            viewTarget={viewTarget}
          />
        </MapContainer>

        <aside className="absolute left-3 top-3 z-[1000] w-48 rounded-md border bg-background/95 p-3 text-xs shadow-md backdrop-blur" aria-label="Capas del visor">
          <p className="mb-2 font-semibold text-foreground">Capas</p>
          <div className="space-y-2">
            {([
              ['parcel', 'Parcela'],
              ['actionArea', 'Zona de actuación'],
              ['classification', 'Clasificación'],
              ['category', 'Categoría'],
              ['affects', 'Afecciones'],
              ['historic', 'Plano histórico'],
            ] as Array<[ViewerLayer, string]>).map(([layer, label]) => (
              <label key={layer} className="flex cursor-pointer items-center gap-2 text-muted-foreground">
                <input type="checkbox" checked={visibleLayers[layer]} onChange={() => toggleLayer(layer)} className="accent-primary" />
                {label}
              </label>
            ))}
          </div>
          {visibleLayers.affects && affects.length > 0 && (
            <div className="mt-3 border-t pt-2">
              <p className="mb-1 font-medium text-foreground">Afecciones detectadas</p>
              <ul className="space-y-1">
                {affects.map((affect) => {
                  const style = affectStyle(affect.category)
                  return (
                    <li key={`${affect.category}-${affect.name}`} className="flex items-center gap-1.5" title="Sin geometría vectorial disponible para situarla en el mapa">
                      <i data-testid="affect-symbol" data-color={style.color} className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: style.color }} />
                      <span>{style.label}: {affect.name}</span>
                    </li>
                  )
                })}
              </ul>
            </div>
          )}
        </aside>

        <div className="absolute bottom-4 right-4 z-[1000] flex flex-col gap-2">
          <button type="button" onClick={() => setView('adjust')} className="inline-flex items-center gap-2 rounded-md border bg-background px-3 py-2 text-xs font-medium shadow-md hover:bg-muted">
            <Maximize2 className="h-4 w-4" /> Ajustar vista
          </button>
          <button type="button" onClick={() => setView('parcel')} className="inline-flex items-center gap-2 rounded-md border bg-background px-3 py-2 text-xs font-medium shadow-md hover:bg-muted">
            <MapPinned className="h-4 w-4" /> Centrar parcela
          </button>
          <button type="button" onClick={() => setView('action')} className="inline-flex items-center gap-2 rounded-md border bg-background px-3 py-2 text-xs font-medium shadow-md hover:bg-muted">
            <Crosshair className="h-4 w-4" /> Centrar actuación
          </button>
        </div>
      </div>

      {wmsFailed && (
        <p role="status" className="text-xs text-amber-800 dark:text-amber-300">
          El plano oficial no respondió. La parcela y la zona de trabajo siguen disponibles sobre la cartografía actual.
        </p>
      )}

      <div className="flex flex-wrap gap-4 text-xs text-muted-foreground" aria-label="Leyenda">
        {parcelGeometry && <span className="inline-flex items-center gap-1"><i className="h-3 w-3 rounded-sm border-[3px] border-rose-700" /> Parcela</span>}
        {actionAreaGeometry && <span className="inline-flex items-center gap-1"><i className="h-3 w-3 rounded-sm border-[3px] border-blue-600 bg-blue-500/30" /> Actuación</span>}
        {classificationCode && <span className="inline-flex items-center gap-1"><i className="h-3 w-3 rounded-sm" style={{ backgroundColor: classColor }} /> Clasificación {classificationCode}</span>}
        {categoryCode && <span className="inline-flex items-center gap-1"><i className="h-3 w-3 border-2 border-dashed" style={{ borderColor: classColor }} /> Categoría {categoryCode}</span>}
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
