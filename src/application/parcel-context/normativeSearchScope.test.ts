import { describe, expect, it } from 'vitest'

import type { NormalizedParcelContext } from '@/domain/parcel-context/types'
import type { PlanningNormativeDocumentType } from '@/domain/planning-knowledge/types'
import type { TerritorialDetectionSummary } from './normalizeParcelContext'
import {
  buildNormativeSearchScope,
  canSearchNormativeInformation,
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

function canonicalDetection(
  municipality: string,
  municipalityCode: string,
  documents: Array<{
    id: string
    instrumentId: string
    title: string
    sourceUrl: string
    binding: 'general' | 'area_specific' | 'unverified_for_detected_area'
    documentType?: PlanningNormativeDocumentType
  }>,
  overrides: Partial<TerritorialDetectionSummary> = {}
) : TerritorialDetectionSummary {
  return {
    schemaVersion: 1,
    municipalityName: municipality,
    municipalityCode,
    planningStatus: 'vigente',
    planningApplicabilityStatus: 'determined',
    applicableInstruments: [
        {
          id: 'instrument-current',
          name: 'Instrumento vigente',
          kind: 'PXOM',
          status: 'current',
          sourceUrl: 'https://example.invalid/instrument',
        },
      ],
    planningDocuments: documents,
    planningEvidence: [],
    planningWarnings: [],
    warnings: [],
    conflicts: [],
    affects: { analysisGeometry: 'parcel', detected: [], warnings: [], canRuleOutUndetectedAffects: false },
    locationStatus: 'confirmed',
    locationConfidence: 'high',
    inputMethod: 'cadastral_reference',
    resolvedAt: '2026-07-29T10:00:00.000Z',
    ...overrides,
  }
}

describe('buildNormativeSearchScope', () => {
  it('limita documentNames a tipos normativos excluyendo expresamente documentos con vínculo pendiente/no verificado', () => {
    const scope = buildNormativeSearchScope({
      context: context('Municipio genérico', '15001', { area: 'Ámbito 1' }),
      municipioCodigo: '15001',
      detected: canonicalDetection('Municipio genérico', '15001', [
        {
          id: 'ordinance.pdf',
          instrumentId: 'instrument-current',
          title: 'Ordenanza',
          sourceUrl: 'https://example.invalid/ordinance.pdf',
          binding: 'general',
          documentType: 'ordinance',
        },
        {
          id: 'normative.pdf',
          instrumentId: 'instrument-current',
          title: 'Normativa',
          sourceUrl: 'https://example.invalid/normative.pdf',
          binding: 'general',
          documentType: 'normative_text',
        },
        {
          id: 'sheet.pdf',
          instrumentId: 'instrument-current',
          title: 'Ficha',
          sourceUrl: 'https://example.invalid/sheet.pdf',
          binding: 'general',
          documentType: 'sheet',
        },
        {
          id: 'pending-normative.pdf',
          instrumentId: 'instrument-current',
          title: 'Normativa pendiente de vínculo espacial',
          sourceUrl: 'https://example.invalid/pending-normative.pdf',
          binding: 'unverified_for_detected_area',
          documentType: 'normative_text',
        },
        {
          id: 'legacy.pdf',
          instrumentId: 'instrument-current',
          title: 'Documento legacy',
          sourceUrl: 'https://example.invalid/legacy.pdf',
          binding: 'general',
        },
        {
          id: 'catalogue.pdf',
          instrumentId: 'instrument-current',
          title: 'Catálogo',
          sourceUrl: 'https://example.invalid/catalogue.pdf',
          binding: 'general',
          documentType: 'catalogue',
        },
        {
          id: 'other.pdf',
          instrumentId: 'instrument-current',
          title: 'Memoria',
          sourceUrl: 'https://example.invalid/other.pdf',
          binding: 'general',
          documentType: 'other',
        },
        {
          id: 'normative.pdf',
          instrumentId: 'instrument-current',
          title: 'Normativa duplicada',
          sourceUrl: 'https://example.invalid/normative-copy.pdf',
          binding: 'general',
          documentType: 'normative_text',
        },
      ]),
    })

    expect(scope.documentNames).toEqual([
      'ordinance.pdf',
      'normative.pdf',
      'sheet.pdf',
      'legacy.pdf',
    ])
  })

  it('no convierte el ámbito LEDOÑO de Culleredo en una relación documental inventada', () => {
    const scope = buildNormativeSearchScope({
      context: context('Culleredo', '15031', { area: 'LEDOÑO' }),
      municipioCodigo: '15031',
      detected: canonicalDetection('Culleredo', '15031', []),
    })

    expect(scope).toMatchObject({
      municipioCodigo: '15031',
      planningZone: 'LEDOÑO',
      confidence: 'unknown',
    })
    expect(canSearchNormativeInformation(scope)).toBe(false)
  })

  it('limita por ordenanza y documentos generales cuando la selección está validada por técnico', () => {
    const scope = buildNormativeSearchScope({
      context: context('Betanzos', '15009', {
        area: 'CASCAS',
        ordinance: 'Ordenanza R4',
        source: 'manual',
      }),
      municipioCodigo: '15009',
      detected: canonicalDetection('Betanzos', '15009', [
        {
          id: '0060no011.pdf',
          instrumentId: 'instrument-current',
          title: 'Normas urbanísticas',
          sourceUrl: 'https://example.invalid/0060no011.pdf',
          binding: 'general',
        },
      ], { manualContext: { ordinance: 'Ordenanza R4', verification: 'technician_validated' } }),
    })

    expect(scope).toMatchObject({
      source: 'technician_validated',
      confidence: 'confirmed',
      ordinance: 'Ordenanza R4',
      documentNames: ['0060no011.pdf'],
    })
    expect(canSearchNormativeInformation(scope)).toBe(true)
  })

  it('acepta un documento vinculado específicamente al ámbito sin exigir que el ámbito aparezca en cada chunk', () => {
    const scope = buildNormativeSearchScope({
      context: context('Sada', '15075', { area: 'APT-1' }),
      municipioCodigo: '15075',
      detected: canonicalDetection('Sada', '15075', [
        {
          id: 'apt-1.pdf',
          instrumentId: 'instrument-current',
          title: 'Ficha APT-1',
          sourceUrl: 'https://example.invalid/apt-1.pdf',
          binding: 'area_specific',
          documentType: 'sheet',
        },
      ]),
    })

    expect(scope.documentNames).toEqual(['apt-1.pdf'])
    expect(canSearchNormativeInformation(scope)).toBe(true)
  })

  it.each([
    ['Cerceda', '15024'],
    ['Oza-Cesuras', '15902'],
  ])('mantiene %s sin alcance paramétrico cuando sólo se conoce el municipio', (name, code) => {
    const scope = buildNormativeSearchScope({
      context: context(name, code),
      municipioCodigo: code,
      detected: canonicalDetection(name, code, []),
    })

    expect(scope.confidence).toBe('unknown')
    expect(canSearchNormativeInformation(scope)).toBe(false)
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
    expect(canSearchNormativeInformation(scope)).toBe(false)
  })

  it('usa una candidata oficial confirmada por el usuario sin tratarla como texto manual pendiente', () => {
    const scope = buildNormativeSearchScope({
      context: context('Teo', '15082'),
      municipioCodigo: '15082',
      detected: canonicalDetection('Teo', '15082', [
        {
          id: 'r2.pdf',
          instrumentId: 'instrument-current',
          title: 'Ordenanza R-2',
          sourceUrl: 'https://example.invalid/r2.pdf',
          binding: 'general',
          documentType: 'ordinance',
        },
      ], {
        ordinanceResolution: { status: 'USER_CONFIRMED', identity: { code: 'R-2', label: 'R-2' } },
        manualContext: { ordinance: 'R-2', verification: 'unverified', ordinanceDetermination: { technician: { value: 'R-2', origin: 'technician_selection', source: 'manual', verification: 'unverified' } } },
      }),
    })

    expect(scope).toMatchObject({
      ordinance: 'R-2',
      confidence: 'confirmed',
      documentNames: ['r2.pdf'],
    })
    expect(canSearchNormativeInformation(scope)).toBe(true)
  })

  it('recupera una confirmación legacy desde el contexto normalizado', () => {
    const scope = buildNormativeSearchScope({
      context: context('Teo', '15082', { ordinance: 'R-2', source: 'manual' }),
      municipioCodigo: '15082',
      detected: canonicalDetection('Teo', '15082', [
        {
          id: 'r2.pdf',
          instrumentId: 'instrument-current',
          title: 'Ordenanza R-2',
          sourceUrl: 'https://example.invalid/r2.pdf',
          binding: 'general',
          documentType: 'ordinance',
        },
      ]),
    })

    expect(scope).toMatchObject({
      ordinance: 'R-2',
      confidence: 'confirmed',
      documentNames: ['r2.pdf'],
    })
    expect(canSearchNormativeInformation(scope)).toBe(true)
  })
})
