import { describe, expect, it } from 'vitest'

import type { NormalizedParcelContext } from '@/domain/parcel-context/types'
import {
  buildNormativeSearchScope,
  canSearchConcreteParameters,
} from './normativeSearchScope'

function context(
  municipality: string,
  ineCode: string,
  options: { area?: string; ordinance?: string; source?: 'manual' | 'siotuga' } = {}
): NormalizedParcelContext {
  return {
    municipality: {
      value: { name: municipality, ineCode },
      source: 'catastro',
      confidence: 1,
      verification: 'confirmed',
    },
    planningArea: options.area
      ? {
          value: options.area,
          source: options.source ?? 'siotuga',
          confidence: 0.9,
          verification: 'confirmed',
        }
      : undefined,
    qualification: options.ordinance
      ? {
          value: options.ordinance,
          source: options.source ?? 'siotuga',
          confidence: 0.95,
          verification: 'confirmed',
        }
      : undefined,
    knownConstraints: [],
    conflicts: [],
    pendingValidation: [],
  }
}

function rawPlanning(
  municipality: string,
  municipalityCode: string,
  documents: Array<{
    id: string
    instrumentId: string
    title: string
    sourceUrl: string
    binding: 'general' | 'area_specific' | 'unverified_for_detected_area'
  }>
) {
  return {
    status: 'confirmed',
    municipality,
    municipalityCode,
    planning: {
      status: 'determined',
      applicableInstruments: [
        {
          id: 'instrument-current',
          name: 'Instrumento vigente',
          kind: 'PXOM',
          status: 'current',
          sourceUrl: 'https://example.invalid/instrument',
        },
      ],
      documents,
      evidence: [],
      warnings: [],
    },
    affects: {
      analysisGeometry: 'parcel',
      detected: [],
      canRuleOutUndetectedAffects: false,
      warnings: [],
    },
    candidates: [],
    evidence: [],
    warnings: [],
    conflicts: [],
    confidence: 'high',
    inputMethod: 'cadastral_reference',
    resolvedAt: '2026-07-29T10:00:00.000Z',
  }
}

describe('buildNormativeSearchScope', () => {
  it('no convierte el ámbito LEDOÑO de Culleredo en una relación documental inventada', () => {
    const scope = buildNormativeSearchScope({
      context: context('Culleredo', '15031', { area: 'LEDOÑO' }),
      municipioCodigo: '15031',
      rawDetection: rawPlanning('Culleredo', '15031', []),
    })

    expect(scope).toMatchObject({
      municipioCodigo: '15031',
      planningZone: 'LEDOÑO',
      confidence: 'unknown',
    })
    expect(canSearchConcreteParameters(scope)).toBe(false)
  })

  it('limita por ordenanza y documentos generales cuando la selección está validada por técnico', () => {
    const scope = buildNormativeSearchScope({
      context: context('Betanzos', '15009', {
        area: 'CASCAS',
        ordinance: 'Ordenanza R4',
        source: 'manual',
      }),
      municipioCodigo: '15009',
      detected: {
        manualContext: {
          ordinance: 'Ordenanza R4',
          verification: 'technician_validated',
        },
      },
      rawDetection: rawPlanning('Betanzos', '15009', [
        {
          id: '0060no011.pdf',
          instrumentId: 'instrument-current',
          title: 'Normas urbanísticas',
          sourceUrl: 'https://example.invalid/0060no011.pdf',
          binding: 'general',
        },
      ]),
    })

    expect(scope).toMatchObject({
      source: 'technician_validated',
      confidence: 'confirmed',
      ordinance: 'Ordenanza R4',
      documentNames: ['0060no011.pdf'],
    })
    expect(canSearchConcreteParameters(scope)).toBe(true)
  })

  it('acepta un documento vinculado específicamente al ámbito sin exigir que el ámbito aparezca en cada chunk', () => {
    const scope = buildNormativeSearchScope({
      context: context('Sada', '15075', { area: 'APT-1' }),
      municipioCodigo: '15075',
      rawDetection: rawPlanning('Sada', '15075', [
        {
          id: 'apt-1.pdf',
          instrumentId: 'instrument-current',
          title: 'Ficha APT-1',
          sourceUrl: 'https://example.invalid/apt-1.pdf',
          binding: 'area_specific',
        },
      ]),
    })

    expect(scope.documentNames).toEqual(['apt-1.pdf'])
    expect(canSearchConcreteParameters(scope)).toBe(false)
  })

  it.each([
    ['Cerceda', '15024'],
    ['Oza-Cesuras', '15902'],
  ])('mantiene %s sin alcance paramétrico cuando sólo se conoce el municipio', (name, code) => {
    const scope = buildNormativeSearchScope({
      context: context(name, code),
      municipioCodigo: code,
      rawDetection: rawPlanning(name, code, []),
    })

    expect(scope.confidence).toBe('unknown')
    expect(canSearchConcreteParameters(scope)).toBe(false)
  })

  it('no usa una ordenanza manual sin validación técnica', () => {
    const scope = buildNormativeSearchScope({
      context: context('Sada', '15075', {
        ordinance: 'Ordenanza 3',
        source: 'siotuga',
      }),
      municipioCodigo: '15075',
      detected: {
        manualContext: {
          ordinance: 'Ordenanza 3',
          verification: 'unverified',
        },
      },
    })

    expect(scope.ordinance).toBeUndefined()
    expect(canSearchConcreteParameters(scope)).toBe(false)
  })
})
