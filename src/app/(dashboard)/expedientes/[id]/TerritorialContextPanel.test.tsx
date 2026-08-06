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
  automaticClassification: {
    code: 'SU',
    categoryCode: 'SUSC',
    label: 'Suelo urbano',
    sourceFeatureIds: ['feature-a'],
  },
  classificationOrigin: 'automatic',
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
  it('muestra abierto el diagnóstico y expone los controles manuales previstos', () => {
    const { container } = render(
      <TerritorialContextPanel
        expedienteId="exp-a"
        initialInput={{}}
        context={{
          ...contextWithPlanning,
          automaticAffects: [
            {
              key: 'ideg:water-1',
              category: 'aguas',
              name: 'Zona de policía',
              confidence: 'high',
              source: 'ideg',
            },
          ],
          affects: [
            {
              key: 'ideg:water-1',
              category: 'aguas',
              name: 'Zona de policía',
              confidence: 'high',
              origin: 'automatic',
            },
          ],
        }}
      />
    )

    expect(container.querySelector('details')?.hasAttribute('open')).toBe(true)
    expect(screen.getByText('Diagnóstico territorial')).toBeTruthy()
    expect(screen.getByText('Clasificación detectada')).toBeTruthy()
    expect(screen.getByText('Origen: Detección automática')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Editar clasificación' }))
    expect(screen.getByLabelText('Clasificación')).toBeTruthy()
    expect(screen.getByLabelText('Confirmar')).toBeTruthy()
    expect(screen.getByLabelText('Excluir')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Añadir afección' })).toBeTruthy()
  })

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
    expect(screen.queryByText(/se abst.* de dar par.*metros/i)).toBeNull()
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

  it('no duplica dentro del panel el aviso persistente de contexto incompleto', () => {
    render(
      <TerritorialContextPanel
        expedienteId="exp-a"
        initialInput={{}}
        context={contextWithPlanning}
      />
    )

    expect(screen.queryByText('Zona urbanística pendiente')).toBeNull()
    expect(screen.queryByText('Contexto urbanístico incompleto')).toBeNull()
    expect(screen.getByText('Parcial')).toBeTruthy()
  })

  it('abre el control manual existente y enfoca la ordenanza', () => {
    render(
      <TerritorialContextPanel
        expedienteId="exp-a"
        initialInput={{}}
        context={contextWithPlanning}
      />
    )

    fireEvent.click(screen.getByRole('button', { name: 'Introducir datos manualmente' }))

    const ordinance = screen.getByLabelText('Ordenanza conocida')
    expect(ordinance.closest('fieldset')).toBeTruthy()
  })

  it('no muestra la alerta cuando la zona urbanística está determinada', () => {
    render(
      <TerritorialContextPanel
        expedienteId="exp-a"
        initialInput={{}}
        context={{ ...contextWithPlanning, status: 'confirmed', areas: ['Zona 3'] }}
      />
    )

    expect(screen.queryByText('Zona urbanística pendiente')).toBeNull()
    expect(screen.queryByRole('button', { name: 'Seleccionar zona urbanística' })).toBeNull()
  })

  it('mantiene el estado parcial sin repetir el aviso incompleto', () => {
    render(
      <TerritorialContextPanel
        expedienteId="exp-a"
        initialInput={{}}
        context={{ ...contextWithPlanning, instrument: undefined, classification: undefined }}
      />
    )

    expect(screen.queryByText('Contexto urbanístico incompleto')).toBeNull()
    expect(screen.getByText('Parcial')).toBeTruthy()
  })

  it('does not present an unverified work area as an effective technician decision', () => {
    render(
      <TerritorialContextPanel
        expedienteId="exp-a"
        initialInput={{}}
        context={{
          ...contextWithPlanning,
          classificationOrigin: 'manual',
          manualContext: {
            provenance: 'manual',
            verification: 'unverified',
            recordedAt: '2026-08-06T10:00:00.000Z',
          },
          actionArea: {
            id: 'zone-a',
            selectionType: 'detected_zone',
            selectedCandidateId: 'candidate-a',
            geometry: {
              type: 'MultiPolygon',
              crs: 'EPSG:4326',
              coordinates: [[[[-8.2, 43.2], [-8.19, 43.2], [-8.2, 43.21], [-8.2, 43.2]]]],
            },
            surfaceSquareMetres: 600,
            parcelSurfaceSquareMetres: 1000,
            classification: 'SU',
            category: 'SUSC',
            planningZone: 'LEDONO',
            planningZones: ['LEDONO'],
            source: 'siotuga',
            confidence: 'high',
            selectedBy: 'architect-a',
            selectedAt: '2026-08-06T10:00:00.000Z',
            verification: 'unverified',
          },
        }}
      />
    )

    expect(screen.getByText('Contexto provisional')).toBeTruthy()
    expect(screen.getByText('Clasificación detectada')).toBeTruthy()
    expect(screen.queryByText('Clasificación efectiva')).toBeNull()
    expect(screen.getByText('Origen: Zona de trabajo seleccionada; pendiente de validación técnica')).toBeTruthy()
    expect(screen.queryByText('Origen: Decisión del técnico')).toBeNull()
  })

  it('diferencia valores automáticos y manuales y permite editar clasificación y afecciones', () => {
    render(
      <TerritorialContextPanel
        expedienteId="exp-a"
        initialInput={{}}
        context={{
          ...contextWithPlanning,
          automaticClassification: contextWithPlanning.classification,
          classificationOrigin: 'manual',
          automaticAffects: [
            {
              key: 'ideg:water-1',
              category: 'aguas',
              name: 'Zona de policía',
              confidence: 'high',
              source: 'ideg',
            },
          ],
          manualContext: {
            classification: 'Suelo rústico',
            category: 'SRP',
            provenance: 'manual',
            verification: 'technician_validated',
            recordedAt: '2026-07-29T10:00:00.000Z',
            affectDecisions: [
              {
                id: 'decision-1',
                targetKey: 'ideg:water-1',
                category: 'aguas',
                name: 'Zona de policía',
                action: 'exclude',
                reason: 'Revisión técnica',
                provenance: 'manual',
                verification: 'technician_validated',
                recordedAt: '2026-07-29T10:00:00.000Z',
                recordedBy: 'user-a',
              },
            ],
          },
        }}
      />
    )

    expect(screen.getByText('Clasificación efectiva')).toBeTruthy()
    expect(screen.getByText(/Clasificación automática original/i)).toBeTruthy()
    expect(screen.getByText(/Auditoría manual legacy/i)).toBeTruthy()
    expect(screen.getByText(/excluida operativamente/i)).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Editar afecciones' }))
    expect(screen.getByText('Revisión manual de afecciones')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Añadir afección' }))
    expect(screen.getByLabelText('Afección nueva')).toBeTruthy()
  })
})
