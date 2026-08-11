import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const fitBounds = vi.fn()

vi.mock('react-leaflet', () => ({
  MapContainer: ({ children }: { children: ReactNode }) => <div data-testid="map-container">{children}</div>,
  TileLayer: ({ opacity }: { opacity?: number }) => <div data-testid="base-tile-layer" data-opacity={opacity} />,
  WMSTileLayer: ({
    crs,
    url,
    layers,
    opacity,
    eventHandlers,
  }: {
    crs?: { code?: string }
    url?: string
    layers?: string
    opacity?: number
    eventHandlers?: { tileerror?: () => void }
  }) => (
    <button
      type="button"
      data-testid="wms-tile-layer"
      data-crs={crs?.code ?? 'missing'}
      data-url={url}
      data-layers={layers}
      data-opacity={opacity}
      onClick={() => eventHandlers?.tileerror?.()}
    />
  ),
  GeoJSON: ({ style }: { style?: { color?: string; weight?: number; fillOpacity?: number; dashArray?: string } }) => (
    <div
      data-testid="geojson"
      data-color={style?.color}
      data-weight={style?.weight}
      data-fill-opacity={style?.fillOpacity}
      data-dash-array={style?.dashArray}
    />
  ),
  CircleMarker: ({ children }: { children: ReactNode }) => <div data-testid="center-marker">{children}</div>,
  Tooltip: ({ children }: { children: ReactNode }) => <span>{children}</span>,
  useMap: () => ({ fitBounds }),
}))

vi.mock('leaflet', () => {
  const bounds = {
    isValid: () => true,
    pad: vi.fn(() => bounds),
    getCenter: () => ({ lat: 43.28, lng: -8.21 }),
  }
  const leaflet = {
    CRS: { EPSG4326: { code: 'EPSG:4326' } },
    geoJSON: () => ({ getBounds: () => bounds }),
  }
  return { ...leaflet, default: leaflet }
})

import LeafletPordViewer from './LeafletPordViewer'
import { PordPlanViewer } from './PordPlanViewer'

const parcelGeometry = {
  type: 'MultiPolygon' as const,
  crs: 'EPSG:4326' as const,
  coordinates: [[[[-8.22, 43.28], [-8.21, 43.28], [-8.21, 43.29], [-8.22, 43.28]]]],
}

const actionAreaGeometry = {
  type: 'MultiPolygon' as const,
  crs: 'EPSG:4326' as const,
  coordinates: [[[[-8.218, 43.282], [-8.215, 43.282], [-8.215, 43.285], [-8.218, 43.282]]]],
}

describe('LeafletPordViewer', () => {
  beforeEach(() => {
    fitBounds.mockClear()
  })

  it('starts in Actual with PORD hidden and the modern base visible', () => {
    render(<LeafletPordViewer wmsLayer="_15009_NNSSPP_199606_AD_PORD_02CL_22221" />)

    expect(screen.getByRole('button', { name: 'Actual' }).getAttribute('aria-pressed')).toBe('true')
    expect(screen.getByTestId('wms-tile-layer').getAttribute('data-opacity')).toBe('0')
    expect(screen.getByTestId('base-tile-layer').getAttribute('data-opacity')).toBe('1')
  })

  it('changes between Actual, Planeamiento and Comparar with their initial opacities', () => {
    render(<LeafletPordViewer wmsLayer="_15009_NNSSPP_199606_AD_PORD_02CL_22221" />)

    fireEvent.click(screen.getByRole('button', { name: 'Planeamiento' }))
    expect(screen.getByTestId('wms-tile-layer').getAttribute('data-opacity')).toBe('0.9')
    expect(screen.getByTestId('base-tile-layer').getAttribute('data-opacity')).toBe('0.18')

    fireEvent.click(screen.getByRole('button', { name: 'Comparar' }))
    expect(screen.getByTestId('wms-tile-layer').getAttribute('data-opacity')).toBe('0.55')
    expect(screen.getByTestId('base-tile-layer').getAttribute('data-opacity')).toBe('1')
  })

  it('changes only the PORD opacity when the intensity slider moves', () => {
    render(<LeafletPordViewer wmsLayer="_15009_NNSSPP_199606_AD_PORD_02CL_22221" />)
    fireEvent.click(screen.getByRole('button', { name: 'Comparar' }))

    fireEvent.change(screen.getByLabelText('Intensidad del plano'), { target: { value: '70' } })

    expect(screen.getByRole('button', { name: 'Comparar' }).getAttribute('aria-pressed')).toBe('true')
    expect(screen.getByTestId('wms-tile-layer').getAttribute('data-opacity')).toBe('0.7')
    expect(screen.getByTestId('base-tile-layer').getAttribute('data-opacity')).toBe('1')
  })

  it('renders distinct parcel and action area styles and centers the action area', async () => {
    render(
      <LeafletPordViewer
        wmsLayer="_15009_NNSSPP_199606_AD_PORD_02CL_22221"
        parcelGeometry={parcelGeometry}
        actionAreaGeometry={actionAreaGeometry}
      />
    )

    const overlays = screen.getAllByTestId('geojson')
    expect(overlays[0].getAttribute('data-color')).toBe('#be123c')
    expect(overlays[0].getAttribute('data-weight')).toBe('4')
    expect(overlays[1].getAttribute('data-color')).toBe('#2563eb')
    expect(overlays[1].getAttribute('data-weight')).toBe('5')
    expect(screen.getAllByText('Parcela').length).toBeGreaterThanOrEqual(2)
    expect(screen.getAllByText('Actuación').length).toBeGreaterThanOrEqual(2)

    await waitFor(() => expect(fitBounds).toHaveBeenCalled())
    const initialCalls = fitBounds.mock.calls.length
    fireEvent.click(screen.getByRole('button', { name: /Centrar actuación/i }))
    await waitFor(() => expect(fitBounds.mock.calls.length).toBeGreaterThan(initialCalls))

    fireEvent.click(screen.getByRole('button', { name: /Centrar parcela/i }))
    fireEvent.click(screen.getByRole('button', { name: /Ajustar vista/i }))
    await waitFor(() => expect(fitBounds.mock.calls.length).toBeGreaterThan(initialCalls + 2))
  })

  it('toggles vector layers and applies the legal classification and category styles', () => {
    render(
      <LeafletPordViewer
        parcelGeometry={parcelGeometry}
        actionAreaGeometry={actionAreaGeometry}
        classificationCode="SU"
        categoryCode="SUSC"
      />
    )

    const overlays = screen.getAllByTestId('geojson')
    expect(overlays[0].getAttribute('data-color')).toBe('#6b7280')
    expect(overlays[0].getAttribute('data-fill-opacity')).toBe('0.26')
    expect(overlays[1].getAttribute('data-dash-array')).toBe('7 5')
    expect((screen.getByLabelText(/Clasificaci.n/i) as HTMLInputElement).checked).toBe(true)

    fireEvent.click(screen.getByLabelText(/Clasificaci.n/i))
    expect(screen.getAllByTestId('geojson')).toHaveLength(3)
  })

  it('shows affect symbols without inventing geometries for them', () => {
    render(
      <LeafletPordViewer
        affects={[
          { category: 'carreteras', name: 'Carretera', confidence: 'high' },
          { category: 'camino_de_santiago', name: 'Camino', confidence: 'high' },
          { category: 'dominio_publico', name: 'Dominio', confidence: 'high' },
          { category: 'red_natura', name: 'Natura', confidence: 'high' },
          { category: 'patrimonio', name: 'Patrimonio', confidence: 'high' },
          { category: 'aguas', name: 'Aguas', confidence: 'high' },
        ]}
      />
    )

    const symbols = screen.getAllByTestId('affect-symbol')
    expect(symbols).toHaveLength(6)
    expect(symbols.map((symbol) => symbol.getAttribute('data-color'))).toEqual([
      '#dc2626', '#d97706', '#7c3aed', '#15803d', '#a16207', '#0284c7',
    ])
    fireEvent.click(screen.getByLabelText('Afecciones'))
    expect(screen.queryByTestId('affect-symbol')).toBeNull()
  })

  it('keeps the current map and overlays usable if the WMS fails', () => {
    render(<LeafletPordViewer wmsLayer="_15009_NNSSPP_199606_AD_PORD_02CL_22221" parcelGeometry={parcelGeometry} />)

    fireEvent.click(screen.getByTestId('wms-tile-layer'))

    expect(screen.getByText(/plano oficial no respondió/i)).toBeTruthy()
    expect(screen.getByTestId('base-tile-layer')).toBeTruthy()
    expect(screen.getAllByText('Parcela').length).toBeGreaterThanOrEqual(2)
    expect(screen.queryByTestId('wms-tile-layer')).toBeNull()
  })

  it('uses EPSG:4326 for the official WMS request', () => {
    render(<LeafletPordViewer wmsLayer="_15009_NNSSPP_199606_AD_PORD_02CL_22221" />)

    expect(screen.getByTestId('wms-tile-layer').getAttribute('data-crs')).toBe('EPSG:4326')
    expect(screen.getByTestId('wms-tile-layer').getAttribute('data-url')).toBe(
      'https://siotuga.xunta.gal/siotuga/ws?codine=15009'
    )
  })
})

describe('PordPlanViewer', () => {
  it('does not render a map when no PORD layer is available', () => {
    render(<PordPlanViewer municipality="Betanzos" />)
    expect(screen.getByText(/No se ha detectado ninguna capa PORD/i)).toBeTruthy()
  })
})
