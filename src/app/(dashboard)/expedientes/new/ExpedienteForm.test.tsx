import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('./actions', () => ({
  createExpediente: vi.fn(),
  detectContextAction: vi.fn(),
  getPlanningOptionsAction: vi.fn(async () => []),
}))

vi.mock('@/components/maps/ParcelMap', () => ({
  ParcelMap: ({
    geometry,
    coordinates,
  }: {
    geometry?: unknown
    coordinates?: { lat: number; lng: number }
  }) => (
    <div
      data-testid="parcel-map"
      data-has-geometry={geometry ? 'true' : 'false'}
      data-coordinates={coordinates ? `${coordinates.lat},${coordinates.lng}` : ''}
    />
  ),
}))

import { ExpedienteForm } from './ExpedienteForm'
import { createExpediente, detectContextAction } from './actions'

const provinces = [
  { id: 'a_coruna', name: 'A Coruña', ccaaId: 'galicia', enabled: true },
  { id: 'lugo', name: 'Lugo', ccaaId: 'galicia', enabled: true },
]
const municipalities = [
  { id: 'culleredo', name: 'Culleredo', ineCode: '15031', provinceId: 'a_coruna', ccaaId: 'galicia', enabled: true, coverageStatus: 'active' as const },
  { id: 'betanzos', name: 'Betanzos', ineCode: '15009', provinceId: 'a_coruna', ccaaId: 'galicia', enabled: true, coverageStatus: 'active' as const },
  { id: 'lugo', name: 'Lugo', ineCode: '27028', provinceId: 'lugo', ccaaId: 'galicia', enabled: true, coverageStatus: 'active' as const },
]

describe('ExpedienteForm', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('uses a municipality selector filtered by province instead of a free-text field', () => {
    render(<ExpedienteForm provinces={provinces} municipalities={municipalities} />)

    const municipality = screen.getByLabelText(/^Municipio/) as HTMLSelectElement
    expect(municipality.tagName).toBe('SELECT')
    expect(screen.queryByRole('textbox', { name: /^Municipio$/i })).toBeNull()
    expect([...municipality.options].map((option) => option.value)).toContain('culleredo')
    expect([...municipality.options].map((option) => option.value)).not.toContain('lugo')

    fireEvent.change(screen.getByLabelText(/^Provincia/), { target: { value: 'lugo' } })
    expect([...municipality.options].map((option) => option.value)).toContain('lugo')
    expect([...municipality.options].map((option) => option.value)).not.toContain('culleredo')
  })

  it('does not present an IDEG timeout as the absence of affects', async () => {
    vi.mocked(detectContextAction).mockResolvedValue({
      detectionId: '00000000-0000-4000-8000-000000000001',
      detection: {
        detected: {},
        progress: [{ id: 'affects', label: 'Afecciones consultadas', status: 'incomplete', detail: 'Comprobación incompleta o con error' }],
        sourceChecks: [{ source: 'ideg', status: 'timeout', checkedAt: '2026-07-20T00:00:00.000Z', message: 'IDEG no responde' }],
        affects: [],
      },
    })
    render(<ExpedienteForm provinces={provinces} municipalities={municipalities} />)
    fireEvent.change(screen.getByLabelText(/Referencia catastral/i), { target: { value: '7709702NH4970N0001SZ' } })
    fireEvent.click(screen.getByRole('button', { name: /analizar parcela/i }))

    await waitFor(() => {
      expect(screen.getByText(/no equivale a ausencia de afecciones/i)).toBeTruthy()
    })
    expect(screen.getByText(/Cartografía oficial de Galicia/i)).toBeTruthy()
    expect(screen.queryByText('No se han detectado afecciones positivas.')).toBeNull()
  })

  it('shows the current parcel geometry and its resolved coordinates after detection', async () => {
    vi.mocked(detectContextAction).mockResolvedValue({
      detectionId: '00000000-0000-4000-8000-000000000020',
      detection: {
        detected: {
          cadastralReference: '3995302NH5939N0001HQ',
          lat: 43.331,
          lng: -8.354,
          parcelGeometry: {
            type: 'MultiPolygon',
            crs: 'EPSG:4326',
            coordinates: [[[[-8.355, 43.33], [-8.354, 43.33], [-8.354, 43.331], [-8.355, 43.33]]]],
          },
        },
        progress: [],
        sourceChecks: [],
        affects: [],
      },
    })
    render(<ExpedienteForm provinces={provinces} municipalities={municipalities} />)

    fireEvent.change(screen.getByLabelText(/Referencia catastral/i), {
      target: { value: '3995302NH5939N0001HQ' },
    })
    fireEvent.click(screen.getByRole('button', { name: /analizar parcela/i }))

    await waitFor(() => {
      expect(screen.getByTestId('parcel-map').getAttribute('data-has-geometry')).toBe('true')
    })
    expect(screen.getByTestId('parcel-map').getAttribute('data-coordinates')).toBe('43.331,-8.354')
  })

  it('uses resolved coordinates when the detection has no parcel geometry', async () => {
    vi.mocked(detectContextAction).mockResolvedValue({
      detectionId: '00000000-0000-4000-8000-000000000021',
      detection: {
        detected: { lat: 43.316, lng: -8.336 },
        progress: [],
        sourceChecks: [],
        affects: [],
      },
    })
    render(<ExpedienteForm provinces={provinces} municipalities={municipalities} />)

    fireEvent.change(screen.getByLabelText(/Referencia catastral/i), {
      target: { value: '7709702NH4970N0001SZ' },
    })
    fireEvent.click(screen.getByRole('button', { name: /analizar parcela/i }))

    await waitFor(() => {
      expect(screen.getByTestId('parcel-map').getAttribute('data-coordinates')).toBe('43.316,-8.336')
    })
    expect(screen.getByTestId('parcel-map').getAttribute('data-has-geometry')).toBe('false')
  })

  it('renders the map empty state inputs before a location is detected', () => {
    render(<ExpedienteForm provinces={provinces} municipalities={municipalities} />)

    expect(screen.getByTestId('parcel-map').getAttribute('data-has-geometry')).toBe('false')
    expect(screen.getByTestId('parcel-map').getAttribute('data-coordinates')).toBe('')
  })

  it('keeps entered values and shows a server error on its related field', async () => {
    vi.mocked(createExpediente).mockResolvedValue({
      status: 'error',
      message: 'La dirección no coincide con la detección territorial verificada.',
      field: 'address',
    })
    render(<ExpedienteForm provinces={provinces} municipalities={municipalities} />)
    fireEvent.change(screen.getByLabelText(/Nombre del proyecto/i), { target: { value: 'Expediente de prueba' } })
    fireEvent.change(screen.getByLabelText(/^Municipio/), { target: { value: 'culleredo' } })
    fireEvent.change(screen.getByLabelText(/Referencia catastral/i), { target: { value: '7709702NH4970N0001SZ' } })
    fireEvent.change(screen.getByLabelText(/Dirección aproximada/i), { target: { value: 'Dirección pendiente de revisar' } })
    fireEvent.click(screen.getByRole('checkbox'))

    fireEvent.click(screen.getByRole('button', { name: /Crear expediente/i }))

    await screen.findByRole('alert')
    expect((screen.getByLabelText(/Nombre del proyecto/i) as HTMLInputElement).value).toBe('Expediente de prueba')
    expect((screen.getByLabelText(/Dirección aproximada/i) as HTMLInputElement).value).toBe('Dirección pendiente de revisar')
    expect(screen.getByLabelText(/Dirección aproximada/i).getAttribute('aria-invalid')).toBe('true')
    expect(screen.getByLabelText(/Referencia catastral/i).getAttribute('aria-invalid')).not.toBe('true')
  })

  it.each([
    ['referencia catastral', /Referencia catastral/i, '7709702NH4970N0002SZ'],
    ['dirección', /Dirección aproximada/i, 'Nueva dirección'],
    ['latitud', /^Latitud$/i, '43.4'],
    ['municipio', /^Municipio/, 'betanzos'],
  ])('invalidates all operational territorial values when the %s changes', async (_label, field, value) => {
    vi.mocked(detectContextAction).mockResolvedValue({
      detectionId: '00000000-0000-4000-8000-000000000002',
      detection: {
        detected: {
          cadastralReference: '7709702NH4970N0001SZ',
          parcelReference: '7709702NH4970N',
          municipalityId: 'culleredo',
          planeamiento: 'Plan general trazable',
          landClass: 'urbano_consolidado',
          urbanPlanningZone: 'Zona A',
        },
        progress: [{ id: 'reference', label: 'Referencia catastral validada', status: 'success', detail: '7709702NH4970N0001SZ' }],
        sourceChecks: [],
        affects: [],
      },
    })
    render(<ExpedienteForm provinces={provinces} municipalities={municipalities} />)
    const cadastralReference = screen.getByLabelText(/Referencia catastral/i)
    fireEvent.change(cadastralReference, { target: { value: '7709702NH4970N0001SZ' } })
    fireEvent.click(screen.getByRole('button', { name: /analizar parcela/i }))
    await screen.findByText(/Referencia parcelaria/i)

    fireEvent.change(screen.getByLabelText(field), { target: { value } })

    expect((document.querySelector('input[name="preflightDetectionId"]') as HTMLInputElement).value).toBe('')
    expect((screen.getByLabelText(/Planeamiento general/i) as HTMLSelectElement).value).toBe('')
    expect((screen.getByLabelText(/Clasificación del suelo/i) as HTMLSelectElement).value).toBe('')
    expect((document.querySelector('input[name="urbanPlanningZone"]') as HTMLInputElement).value).toBe('')
    expect(screen.queryByText(/Ámbito detectado/i)).toBeNull()
    expect(screen.getByTestId('parcel-map').getAttribute('data-has-geometry')).toBe('false')
    expect(screen.getByTestId('parcel-map').getAttribute('data-coordinates')).toBe('')
    expect((screen.getByRole('button', { name: /Crear expediente/i }) as HTMLButtonElement).disabled).toBe(true)
    expect(screen.getByText(/El contexto territorial anterior ya no se utilizará/i)).toBeTruthy()
  })

  it('disables creation immediately so a second click cannot submit the form again', async () => {
    let finishCreation: ((state: { status: 'idle' }) => void) | undefined
    vi.mocked(createExpediente).mockImplementation(() => new Promise((resolve) => {
      finishCreation = resolve
    }))

    render(<ExpedienteForm provinces={provinces} municipalities={municipalities} />)
    fireEvent.change(screen.getByLabelText(/Nombre del proyecto/i), { target: { value: 'Expediente de prueba' } })
    fireEvent.change(screen.getByLabelText(/^Municipio/), { target: { value: 'culleredo' } })
    fireEvent.change(screen.getByLabelText(/Referencia catastral/i), { target: { value: '7709702NH4970N0001SZ' } })
    fireEvent.click(screen.getByRole('checkbox'))

    const createButton = screen.getByRole('button', { name: /Crear expediente/i })
    fireEvent.click(createButton)
    fireEvent.click(createButton)

    await waitFor(() => expect(createExpediente).toHaveBeenCalledTimes(1))
    expect((createButton as HTMLButtonElement).disabled).toBe(true)
    expect(screen.getByRole('button', { name: /Creando expediente/i })).toBeTruthy()

    finishCreation?.({ status: 'idle' })
  })

  it('clears Betanzos inputs before analysing a newly selected Culleredo parcel', async () => {
    vi.mocked(detectContextAction)
      .mockResolvedValueOnce({
        detectionId: '00000000-0000-4000-8000-000000000010',
        detection: {
          detected: {
            cadastralReference: '15009A01300255',
            parcelReference: '15009A01300255',
            provinceId: 'a_coruna',
            municipalityId: 'betanzos',
            address: 'Parcela de Betanzos',
            lat: 43.270567277279795,
            lng: -8.216584723963274,
            planeamiento: 'PXOM Betanzos',
            landClass: 'nucleo_rural',
            urbanPlanningZone: 'CASCAS',
            locationSource: 'cadastral_reference',
          },
          progress: [], sourceChecks: [], affects: [],
        },
      })
      .mockResolvedValueOnce({
        detectionId: '00000000-0000-4000-8000-000000000011',
        detection: {
          detected: {
            cadastralReference: '7709702NH4970N0001SZ',
            parcelReference: '7709702NH4970N',
            provinceId: 'a_coruna',
            municipalityId: 'culleredo',
            address: 'LG LEDOÑO CULLEREDO (A CORUÑA)',
            lat: 43.316,
            lng: -8.336,
            planeamiento: 'Plan general de ordenación urbana',
            locationSource: 'cadastral_reference',
          },
          progress: [], sourceChecks: [], affects: [],
        },
      })

    render(<ExpedienteForm provinces={provinces} municipalities={municipalities} />)
    const reference = screen.getByLabelText(/Referencia catastral/i) as HTMLInputElement
    fireEvent.change(reference, { target: { value: '15009A01300255' } })
    fireEvent.click(screen.getByRole('button', { name: /analizar parcela/i }))
    await screen.findByText(/Referencia parcelaria/i)

    fireEvent.change(reference, { target: { value: '7709702NH4970N0001SZ' } })
    expect((screen.getByLabelText(/^Latitud$/i) as HTMLInputElement).value).toBe('')
    expect((screen.getByLabelText(/^Longitud$/i) as HTMLInputElement).value).toBe('')
    expect((screen.getByLabelText(/Dirección aproximada/i) as HTMLInputElement).value).toBe('')
    expect((screen.getByLabelText(/^Municipio/) as HTMLSelectElement).value).toBe('')
    expect((screen.getByLabelText(/Planeamiento general/i) as HTMLSelectElement).value).toBe('')

    fireEvent.click(screen.getByRole('button', { name: /actualizar análisis/i }))
    await waitFor(() => expect(detectContextAction).toHaveBeenCalledTimes(2))
    const secondRequest = vi.mocked(detectContextAction).mock.calls[1][0]
    expect(secondRequest.get('refCatastral')).toBe('7709702NH4970N0001SZ')
    expect(secondRequest.get('lat')).toBeNull()
    expect(secondRequest.get('lng')).toBeNull()
    await waitFor(() => expect((screen.getByLabelText(/^Municipio/) as HTMLSelectElement).value).toBe('culleredo'))
  })

  it('replaces a derived province when the next official parcel belongs to another province', async () => {
    vi.mocked(detectContextAction)
      .mockResolvedValueOnce({
        detectionId: '00000000-0000-4000-8000-000000000012',
        detection: { detected: { cadastralReference: '15009A01300255', provinceId: 'a_coruna', municipalityId: 'betanzos' }, progress: [], sourceChecks: [], affects: [] },
      })
      .mockResolvedValueOnce({
        detectionId: '00000000-0000-4000-8000-000000000013',
        detection: { detected: { cadastralReference: '27028000000000', provinceId: 'lugo', municipalityId: 'lugo' }, progress: [], sourceChecks: [], affects: [] },
      })
    render(<ExpedienteForm provinces={provinces} municipalities={municipalities} />)
    const reference = screen.getByLabelText(/Referencia catastral/i)
    const province = screen.getByLabelText(/^Provincia/) as HTMLSelectElement

    fireEvent.change(reference, { target: { value: '15009A01300255' } })
    fireEvent.click(screen.getByRole('button', { name: /analizar parcela/i }))
    await waitFor(() => expect(province.value).toBe('a_coruna'))

    fireEvent.change(reference, { target: { value: '27028000000000' } })
    expect(province.value).toBe('')
    fireEvent.click(screen.getByRole('button', { name: /actualizar análisis/i }))
    await waitFor(() => expect(province.value).toBe('lugo'))
  })

  it('overrides a contradictory manual province with the official province derived from the INE', async () => {
    vi.mocked(detectContextAction).mockResolvedValue({
      detectionId: '00000000-0000-4000-8000-000000000014',
      detection: { detected: { cadastralReference: '7709702NH4970N0001SZ', provinceId: 'a_coruna', municipalityId: 'culleredo' }, progress: [], sourceChecks: [], affects: [] },
    })
    render(<ExpedienteForm provinces={provinces} municipalities={municipalities} />)
    const province = screen.getByLabelText(/^Provincia/) as HTMLSelectElement
    fireEvent.change(province, { target: { value: 'lugo' } })
    fireEvent.change(screen.getByLabelText(/Referencia catastral/i), { target: { value: '7709702NH4970N0001SZ' } })
    fireEvent.click(screen.getByRole('button', { name: /analizar parcela/i }))

    await waitFor(() => expect(province.value).toBe('a_coruna'))
  })

  it('discards a stale analysis response after the user changes the cadastral reference', async () => {
    let resolveDetection: ((value: Awaited<ReturnType<typeof detectContextAction>>) => void) | undefined
    vi.mocked(detectContextAction).mockImplementation(() => new Promise((resolve) => {
      resolveDetection = resolve
    }))

    render(<ExpedienteForm provinces={provinces} municipalities={municipalities} />)
    const reference = screen.getByLabelText(/Referencia catastral/i) as HTMLInputElement
    const province = screen.getByLabelText(/^Provincia/) as HTMLSelectElement
    fireEvent.change(province, { target: { value: 'lugo' } })
    fireEvent.change(reference, { target: { value: '7709702NH4970N0001SZ' } })
    fireEvent.click(screen.getByRole('button', { name: /analizar parcela/i }))
    fireEvent.change(reference, { target: { value: '7709702NH4970N0002SZ' } })

    resolveDetection?.({
      detectionId: '00000000-0000-4000-8000-000000000099',
      detection: {
        detected: {
          cadastralReference: '7709702NH4970N0001SZ',
          provinceId: 'a_coruna',
          municipalityId: 'culleredo',
          planeamiento: 'Plan antiguo',
        },
        progress: [],
        sourceChecks: [],
        affects: [],
      },
    })

    await waitFor(() => expect(reference.value).toBe('7709702NH4970N0002SZ'))
    expect((document.querySelector('input[name="preflightDetectionId"]') as HTMLInputElement).value).toBe('')
    expect((screen.getByLabelText(/Planeamiento general/i) as HTMLSelectElement).value).toBe('')
    expect(province.value).toBe('lugo')
  })

  it('preselects a review proposal without presenting it as confirmed and keeps manual controls', async () => {
    const candidate = {
      id: 'oleiros-layer:SU|SUC',
      classification: {
        code: 'SU',
        categoryCode: 'SUC',
        label: 'Suelo urbano',
        sourceFeatureIds: ['feature-1'],
      },
      areas: [{ type: 'zone' as const, name: 'Ámbito oficial', sourceFeatureIds: ['feature-1'] }],
      source: 'siotuga' as const,
      evidence: [],
      confidence: 'medium' as const,
      evidenceBasis: 'parcel_geometry' as const,
      instrumentTraceability: 'pending' as const,
      normalizationStatus: 'mapped' as const,
    }
    vi.mocked(detectContextAction).mockResolvedValue({
      detectionId: '00000000-0000-4000-8000-000000000100',
      detection: {
        detected: {
          cadastralReference: '3995302NH5939N0001HQ',
          provinceId: 'a_coruna',
          municipalityId: 'culleredo',
          planeamiento: 'Plan general trazable',
        },
        progress: [],
        sourceChecks: [],
        affects: [],
        classificationResolution: {
          status: 'review_required',
          nextAction: 'review_official_sources',
          candidates: [candidate],
          discrepancies: [
            {
              reason: 'instrument_traceability_pending',
              field: 'instrument',
              explanation: 'La capa y el instrumento requieren comprobación documental.',
              assertions: [],
            },
          ],
          reviewReasons: ['instrument_traceability_pending'],
          proposal: {
            candidateId: candidate.id,
            explanation: 'La geometría es la evidencia disponible más fiable.',
            confidence: 'medium',
            requiresProfessionalReview: true,
          },
          sourceChecks: [],
          officialLinks: [
            {
              kind: 'catastro_viewer',
              label: 'Ver en Catastro',
              url: 'https://www1.sedecatastro.gob.es/Cartografia/mapa.aspx?refcat=3995302NH5939N0001HQ',
              source: 'catastro',
              scope: 'parcel',
            },
          ],
          evidence: [],
        },
      },
    })
    render(<ExpedienteForm provinces={provinces} municipalities={municipalities} />)
    fireEvent.change(screen.getByLabelText(/Referencia catastral/i), {
      target: { value: '3995302NH5939N0001HQ' },
    })
    fireEvent.click(screen.getByRole('button', { name: /analizar parcela/i }))

    await screen.findByText(/requiere revisión profesional/i)
    expect((screen.getByLabelText(/Clasificación del suelo/i) as HTMLSelectElement).value).toBe(
      'urbano_consolidado'
    )
    expect((screen.getByLabelText(/Ámbito o zona/i) as HTMLInputElement).value).toBe(
      'Ámbito oficial'
    )
    expect(screen.getByLabelText(/Motivo de la selección manual/i)).toBeTruthy()
    expect(screen.getByRole('link', { name: /Ver en Catastro/i })).toBeTruthy()
    expect(screen.queryByText(/^Confirmado$/i)).toBeNull()
  })
})
