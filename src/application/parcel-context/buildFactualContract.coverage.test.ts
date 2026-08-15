import { describe, expect, it } from 'vitest'
import type { NormalizedParcelContext } from '@/domain/parcel-context/types'
import type { UrbanisticRegimeFacts } from '@/domain/territorial-resolver/types'
import { buildTerritorialFactualContract } from './buildFactualContract'
import type { TerritorialCoverageDerivationDiagnostics } from './buildFactualContract'
import { buildNormalizedParcelContext } from './normalizeParcelContext'
import { enforceFactualCoverage } from './shadow/factualCoverage'
import { buildFactualComposerEvidence } from './shadow/factualComposerEvidence'
import { shouldRunVisibleFactual } from './shadow/visibleFactualRouting'

const geometry = {
  type: 'MultiPolygon' as const,
  coordinates: [[[[-8.1, 43.6], [-8.09, 43.6], [-8.09, 43.61], [-8.1, 43.6]]]],
  crs: 'EPSG:4326' as const,
}

function singleCategoryFacts(code: string): UrbanisticRegimeFacts {
  const base = {
    status: 'automatic_confirmed' as const,
    origin: 'spatial_intersection' as const,
    confidence: 'high' as const,
    evidence: [], warnings: [], discrepancies: [], nextAction: 'none' as const,
  }
  return {
    classification: { ...base, value: { code: 'SNR', label: 'Suelo de Núcleo Rural' } },
    category: { ...base, value: { code, label: code } },
    consolidation: {
      status: 'not_available', confidence: 'unknown', evidence: [], warnings: [],
      discrepancies: [], nextAction: 'none',
    },
  }
}

function valdovinoContext(): NormalizedParcelContext {
  const facts = singleCategoryFacts('SNRSC')
  return {
    cadastralReference: {
      value: '15088A034002230000HU', source: 'catastro', confidence: 1,
      verification: 'confirmed',
    },
    parcelGeometry: geometry,
    parcelSurfaceSquareMetres: 854.78,
    parcelUrbanisticFacts: facts,
    urbanisticFacts: singleCategoryFacts('SNRSC'),
    actionArea: {
      value: {
        id: 'valdovino-whole-parcel', geometry, surfaceSquareMetres: 854.78,
        parcelSurfaceSquareMetres: 854.78, selectionType: 'whole_parcel',
        source: 'parcel_geometry', confidence: 'high', selectedBy: 'system',
        selectedAt: '2026-08-15T08:00:00.000Z', verification: 'unverified',
      },
      source: 'urbanbrain', confidence: 1, verification: 'confirmed',
    },
    knownConstraints: [], parcelKnownConstraints: [], conflicts: [], pendingValidation: [],
  }
}

function buildWithDiagnostics(context: NormalizedParcelContext) {
  let diagnostics: TerritorialCoverageDerivationDiagnostics = {}
  const contract = buildTerritorialFactualContract(context, {
    onCoverageDiagnostics: (value) => { diagnostics = value },
  })
  return { contract, diagnostics }
}

describe('territorial category coverage contract', () => {
  it('derives full from the real normalized Valdoviño shape, including the stored synthetic label', () => {
    const facts = singleCategoryFacts('SNRSC')
    facts.category.label = 'Categoría homogénea oficial SNRSC'
    facts.category.value!.label = 'Categoría homogénea oficial SNRSC'
    const normalized = buildNormalizedParcelContext({
      expediente: { refCatastral: '15088A034002230000HU' },
      detected: {
        cadastralReference: '15088A034002230000HU',
        parcelGeometry: geometry,
        urbanisticFacts: facts,
        actionAreaSelection: {
          history: [],
          current: {
            id: 'valdovino-real', geometry, surfaceSquareMetres: 854.78,
            parcelSurfaceSquareMetres: 855, selectionType: 'whole_parcel',
            source: 'catastro', confidence: 'high', selectedBy: 'system',
            selectedAt: '2026-08-15T08:00:00.000Z', verification: 'unverified',
          },
        },
      },
    })
    const contract = buildTerritorialFactualContract(normalized)

    expect(normalized.parcelGeometry).toEqual(geometry)
    expect(contract.factsByScope?.parcel?.categories?.[0]).toEqual(expect.objectContaining({
      code: 'SNRSC', coverage: 'full',
    }))
    expect(contract.factsByScope?.parcel?.categories?.[0].parcelPercentage).toBeUndefined()
    expect(contract.factsByScope?.actionArea?.categories?.[0].coverage).toBe('full')
  })

  it('derives full for accredited Valdoviño whole-parcel SNRSC in each own scope', () => {
    const { contract, diagnostics } = buildWithDiagnostics(valdovinoContext())

    expect(contract.factsByScope?.parcel?.categories).toEqual([
      expect.objectContaining({ code: 'SNRSC', coverage: 'full' }),
    ])
    expect(contract.factsByScope?.actionArea?.categories).toEqual([
      expect.objectContaining({ code: 'SNRSC', coverage: 'full' }),
    ])
    expect(contract.factsByScope?.parcel?.categories?.[0].parcelPercentage).toBeUndefined()
    expect(diagnostics['parcel:SNRSC']).toEqual(expect.objectContaining({
      result: 'full',
      wholeParcel: true,
      parcelGeometryPresent: true,
      actionAreaGeometryPresent: true,
      parcelAreaSquareMetres: 854.78,
      actionAreaSquareMetres: 854.78,
      areaDifferenceSquareMetres: 0,
      allowedAreaToleranceSquareMetres: 0.85478,
      areasConcordant: true,
      parcelCategoryCode: 'SNRSC',
      actionAreaCategoryCode: 'SNRSC',
      sameCategory: true,
      parcelConfirmedHigh: true,
      actionAreaConfirmedHigh: true,
      competingCandidateCount: 0,
      noCompetingCandidates: true,
      failedRequirements: [],
    }))
  })

  it('diagnoses missing action-area geometry without changing unknown coverage', () => {
    const context = valdovinoContext()
    Reflect.deleteProperty(context.actionArea!.value, 'geometry')
    const { contract, diagnostics } = buildWithDiagnostics(context)

    expect(contract.factsByScope?.parcel?.categories?.[0].coverage).toBe('unknown')
    expect(diagnostics['parcel:SNRSC']).toEqual(expect.objectContaining({
      result: 'unknown', actionAreaGeometryPresent: false,
      failedRequirements: expect.arrayContaining(['missing_action_area_geometry']),
    }))
  })

  it('diagnoses non-concordant areas without changing unknown coverage', () => {
    const context = valdovinoContext()
    context.actionArea!.value.surfaceSquareMetres = 800
    const { contract, diagnostics } = buildWithDiagnostics(context)

    expect(contract.factsByScope?.parcel?.categories?.[0].coverage).toBe('unknown')
    expect(diagnostics['parcel:SNRSC']).toEqual(expect.objectContaining({
      areasConcordant: false,
      failedRequirements: expect.arrayContaining(['areas_not_concordant']),
    }))
    expect(diagnostics['parcel:SNRSC'].areaDifferenceSquareMetres).toBeCloseTo(54.78)
  })

  it('diagnoses category mismatch without changing unknown coverage', () => {
    const context = valdovinoContext()
    context.urbanisticFacts = singleCategoryFacts('SNRC')
    const { contract, diagnostics } = buildWithDiagnostics(context)

    expect(contract.factsByScope?.parcel?.categories?.[0].coverage).toBe('unknown')
    expect(diagnostics['parcel:SNRSC']).toEqual(expect.objectContaining({
      sameCategory: false,
      failedRequirements: expect.arrayContaining(['category_mismatch']),
    }))
  })

  it.each([
    ['parcel', 'parcel_not_confirmed_high'],
    ['actionArea', 'action_area_not_confirmed_high'],
  ] as const)('diagnoses insufficient %s status/confidence', (scope, failure) => {
    const context = valdovinoContext()
    const facts = scope === 'parcel' ? context.parcelUrbanisticFacts! : context.urbanisticFacts!
    facts.category.confidence = 'medium'
    const { contract, diagnostics } = buildWithDiagnostics(context)

    expect(contract.factsByScope?.parcel?.categories?.[0].coverage).toBe('unknown')
    expect(diagnostics['parcel:SNRSC'].failedRequirements).toContain(failure)
  })

  it('diagnoses competing candidates without changing unknown coverage', () => {
    const context = valdovinoContext()
    context.parcelUrbanisticFacts!.category.candidates = [{ value: { code: 'SNRC' } }]
    const { contract, diagnostics } = buildWithDiagnostics(context)

    expect(contract.factsByScope?.parcel?.categories?.[0].coverage).toBe('unknown')
    expect(diagnostics['parcel:SNRSC']).toEqual(expect.objectContaining({
      competingCandidateCount: 1,
      noCompetingCandidates: false,
      failedRequirements: expect.arrayContaining(['competing_candidates']),
    }))
  })

  it('keeps contract, routing and Composer evidence identical when diagnostics are enabled', () => {
    const context = valdovinoContext()
    const withoutDiagnostics = buildTerritorialFactualContract(context)
    const { contract: withDiagnostics } = buildWithDiagnostics(context)
    const question = '¿Toda la parcela tiene la misma categoría urbanística?'
    const emptyOutput = { operations: [], abstentions: [] }
    const withoutOutput = enforceFactualCoverage(question, withoutDiagnostics, emptyOutput).output
    const withOutput = enforceFactualCoverage(question, withDiagnostics, emptyOutput).output

    expect(withDiagnostics).toEqual(withoutDiagnostics)
    expect(withOutput).toEqual(withoutOutput)
    expect(shouldRunVisibleFactual(question, withDiagnostics)).toBe(
      shouldRunVisibleFactual(question, withoutDiagnostics)
    )
    expect(buildFactualComposerEvidence(question, withDiagnostics, withOutput)).toEqual(
      buildFactualComposerEvidence(question, withoutDiagnostics, withoutOutput)
    )
  })

  it('does not infer parcel full from an actionArea fact alone', () => {
    const context = valdovinoContext()
    context.parcelUrbanisticFacts = undefined
    const { contract } = buildWithDiagnostics(context)

    expect(contract.factsByScope?.parcel?.categories).toBeUndefined()
    expect(contract.factsByScope?.actionArea?.categories?.[0].coverage).toBe('unknown')
  })

  it('keeps Sada multicategory percentages partial and never promotes dominance to full', () => {
    const context = valdovinoContext()
    context.parcelUrbanisticFacts = {
      ...singleCategoryFacts('SNRC'),
      category: {
        status: 'conflict', origin: 'spatial_intersection', confidence: 'high',
        evidence: [], warnings: [], discrepancies: [], nextAction: 'manual_selection',
        candidates: [
          { value: { code: 'SNRC', label: 'Núcleo Rural Común' }, parcelPercentage: 98.53 },
          { value: { code: 'SNRT', label: 'Núcleo Rural Tradicional' }, parcelPercentage: 1.47 },
        ],
      },
    }
    const { contract, diagnostics } = buildWithDiagnostics(context)

    expect(contract.factsByScope?.parcel?.categories).toEqual([
      expect.objectContaining({ code: 'SNRC', parcelPercentage: 98.53, coverage: 'partial' }),
      expect.objectContaining({ code: 'SNRT', parcelPercentage: 1.47, coverage: 'partial' }),
    ])
    expect(diagnostics['parcel:SNRC']).toEqual(expect.objectContaining({
      result: 'partial', failedRequirements: [],
    }))
    expect(diagnostics['parcel:SNRT']).toEqual(expect.objectContaining({
      result: 'partial', failedRequirements: [],
    }))
  })
})
