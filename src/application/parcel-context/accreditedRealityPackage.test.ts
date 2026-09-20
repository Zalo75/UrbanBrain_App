import { describe, expect, it } from 'vitest'
import { buildAccreditedRealityPackage, buildAccreditedRealityPrompt } from './accreditedRealityPackage'
import type { TerritorialDetectionSummary } from './normalizeParcelContext'

describe('accredited reality package', () => {
  it('preserva atributos oficiales literales y separa derivados', () => {
    const detected: TerritorialDetectionSummary = {
      schemaVersion: 1,
      cadastralReference: '3263249NH5936S',
      municipalityName: 'Oleiros',
      municipalityCode: '15058',
      parcelSurfaceSquareMetres: 4415.17,
      planningInstrument: 'Instrumento oficial',
      classificationResolution: {
        status: 'clear',
        candidates: [{
          id: 'layer:SUB',
          kind: 'official_classification',
          classification: { code: 'SUB', categoryCode: 'SUB', label: 'Clasificación oficial SUB', sourceFeatureIds: ['feature-1'] },
          areas: [{ type: 'zone', name: 'SURT1', sourceFeatureIds: ['feature-1'] }],
          source: 'siotuga',
          evidence: [{ source: 'siotuga', sourceUrl: 'https://example.test/wfs', retrievedAt: '2026-01-01T00:00:00.000Z', method: 'WFS', scope: 'planning_classification' }],
          confidence: 'high',
          evidenceBasis: 'parcel_geometry',
          instrumentTraceability: 'verified',
          normalizationStatus: 'unmapped',
          officialAttributes: [{
            sourceFeatureId: 'feature-1',
            classificationCode: 'SUB',
            categoryCode: 'SUB',
            legalClassificationCode: 'SUZ',
            planningCategoryCode: 'Suelo_Urbanizable_Regimen_Transitorio',
            use: 'SURT',
            denomination: 'SURT1',
            geometryAreaSquareMetres: 4415.17,
          }],
          parcelCoverage: { parcelAreaSquareMetres: 4415.17, intersectionAreaSquareMetres: 4415.17, parcelPercentage: 100, method: 'polygon_intersection' },
        }],
        discrepancies: [],
        sourceChecks: [],
        evidence: [],
        nextAction: 'auto_accept',
      },
      unknownReasons: { identity: 'No se ha acreditado una ordenanza.' },
    }
    const context = {
      conflicts: [], pendingValidation: [], knownConstraints: [],
      landClass: { value: 'urbanizable', source: 'urbanbrain', confidence: 0.5, verification: 'inferred' },
    } as any
    const pkg = buildAccreditedRealityPackage(detected, context)
    expect(pkg.observedCandidates[0]?.officialAttributes[0]).toMatchObject({
      classificationCode: 'SUB', legalClassificationCode: 'SUZ', planningCategoryCode: 'Suelo_Urbanizable_Regimen_Transitorio', use: 'SURT', denomination: 'SURT1',
    })
    expect(pkg.derivedContext.landClass).toBe('urbanizable')
    expect(pkg.unknowns).toContain('significado operacional de uno o más códigos no determinado')
    const prompt = buildAccreditedRealityPrompt(pkg, 'Analiza la situación urbanística de la parcela.')
    expect(prompt.systemPrompt).not.toContain('SUB →')
    expect(prompt.systemPrompt).toContain('plazo global de 120 s')
    expect(prompt.systemPrompt).toContain('Prueba al menos una hipótesis provisional no identidad informada por lo observado antes de abstenerte.')
    expect(prompt.userPrompt).toContain('legalClassificationCode')
    expect(prompt.userPrompt).toContain('Suelo_Urbanizable_Regimen_Transitorio')
  })

  it('does not pass an unconfirmed ordinance candidate to Luna as a qualification', () => {
    const detected = {
      ordinanceCandidates: [{ identity: 'ORD-1', identityId: 'identity:ord-1', provenance: ['official:sheet'], status: 'active' }],
      ordinanceResolution: { status: 'REVIEW_REQUIRED', confidence: 'medium', provenance: ['official:sheet'] },
    } as TerritorialDetectionSummary
    const context = { conflicts: [], pendingValidation: [], knownConstraints: [] } as any

    const pkg = buildAccreditedRealityPackage(detected, context)
    const prompt = buildAccreditedRealityPrompt(pkg, '¿Qué ordenanza se aplica?')

    expect(pkg.derivedContext.qualification).toBeUndefined()
    expect(prompt.userPrompt).not.toContain('identity:ord-1')
    expect(prompt.userPrompt).not.toContain('"qualification"')
  })

  it('transmite una identidad normativa USER_CONFIRMED como realidad canónica', () => {
    const detected = {
      ordinanceResolution: {
        status: 'USER_CONFIRMED', identity: { code: 'NR.2', label: 'NR.2' },
        confirmedByUser: true, confirmationSource: 'user', provenance: ['official:sheet'], identityId: 'identity:nr2',
      },
      ordinanceCandidates: [{ identity: 'NR.2', instrumentId: '22221', provenance: ['official:sheet'], status: 'user_confirmed', identityId: 'identity:nr2' }],
    } as TerritorialDetectionSummary
    const pkg = buildAccreditedRealityPackage(detected, { conflicts: [], pendingValidation: [], knownConstraints: [] } as any)
    expect(pkg.confirmedNormativeIdentity).toMatchObject({ code: 'NR.2', status: 'USER_CONFIRMED', confirmedByUser: true, instrumentId: '22221', identityId: 'identity:nr2' })
    expect(buildAccreditedRealityPrompt(pkg, '¿Qué puedo construir?').systemPrompt).toContain('no vuelvas a determinar qué ordenanza es aplicable')
  })

  it('no eleva una resolución REVIEW_REQUIRED a identidad confirmada', () => {
    const detected = { ordinanceResolution: { status: 'REVIEW_REQUIRED', identity: { code: 'NR.2' }, provenance: ['official:sheet'] } } as TerritorialDetectionSummary
    const pkg = buildAccreditedRealityPackage(detected, { conflicts: [], pendingValidation: [], knownConstraints: [] } as any)
    expect(pkg.confirmedNormativeIdentity).toBeUndefined()
  })
})
