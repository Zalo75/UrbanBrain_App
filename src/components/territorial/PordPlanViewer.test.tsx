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
  GeoJSON: ({ style }: { style?: { color?: string; weight?: number; fillOpacity?: number } }) => (
    <div
      data-testid="geojson"
      data-color={style?.color}
      data-weight={style?.weight}
      data-fill-opacity={style?.fillOpacity}
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
    expect(screen.getAllByText('Parcela')).toHaveLength(2)
    expect(screen.getAllByText('Actuación')).toHaveLength(2)

    await waitFor(() => expect(fitBounds).toHaveBeenCalled())
    const initialCalls = fitBounds.mock.calls.length
    fireEvent.click(screen.getByRole('button', { name: /Centrar actuación/i }))
    await waitFor(() => expect(fitBounds.mock.calls.length).toBeGreaterThan(initialCalls))
  })

  it('keeps the current map and overlays usable if the WMS fails', () => {
    render(<LeafletPordViewer wmsLayer="_15009_NNSSPP_199606_AD_PORD_02CL_22221" parcelGeometry={parcelGeometry} />)

    fireEvent.click(screen.getByTestId('wms-tile-layer'))

    expect(screen.getByText(/plano oficial no respondió/i)).toBeTruthy()
    expect(screen.getByTestId('base-tile-layer')).toBeTruthy()
    expect(screen.getAllByText('Parcela')).toHaveLength(2)
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
