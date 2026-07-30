import type {
  ManualAffectDecision,
  ManualTerritorialContext,
  TerritorialAffect,
  UrbanisticRegimeFacts,
} from '@/domain/territorial-resolver/types'
import {
  applyManualAffectDecisions,
  applyManualFactDecisions,
  territorialAffectKey,
} from './manualTerritorialContext'

const automatic: TerritorialAffect = {
  category: 'aguas',
  name: 'Zona de policía',
  featureId: 'water-1',
  attributes: {},
  evidence: {
    source: 'ideg',
    sourceUrl: 'https://official.test/water',
    retrievedAt: '2026-07-29T10:00:00.000Z',
    method: 'ArcGIS REST',
    scope: 'affect',
  },
  confidence: 'high',
}

function decision(action: ManualAffectDecision['action']): ManualAffectDecision {
  return {
    id: 'manual-1',
    targetKey: territorialAffectKey(automatic),
    category: automatic.category,
    name: automatic.name,
    action,
    reason: 'Revisión técnica',
    provenance: 'manual',
    verification: 'technician_validated',
    recordedAt: '2026-07-29T11:00:00.000Z',
    recordedBy: 'user-a',
  }
}

describe('applyManualAffectDecisions', () => {
  it('excluye operativamente sin borrar la detección automática', () => {
    const result = applyManualAffectDecisions([automatic], [decision('exclude')])
    expect(result.automatic).toEqual([automatic])
    expect(result.effective).toEqual([])
    expect(result.decisions[0]).toMatchObject({ action: 'exclude', reason: 'Revisión técnica' })
  })

  it('confirma una detección sin duplicarla', () => {
    const result = applyManualAffectDecisions([automatic], [decision('confirm')])
    expect(result.automatic).toEqual([automatic])
    expect(result.effective).toEqual([automatic])
  })

  it('añade una afección manual diferenciada', () => {
    const addition = { ...decision('add'), targetKey: undefined, name: 'Servidumbre aeronáutica' }
    const result = applyManualAffectDecisions([automatic], [addition])
    expect(result.automatic).toEqual([automatic])
    expect(result.effective).toHaveLength(2)
    expect(result.effective[1].evidence.source).toBe('urbanbrain')
    expect(result.effective[1].attributes).toMatchObject({ verification: 'technician_validated' })
  })
})

describe('applyManualFactDecisions', () => {
  const automaticFacts: UrbanisticRegimeFacts = {
    classification: {
      value: { code: 'SU', label: 'Suelo Urbano' },
      label: 'Suelo Urbano',
      status: 'automatic_confirmed',
      confidence: 'high',
      evidence: [],
      warnings: [],
      discrepancies: [],
      nextAction: 'none',
    },
    category: {
      status: 'manual_review_required',
      confidence: 'unknown',
      evidence: [],
      warnings: ['No ha sido posible determinar la categoría'],
      discrepancies: [],
      nextAction: 'manual_selection',
    },
    consolidation: {
      status: 'manual_review_required',
      confidence: 'unknown',
      evidence: [],
      warnings: [],
      discrepancies: [],
      nextAction: 'manual_selection',
    },
  }

  it('modifica clasificación independientemente sin alterar categoría ni consolidación', () => {
    const manualContext: ManualTerritorialContext = {
      provenance: 'manual',
      verification: 'technician_validated',
      recordedAt: '2026-07-30T10:00:00Z',
      urbanisticFacts: {
        classification: {
          origin: 'technician_selection',
          value: { code: 'SR', label: 'Suelo Rústico' },
          reason: 'Verificado plano PGOM',
          recordedAt: '2026-07-30T10:00:00Z',
          recordedBy: 'user-1',
          verification: 'technician_validated',
        },
      },
    }

    const result = applyManualFactDecisions(automaticFacts, manualContext)

    expect(result.effective.classification.value).toEqual({ code: 'SR', label: 'Suelo Rústico' })
    expect(result.effective.classification.status).toBe('technician_validated')
    expect(result.effective.classification.origin).toBe('technician_selection')

    // Categoría y consolidación se mantienen en estado automático
    expect(result.effective.category.status).toBe('manual_review_required')
    expect(result.effective.category.value).toBeUndefined()
    expect(result.effective.consolidation.status).toBe('manual_review_required')
  })

  it('establece consolidación de forma independiente', () => {
    const manualContext: ManualTerritorialContext = {
      provenance: 'manual',
      verification: 'technician_validated',
      recordedAt: '2026-07-30T10:00:00Z',
      urbanisticFacts: {
        consolidation: {
          origin: 'technician_selection',
          value: { code: 'consolidated', label: 'Suelo Urbano Consolidado (SUC)' },
          reason: 'Cuenta con servicios urbanísticos completos',
          recordedAt: '2026-07-30T10:00:00Z',
          recordedBy: 'user-1',
          verification: 'technician_validated',
        },
      },
    }

    const result = applyManualFactDecisions(automaticFacts, manualContext)

    expect(result.effective.consolidation.value).toEqual({
      code: 'consolidated',
      label: 'Suelo Urbano Consolidado (SUC)',
    })
    expect(result.effective.consolidation.status).toBe('technician_validated')
    expect(result.effective.classification.value).toEqual({ code: 'SU', label: 'Suelo Urbano' })
  })

  it('soporta confirmación explícita (technician_confirmation)', () => {
    const manualContext: ManualTerritorialContext = {
      provenance: 'manual',
      verification: 'technician_validated',
      recordedAt: '2026-07-30T10:00:00Z',
      urbanisticFacts: {
        classification: {
          origin: 'technician_confirmation',
          value: { code: 'SU', label: 'Suelo Urbano' },
          reason: 'Coincide con Catastro y PGOM',
          recordedAt: '2026-07-30T10:00:00Z',
          recordedBy: 'user-1',
          verification: 'technician_validated',
        },
      },
    }

    const result = applyManualFactDecisions(automaticFacts, manualContext)

    expect(result.effective.classification.value).toEqual({ code: 'SU', label: 'Suelo Urbano' })
    expect(result.effective.classification.status).toBe('technician_validated')
    expect(result.effective.classification.origin).toBe('technician_confirmation')
  })

  it('vuelve al automático cuando se elimina la clave de decisión', () => {
    const result = applyManualFactDecisions(automaticFacts, {
      provenance: 'manual',
      verification: 'technician_validated',
      recordedAt: '2026-07-30T10:00:00Z',
      urbanisticFacts: {},
    })

    expect(result.effective.classification.value).toEqual({ code: 'SU', label: 'Suelo Urbano' })
    expect(result.effective.classification.status).toBe('automatic_confirmed')
  })

  it('mantiene hechos V2 automáticos intactos cuando solo existen campos legacy V1', () => {
    const legacyContext: ManualTerritorialContext = {
      provenance: 'manual',
      verification: 'unverified',
      recordedAt: '2026-07-30T10:00:00Z',
      classification: 'Suelo Rústico Protegido',
      category: 'SRP-AG',
    }

    const result = applyManualFactDecisions(automaticFacts, legacyContext)

    // Los hechos V2 no se alteran por strings legacy sin trazabilidad
    expect(result.effective).toBe(automaticFacts)
    expect(result.decisions).toEqual({})
  })
})
