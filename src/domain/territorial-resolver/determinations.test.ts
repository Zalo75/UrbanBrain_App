import { describe, expect, it } from 'vitest'
import {
  createAutomaticDetermination,
  createTechnicianDetermination,
  getEffectiveValue,
  mergeAutomaticDetermination,
} from './determinations'

describe('Territorial Determinations (ContextDeterminationState)', () => {
  const mockNow = new Date('2026-07-31T12:00:00Z')
  const nowFn = () => mockNow

  it('Caso 1 — Valor legado: Sin estado nuevo, devuelve el primitivo legado', () => {
    expect(getEffectiveValue(undefined, '3A')).toBe('3A')
  })

  it('Caso 2 — Solo automático: Devuelve la última determinación automática', () => {
    const auto = createAutomaticDetermination('3A', 'urbanbrain', nowFn)
    const state = { automatic: auto }
    expect(getEffectiveValue(state, undefined)).toBe('3A')
  })

  it('Caso 3 — Selección técnica validada: prevalece sobre legado y automático', () => {
    const auto = createAutomaticDetermination('3A', 'urbanbrain', nowFn)
    const tech = createTechnicianDetermination('3B', 'user_123', auto.value, { now: nowFn })
    const state = { automatic: auto, technician: tech }
    expect(getEffectiveValue(state, '1C')).toBe('3B')
    
    expect(tech.recordedBy).toBe('user_123')
    expect(tech.recordedAt).toBe('2026-07-31T12:00:00.000Z')
    expect(tech.validatedBy).toBe('user_123')
    expect(tech.validatedAt).toBe('2026-07-31T12:00:00.000Z')
  })

  it('Caso 4 — Técnico no validado y automático simultáneos: Devuelve el valor técnico provisional', () => {
    const auto = createAutomaticDetermination('3A', 'urbanbrain', nowFn)
    const tech = createTechnicianDetermination('3B', 'user_123', auto.value, {
      verification: 'unverified',
      now: nowFn,
    })
    
    expect(tech.verification).toBe('unverified')
    expect(tech.recordedBy).toBe('user_123')
    expect(tech.recordedAt).toBe('2026-07-31T12:00:00.000Z')
    expect(tech.validatedAt).toBeUndefined()
    expect(tech.validatedBy).toBeUndefined()

    const state = { automatic: auto, technician: tech }
    expect(getEffectiveValue(state, '1C')).toBe('3B')
  })

  it('Caso 5 — Conservación del automático anterior: Al crear la selección técnica, guarda previousAutomaticValue', () => {
    const auto = createAutomaticDetermination('3A', 'urbanbrain', nowFn)
    const tech = createTechnicianDetermination('3B', 'user_123', auto.value, { now: nowFn })
    expect(tech.previousAutomaticValue).toBe('3A')
  })

  it('Caso 6 — Nueva reevaluación automática: actualiza el automático a R1 sin alterar el técnico', () => {
    const auto = createAutomaticDetermination('3A', 'urbanbrain', nowFn)
    const tech = createTechnicianDetermination('3B', 'user_123', auto.value, { now: nowFn })
    const initialState = { automatic: auto, technician: tech }
    
    const mergedState = mergeAutomaticDetermination(initialState, 'R1', 'urbanbrain', nowFn)
    
    expect(mergedState.automatic?.value).toBe('R1')
    expect(mergedState.technician?.value).toBe('3B')
    expect(mergedState.technician?.previousAutomaticValue).toBe('3A')
    
    // Verifying it doesn't modify traceability
    expect(mergedState.technician?.recordedAt).toBe('2026-07-31T12:00:00.000Z')
    expect(mergedState.technician?.recordedBy).toBe('user_123')
    expect(mergedState.technician?.validatedAt).toBe('2026-07-31T12:00:00.000Z')
    expect(mergedState.technician?.validatedBy).toBe('user_123')
  })

  it('Caso 7 — Valor efectivo tras reevaluación: El valor efectivo sigue siendo 3B', () => {
    const auto = createAutomaticDetermination('3A', 'urbanbrain', nowFn)
    const tech = createTechnicianDetermination('3B', 'user_123', auto.value, { now: nowFn })
    const initialState = { automatic: auto, technician: tech }
    
    const mergedState = mergeAutomaticDetermination(initialState, 'R1', 'urbanbrain', nowFn)
    
    expect(getEffectiveValue(mergedState, undefined)).toBe('3B')
  })

  it('Caso 8 — Inmutabilidad: comprobaciones exhaustivas', () => {
    const auto = createAutomaticDetermination('3A', 'urbanbrain', nowFn)
    const tech = createTechnicianDetermination('3B', 'user_123', auto.value, { now: nowFn })
    const initialState = { automatic: auto, technician: tech }
    
    const mergedState = mergeAutomaticDetermination(initialState, 'R1', 'urbanbrain', nowFn)
    
    expect(mergedState).not.toBe(initialState)
    expect(mergedState.technician).toBe(initialState.technician)
    expect(mergedState.automatic).not.toBe(initialState.automatic)
  })

  it('Caso 9 — Serialización: JSON.stringify y JSON.parse conservan ambas ramas', () => {
    const auto = createAutomaticDetermination('3A', 'urbanbrain', nowFn)
    const tech = createTechnicianDetermination('3B', 'user_123', auto.value, { now: nowFn })
    const initialState = { automatic: auto, technician: tech }
    
    const mergedState = mergeAutomaticDetermination(initialState, 'R1', 'urbanbrain', nowFn)
    const serialized = JSON.stringify(mergedState)
    const parsed = JSON.parse(serialized)
    
    expect(parsed).toEqual({
      automatic: {
        value: 'R1',
        origin: 'automatic',
        verification: 'unverified',
        determinedAt: '2026-07-31T12:00:00.000Z',
        source: 'urbanbrain'
      },
      technician: {
        value: '3B',
        origin: 'technician_selection',
        verification: 'technician_validated',
        recordedAt: '2026-07-31T12:00:00.000Z',
        recordedBy: 'user_123',
        validatedAt: '2026-07-31T12:00:00.000Z',
        validatedBy: 'user_123',
        previousAutomaticValue: '3A'
      }
    })
  })

  it('Caso 10 — Ausencia total: Devuelve undefined', () => {
    expect(getEffectiveValue(undefined, undefined)).toBeUndefined()
  })
})
