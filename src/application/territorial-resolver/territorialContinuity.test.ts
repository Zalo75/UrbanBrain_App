import { describe, expect, it } from 'vitest'

import type {
  ManualTerritorialContext,
  TerritorialResolution,
} from '@/domain/territorial-resolver/types'
import {
  attachContinuity,
  createManualAttempt,
} from './territorialContinuity'

function official(reference = '1234567NH4913S'): TerritorialResolution {
  return {
    status: 'confirmed',
    confidence: 'high',
    inputMethod: 'cadastral_reference',
    cadastralReference: reference,
    municipality: 'Betanzos',
    municipalityCode: '15009',
    coordinates: { lat: 43.28, lng: -8.26 },
    candidates: [],
    evidence: [
      {
        source: 'catastro',
        sourceUrl: 'https://official.test',
        retrievedAt: '2026-07-13T10:00:00.000Z',
        method: 'fixture',
      },
    ],
    warnings: [],
    conflicts: [],
    sourceChecks: [
      {
        source: 'catastro',
        status: 'available',
        checkedAt: '2026-07-13T10:00:00.000Z',
        message: 'Catastro respondio correctamente.',
      },
    ],
    planning: {
      status: 'partial',
      instrument: 'Normas Subsidiarias',
      canAnswerConcreteParameters: false,
      evidence: [],
      warnings: [],
    },
    affects: {
      analysisGeometry: 'parcel',
      detected: [],
      canRuleOutUndetectedAffects: false,
      warnings: [],
    },
    resolvedAt: '2026-07-13T10:00:00.000Z',
  }
}

function failed(status: 'timeout' | 'unavailable' | 'malformed'): TerritorialResolution {
  return {
    status: 'unresolved',
    confidence: 'low',
    inputMethod: 'cadastral_reference',
    candidates: [],
    evidence: [],
    warnings: [],
    conflicts: [],
    sourceChecks: [
      {
        source: 'catastro',
        status,
        checkedAt: '2026-07-14T10:00:00.000Z',
        message: 'Comprobacion pendiente.',
      },
    ],
    planning: { status: 'not_determined', evidence: [], warnings: [] },
    affects: {
      analysisGeometry: 'none',
      detected: [],
      canRuleOutUndetectedAffects: false,
      warnings: [],
    },
    resolvedAt: '2026-07-14T10:00:00.000Z',
  }
}

describe('territorial continuity', () => {
  it.each(['timeout', 'unavailable', 'malformed'] as const)(
    'preserva el ultimo contexto oficial para la misma parcela tras %s',
    (status) => {
      const result = attachContinuity(
        failed(status),
        { cadastralReference: '1234567NH4913S' },
        official()
      )

      expect(result.continuity).toMatchObject({
        usingPreviousOfficialContext: true,
        sameParcelAsPrevious: true,
      })
      expect(result.continuity?.effectiveOfficialContext?.resolvedAt).toBe(
        '2026-07-13T10:00:00.000Z'
      )
    }
  )

  it('no aplica el contexto anterior a una referencia distinta', () => {
    const result = attachContinuity(
      failed('timeout'),
      { cadastralReference: '9999999NH4999S' },
      official()
    )

    expect(result.continuity?.usingPreviousOfficialContext).toBe(false)
    expect(result.continuity?.effectiveOfficialContext).toBeUndefined()
    expect(result.continuity?.lastOfficialContext).toBeDefined()
  })

  it('un reintento exitoso vuelve a usar el contexto oficial actual', () => {
    const priorFailure = attachContinuity(
      failed('timeout'),
      { cadastralReference: '1234567NH4913S' },
      official()
    )
    const retried = attachContinuity(
      { ...official(), resolvedAt: '2026-07-14T11:00:00.000Z' },
      { cadastralReference: '1234567NH4913S' },
      priorFailure
    )

    expect(retried.continuity?.usingPreviousOfficialContext).toBe(false)
    expect(retried.continuity?.effectiveOfficialContext).toBeUndefined()
    expect(retried.resolvedAt).toBe('2026-07-14T11:00:00.000Z')
  })

  it('conserva afecciones positivas previas si IDEG falla pero Catastro funciona', () => {
    const previous = official()
    previous.affects.detected = [
      {
        category: 'patrimonio',
        name: 'Entorno protegido',
        attributes: {},
        confidence: 'high',
        evidence: {
          source: 'ideg',
          sourceUrl: 'https://official.test/ideg',
          retrievedAt: previous.resolvedAt,
          method: 'fixture',
        },
      },
    ]
    const current = {
      ...official(),
      resolvedAt: '2026-07-14T10:00:00.000Z',
      affects: {
        analysisGeometry: 'parcel' as const,
        detected: [],
        canRuleOutUndetectedAffects: false as const,
        warnings: [],
        sourceChecks: [
          {
            source: 'ideg' as const,
            status: 'unavailable' as const,
            checkedAt: '2026-07-14T10:00:00.000Z',
            message: 'IDEG no responde.',
          },
        ],
      },
    }

    const result = attachContinuity(
      current,
      { cadastralReference: '1234567NH4913S' },
      previous
    )

    expect(result.continuity?.usingPreviousOfficialContext).toBe(true)
    expect(result.continuity?.effectiveOfficialContext?.affects.detected[0].name).toBe(
      'Entorno protegido'
    )
    expect(result.continuity?.effectiveOfficialContext?.resolvedAt).toBe(previous.resolvedAt)
  })

  it.each(['unverified', 'technician_validated'] as const)(
    'conserva procedencia y estado manual %s',
    (verification) => {
      const manual: ManualTerritorialContext = {
        municipality: 'Betanzos',
        classification: 'Suelo urbano',
        provenance: 'manual',
        verification,
        recordedAt: '2026-07-14T12:00:00.000Z',
      }
      const result = createManualAttempt(
        { cadastralReference: '1234567NH4913S' },
        manual,
        official()
      )

      expect(result.continuity?.manualContext).toEqual(manual)
      expect(result.continuity?.usingPreviousOfficialContext).toBe(true)
      expect(result.planning.canAnswerConcreteParameters).toBe(false)
    }
  )
})
