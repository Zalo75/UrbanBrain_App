import { fireEvent, render, screen } from '@testing-library/react'
import { beforeAll, describe, expect, it, vi } from 'vitest'

import type { TerritorialContextView } from '@/application/territorial-resolver/territorialContextView'

vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn() }) }))
vi.mock('./territorialActions', () => ({
  resolveTerritorialContextAction: vi.fn(async () => ({ status: 'success', message: 'ok' })),
}))
vi.mock('@/components/maps/ParcelMap', () => ({
  ParcelMap: () => <div data-testid="parcel-map">Visor cartográfico</div>,
}))

import { TerritorialContextPanel } from './TerritorialContextPanel'

const contextWithPlanning: TerritorialContextView = {
  status: 'provisional',
  confidence: 'high',
  resolvedAt: '2026-07-14T10:00:00.000Z',
  latestAttemptAt: '2026-07-14T10:00:00.000Z',
  inputMethod: 'cadastral_reference',
  cadastralReference: '7709702NH4970N0001SZ',
  municipality: 'Culleredo',
  municipalityCode: '15031',
  classification: {
    code: 'SU',
    categoryCode: 'SUSC',
    label: 'Suelo urbano',
    sourceFeatureIds: ['feature-a'],
  },
  instrument: 'Plan general de ordenación urbana',
  areas: [],
  affects: [],
  conflicts: [],
  warnings: [],
  sources: [],
  canAnswerConcreteParameters: false,
  canRuleOutUndetectedAffects: false,
  candidateCount: 0,
  usingPreviousOfficialContext: false,
  technicallyReviewed: false,
  sourceChecks: [],
}

beforeAll(() => {
  Object.defineProperty(Element.prototype, 'scrollIntoView', {
    configurable: true,
    value: vi.fn(),
  })
})

describe('TerritorialContextPanel', () => {
  it('ofrece resolucion oficial, reintento y continuacion manual diferenciada', () => {
    render(<TerritorialContextPanel expedienteId="exp-a" initialInput={{}} context={null} />)

    expect(screen.getByRole('form', { name: /resolver localizaci.n/i })).toBeTruthy()
    expect(screen.getByLabelText('Referencia catastral')).toBeTruthy()
    expect(screen.getByLabelText('Latitud')).toBeTruthy()
    expect(screen.getByLabelText('Longitud')).toBeTruthy()
    expect(screen.getByLabelText(/Direcci.n/)).toBeTruthy()
    expect(screen.queryByLabelText('Municipio')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: /introducir datos manualmente/i }))
    expect(screen.getByLabelText('Municipio conocido')).toBeTruthy()
    expect(screen.getByLabelText(/Observaciones del t.cnico/i)).toBeTruthy()
    expect(screen.getByRole('button', { name: /guardar manual y continuar/i })).toBeTruthy()
  })

  it('permite cancelar la edicion manual sin enviar el formulario', () => {
    render(<TerritorialContextPanel expedienteId="exp-a" initialInput={{}} context={null} />)

    fireEvent.click(screen.getByRole('button', { name: /introducir datos manualmente/i }))
    expect(screen.getByLabelText('Municipio conocido')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: /cancelar edici.n manual/i }))

    expect(screen.queryByLabelText('Municipio conocido')).toBeNull()
  })

  it('mantiene controles utilizables en anchos moviles y una rejilla ampliada en escritorio', () => {
    render(<TerritorialContextPanel expedienteId="exp-a" initialInput={{}} context={null} />)

    const form = screen.getByRole('form', { name: /resolver localizaci.n/i })
    const resolveButton = screen.getByRole('button', { name: /resolver contexto/i })
    expect(resolveButton.className).toContain('w-full')
    expect(resolveButton.className).toContain('sm:w-auto')
    expect(form.parentElement?.className).toContain('xl:grid-cols-')
  })

  it('distingue un contexto conflictivo y muestra la cobertura parcial', () => {
    render(
      <TerritorialContextPanel
        expedienteId="exp-a"
        initialInput={{}}
        context={{
          status: 'conflict',
          confidence: 'high',
          resolvedAt: '2026-07-14T00:00:00.000Z',
          inputMethod: 'coordinates',
          municipality: 'Betanzos',
          municipalityCode: '15009',
          areas: ['Nucleo'],
          affects: [],
          conflicts: ['El punto y la parcela no coinciden.'],
          warnings: [],
          sources: [],
          canAnswerConcreteParameters: false,
          canRuleOutUndetectedAffects: false,
          candidateCount: 0,
          latestAttemptAt: '2026-07-14T00:00:00.000Z',
          usingPreviousOfficialContext: false,
          technicallyReviewed: false,
          sourceChecks: [],
        }}
      />
    )

    expect(screen.getByText('Conflictivo')).toBeTruthy()
    expect(screen.getByTestId('parcel-map')).toBeTruthy()
    expect(screen.getByText(/no demuestra ausencia de otras afecciones/i)).toBeTruthy()
    expect(screen.getByText(/se abst.* de dar par.*metros/i)).toBeTruthy()
  })

  it('muestra el ultimo contexto oficial como provisional y fecha ambos estados', () => {
    render(
      <TerritorialContextPanel
        expedienteId="exp-a"
        initialInput={{}}
        context={{
          status: 'provisional',
          confidence: 'high',
          resolvedAt: '2026-07-14T10:00:00.000Z',
          latestAttemptAt: '2026-07-14T10:00:00.000Z',
          officialContextResolvedAt: '2026-07-13T10:00:00.000Z',
          inputMethod: 'cadastral_reference',
          municipality: 'Betanzos',
          areas: [],
          affects: [],
          conflicts: [],
          warnings: [],
          sources: [],
          canAnswerConcreteParameters: false,
          canRuleOutUndetectedAffects: false,
          candidateCount: 0,
          usingPreviousOfficialContext: true,
          technicallyReviewed: false,
          sourceChecks: [
            {
              source: 'catastro',
              status: 'timeout',
              checkedAt: '2026-07-14T10:00:00.000Z',
              message: 'Catastro esta tardando mas de lo esperado.',
            },
          ],
        }}
      />
    )

    expect(screen.getByText('Parcial')).toBeTruthy()
    expect(screen.getByText(/se mantiene el .*ltimo contexto oficial v.*lido/i)).toBeTruthy()
    expect(screen.getByText(/Catastro esta tardando mas de lo esperado/i)).toBeTruthy()
    expect(screen.getAllByRole('status').length).toBeGreaterThan(0)
    expect(screen.getByText(/Contexto oficial utilizado/i)).toBeTruthy()
  })

  it('mantiene las afecciones positivas separadas aunque el contexto esté parcial', () => {
    render(
      <TerritorialContextPanel
        expedienteId="exp-a"
        initialInput={{}}
        context={{
          status: 'provisional',
          confidence: 'high',
          resolvedAt: '2026-07-14T10:00:00.000Z',
          latestAttemptAt: '2026-07-14T10:00:00.000Z',
          inputMethod: 'cadastral_reference',
          municipality: 'Culleredo',
          municipalityCode: '15031',
          areas: [],
          affects: [
            { category: 'patrimonio_cultural', name: 'BIC: contorno de protección', confidence: 'high' },
          ],
          conflicts: [],
          warnings: [],
          sources: [],
          canAnswerConcreteParameters: false,
          canRuleOutUndetectedAffects: false,
          candidateCount: 0,
          usingPreviousOfficialContext: false,
          technicallyReviewed: false,
          sourceChecks: [
            {
              source: 'ideg',
              status: 'partial',
              checkedAt: '2026-07-14T10:00:00.000Z',
              message: 'IDEG solo pudo comprobar parte de las capas oficiales.',
            },
          ],
        }}
      />
    )

    expect(screen.getByText('Parcial')).toBeTruthy()
    expect(screen.getByText('BIC: contorno de protección')).toBeTruthy()
    expect(screen.getByText(/no demuestra ausencia de otras afecciones/i)).toBeTruthy()
  })

  it('explica que una consulta de afecciones fallida no equivale a ausencia', () => {
    render(
      <TerritorialContextPanel
        expedienteId="exp-a"
        initialInput={{}}
        context={{
          status: 'provisional',
          confidence: 'low',
          resolvedAt: '2026-07-14T10:00:00.000Z',
          latestAttemptAt: '2026-07-14T10:00:00.000Z',
          inputMethod: 'coordinates',
          areas: [],
          affects: [],
          conflicts: [],
          warnings: [],
          sources: [],
          canAnswerConcreteParameters: false,
          canRuleOutUndetectedAffects: false,
          candidateCount: 0,
          usingPreviousOfficialContext: false,
          technicallyReviewed: false,
          sourceChecks: [
            {
              source: 'ideg',
              status: 'timeout',
              checkedAt: '2026-07-14T10:00:00.000Z',
              message: 'IDEG esta tardando mas de lo esperado.',
            },
          ],
        }}
      />
    )

    expect(screen.getByText(/no equivale a ausencia de afecciones/i)).toBeTruthy()
  })

  it('destaca la zona pendiente con explicación profesional y estado accesible', () => {
    render(
      <TerritorialContextPanel
        expedienteId="exp-a"
        initialInput={{}}
        context={contextWithPlanning}
        urbanContextAttention={{
          kind: 'zone_pending',
          label: 'Zona urbanística pendiente',
          missing: ['zona urbanística u ordenanza aplicable'],
        }}
      />
    )

    const alert = screen.getByRole('alert', { name: /zona urbanística no determinada/i })
    expect(alert.className).toContain('border-red-300')
    expect(screen.getAllByText('Zona urbanística pendiente')).toHaveLength(1)
    expect(screen.getByText(/fuentes oficiales disponibles/i)).toBeTruthy()
    expect(screen.getByText(/retranqueos, ocupación, edificabilidad/i)).toBeTruthy()
    expect(screen.getByText('Parcial')).toBeTruthy()
  })

  it('abre el control manual existente y enfoca la ordenanza', () => {
    render(
      <TerritorialContextPanel
        expedienteId="exp-a"
        initialInput={{}}
        context={contextWithPlanning}
        urbanContextAttention={{
          kind: 'zone_pending',
          label: 'Zona urbanística pendiente',
          missing: ['zona urbanística u ordenanza aplicable'],
        }}
      />
    )

    fireEvent.click(screen.getByRole('button', { name: 'Seleccionar zona urbanística' }))

    const ordinance = screen.getByLabelText('Ordenanza conocida')
    expect(document.activeElement).toBe(ordinance)
    expect(ordinance.closest('fieldset')).toBeTruthy()
  })

  it('no muestra la alerta cuando la zona urbanística está determinada', () => {
    render(
      <TerritorialContextPanel
        expedienteId="exp-a"
        initialInput={{}}
        context={{ ...contextWithPlanning, status: 'confirmed', areas: ['Zona 3'] }}
        urbanContextAttention={null}
      />
    )

    expect(screen.queryByText('Zona urbanística pendiente')).toBeNull()
    expect(screen.queryByRole('button', { name: 'Seleccionar zona urbanística' })).toBeNull()
  })

  it('prioriza el estado incompleto cuando faltan varios datos urbanísticos', () => {
    render(
      <TerritorialContextPanel
        expedienteId="exp-a"
        initialInput={{}}
        context={{ ...contextWithPlanning, instrument: undefined, classification: undefined }}
        urbanContextAttention={{
          kind: 'incomplete',
          label: 'Contexto urbanístico incompleto',
          missing: ['planeamiento', 'clasificación del suelo', 'zona urbanística u ordenanza aplicable'],
        }}
      />
    )

    expect(screen.getAllByText('Contexto urbanístico incompleto')).toHaveLength(1)
    expect(screen.getByText(/planeamiento, clasificación del suelo/i)).toBeTruthy()
    expect(screen.getByText('Parcial')).toBeTruthy()
  })
})
