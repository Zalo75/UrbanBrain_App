import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

vi.mock('./actions', () => ({
  createExpediente: vi.fn(),
  detectContextAction: vi.fn(),
  getPlanningOptionsAction: vi.fn(async () => []),
}))

import { ExpedienteForm } from './ExpedienteForm'
import { detectContextAction } from './actions'

const provinces = [
  { id: 'a_coruna', name: 'A Coruña', ccaaId: 'galicia', enabled: true },
  { id: 'lugo', name: 'Lugo', ccaaId: 'galicia', enabled: true },
]
const municipalities = [
  { id: 'culleredo', name: 'Culleredo', ineCode: '15031', provinceId: 'a_coruna', ccaaId: 'galicia', enabled: true, coverageStatus: 'active' as const },
  { id: 'lugo', name: 'Lugo', ineCode: '27028', provinceId: 'lugo', ccaaId: 'galicia', enabled: true, coverageStatus: 'active' as const },
]

describe('ExpedienteForm', () => {
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
    fireEvent.click(screen.getByRole('button', { name: /detectar/i }))

    await waitFor(() => {
      expect(screen.getByText(/no equivale a ausencia de afecciones/i)).toBeTruthy()
    })
    expect(screen.queryByText('No se han detectado afecciones positivas.')).toBeNull()
  })
})
