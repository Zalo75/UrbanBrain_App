import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('./actions', () => ({
  createExpediente: vi.fn(),
  detectContextAction: vi.fn(),
  getPlanningOptionsAction: vi.fn(async () => []),
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
    expect(document.querySelector('input[name="urbanPlanningZone"]')).toBeNull()
    expect(screen.queryByText(/Ámbito detectado/i)).toBeNull()
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
})
