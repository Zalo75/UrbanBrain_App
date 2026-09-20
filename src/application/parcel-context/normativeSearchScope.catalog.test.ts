import { describe, expect, it } from 'vitest'
import { buildNormativeSearchScope } from './normativeSearchScope'
import { buildNormalizedParcelContext } from './normalizeParcelContext'
import type { TerritorialDetectionSummary } from './normalizeParcelContext'
import type { NormalizedParcelContext } from '@/domain/parcel-context/types'

const context = {
  ordinanceCandidates: [{
    identity: 'R-2', instrumentId: '27387', status: 'user_confirmed', catalogStatus: 'ACCEPTED',
    identityId: '27387:ordinance:R-2', provenance: ['catalog'],
    normativeReferences: [{ documentId: '27387no101.pdf', chunkIds: ['chunk-r2'], relation: 'defines', sourceId: 'catalog' }],
  }],
  qualification: { source: 'manual', verification: 'confirmed', value: 'R-2' },
  planningArea: undefined,
  actionArea: undefined,
  urbanisticFacts: undefined,
} as unknown as NormalizedParcelContext

const canonicalTeoSummary: TerritorialDetectionSummary = {
  schemaVersion: 1,
  municipalityName: 'Teo',
  municipalityCode: '15082',
  applicableInstruments: [{ id: '27387', status: 'current' } as TerritorialDetectionSummary['applicableInstruments'][number]],
  planningDocuments: [],
  planningStatus: 'vigente',
  planningApplicabilityStatus: 'determined',
}

describe('catalog-backed normative scope', () => {
  it('carries canonical identity and exact references into the scope', () => {
    const scope = buildNormativeSearchScope({ context, municipioCodigo: '15082', detected: canonicalTeoSummary })
    expect(scope.instrumentId).toBe('27387')
    expect(scope.ordinance).toBe('R-2')
    expect(scope.identityId).toBe('27387:ordinance:R-2')
    expect(scope.normativeReferences?.[0]?.chunkIds).toEqual(['chunk-r2'])
  })

  it('enriches a legacy USER_CONFIRMED textual candidate without changing parcel authority', () => {
    const legacyCandidate = {
      identity: 'R-2',
      semanticDimension: 'ordinance' as const,
      instrumentId: '27387',
      status: 'user_confirmed' as const,
      provenance: ['territorial:legacy-confirmation'],
    }
    const legacyContext = {
      ...context,
      ordinanceCandidates: [legacyCandidate],
      qualification: { source: 'manual', verification: 'confirmed', value: 'R-2' },
    } as unknown as NormalizedParcelContext

    const scope = buildNormativeSearchScope({
      context: legacyContext,
      municipioCodigo: '15082',
      detected: canonicalTeoSummary,
    })

    expect(scope).toMatchObject({
      ordinance: 'R-2',
      identityId: '27387:ordinance:R-2',
      identityName: 'Solo Rústico de Especial Protección Agropecuaria',
      catalogStatus: 'ACCEPTED',
    })
    expect(scope.normativeReferences?.some((reference) => reference.article === 'Art. 130')).toBe(true)
    expect(scope.catalogProvenance?.length).toBeGreaterThan(0)
    expect(scope.determinationProvenance).toEqual(['territorial:legacy-confirmation'])
    expect(scope.normativeReferences?.flatMap((reference) => reference.chunkIds)).toEqual(expect.arrayContaining([
      '939bc9fc3898b3ce_00218',
      '92b10db60e176e24_00134',
      '34993b24eadaaf09_00237',
    ]))
    expect(legacyContext.ordinanceCandidates?.[0]).toEqual(legacyCandidate)
  })

  it('enriches an automatic RESOLVED textual candidate', () => {
    const resolvedContext = {
      ...context,
      ordinanceCandidates: [{
        identity: 'R-2', semanticDimension: 'zoning', instrumentId: '27387', status: 'active', provenance: ['territorial:auto'],
      }],
      qualification: { source: 'siotuga', verification: 'confirmed', value: 'R-2' },
    } as unknown as NormalizedParcelContext
    const scope = buildNormativeSearchScope({
      context: resolvedContext,
      municipioCodigo: '15082',
      detected: { ordinanceResolution: { status: 'RESOLVED', identity: { code: 'R-2' } } },
      detected: { ...canonicalTeoSummary, ordinanceResolution: { status: 'RESOLVED', identity: { code: 'R-2' } } },
    })
    expect(scope.identityId).toBe('27387:ordinance:R-2')
    expect(scope.normativeReferences?.some((reference) => reference.article === 'Art. 130')).toBe(true)
  })

  it('enriches a USER_CONFIRMED candidate transported from legacy determination state', () => {
    const detected = {
      municipalityName: 'Teo',
      municipalityCode: '15082',
      ordinanceCandidates: [],
      ordinanceDetermination: {
        candidates: [{
          identity: 'R-2',
          instrumentId: '27387',
          semanticDimension: 'ordinance',
          status: 'user_confirmed',
          provenance: ['territorial:legacy-confirmation'],
        }],
      },
      ordinanceResolution: {
        status: 'USER_CONFIRMED',
        identity: { code: 'R-2' },
        provenance: ['territorial:legacy-confirmation'],
        confirmationSource: 'user',
        confirmedByUser: true,
      },
    } as unknown as TerritorialDetectionSummary
    const normalized = buildNormalizedParcelContext({ expediente: {}, detected })
    const scope = buildNormativeSearchScope({
      context: normalized,
      municipioCodigo: '15082',
      detected: canonicalTeoSummary,
    })

    expect(normalized.ordinanceCandidates).toHaveLength(1)
    expect(scope.identityId).toBe('27387:ordinance:R-2')
    expect(scope.normativeReferences?.some((reference) => reference.article === 'Art. 130')).toBe(true)
  })

  it('preserves catalog enrichment when the action area remains unvalidated', () => {
    const unvalidatedAreaContext = {
      ...context,
      ordinanceCandidates: [{
        identity: 'R-2', instrumentId: '27387', semanticDimension: 'ordinance',
        status: 'user_confirmed', provenance: ['territorial:legacy-confirmation'],
      }],
      actionArea: { value: { id: 'area-1', selectionType: 'automatic' }, verification: 'unconfirmed' },
    } as unknown as NormalizedParcelContext
    const scope = buildNormativeSearchScope({
      context: unvalidatedAreaContext,
      municipioCodigo: '15082',
      detected: canonicalTeoSummary,
    })

    expect(scope.actionAreaValidated).toBe(false)
    expect(scope.reason).toContain('todavía no está técnicamente validada')
    expect(scope.identityId).toBe('27387:ordinance:R-2')
    expect(scope.catalogStatus).toBe('ACCEPTED')
    expect(scope.normativeReferences?.some((reference) => reference.article === 'Art. 130')).toBe(true)
  })

  it('can enrich a legacy resolution when its explicit dimension survives but candidates do not', () => {
    const legacyContext = {
      ...context,
      ordinanceCandidates: [],
      qualification: { source: 'manual', verification: 'confirmed', value: 'R-2' },
    } as unknown as NormalizedParcelContext
    const scope = buildNormativeSearchScope({
      context: legacyContext,
      municipioCodigo: '15082',
      detected: {
        ordinanceResolution: {
          status: 'USER_CONFIRMED',
          semanticDimension: 'ordinance',
          identity: { code: 'R-2' },
          provenance: ['territorial:legacy-resolution'],
        },
      },
      detected: { ...canonicalTeoSummary, ordinanceResolution: { status: 'USER_CONFIRMED', semanticDimension: 'ordinance', identity: { code: 'R-2' }, provenance: ['territorial:legacy-resolution'] } },
    })
    expect(scope.identityId).toBe('27387:ordinance:R-2')
    expect(scope.determinationProvenance).toEqual(['territorial:legacy-resolution'])
  })

  it('resolves a unique accepted catalog identity from USER_CONFIRMED without a runtime candidate', () => {
    const legacyContext = {
      ...context,
      ordinanceCandidates: [],
      qualification: { source: 'manual', verification: 'confirmed', value: 'R-2' },
    } as unknown as NormalizedParcelContext
    const scope = buildNormativeSearchScope({
      context: legacyContext,
      municipioCodigo: '15082',
      detected: {
        ordinanceResolution: {
          status: 'USER_CONFIRMED',
          identity: { code: 'R-2' },
          provenance: ['territorial:user-confirmed'],
        },
      },
      detected: { ...canonicalTeoSummary, ordinanceResolution: { status: 'USER_CONFIRMED', identity: { code: 'R-2' }, provenance: ['territorial:user-confirmed'] } },
    })

    expect(scope.identityId).toBe('27387:ordinance:R-2')
    expect(scope.identityName).toBe('Solo Rústico de Especial Protección Agropecuaria')
    expect(scope.normativeReferences?.some((reference) => reference.article === 'Art. 130')).toBe(true)
    expect(scope.authoritativeSelection).toBe(true)
  })

  it('does not enrich an unconfirmed identity with an unknown semantic dimension', () => {
    const unknownDimensionContext = {
      ...context,
      ordinanceCandidates: [{
        identity: 'R-2', instrumentId: '27387', status: 'active', provenance: ['territorial:automatic'],
      }],
      qualification: { source: 'siotuga', verification: 'confirmed', value: 'R-2' },
    } as unknown as NormalizedParcelContext
    const scope = buildNormativeSearchScope({ context: unknownDimensionContext, municipioCodigo: '15082', detected: canonicalTeoSummary })
    expect(scope.identityId).toBeUndefined()
    expect(scope.normativeReferences).toBeUndefined()
  })

  it('does not enrich a review-required parcel candidate', () => {
    const reviewContext = {
      ...context,
      ordinanceCandidates: [{
        identity: 'R-2', semanticDimension: 'ordinance', instrumentId: '27387', status: 'review', provenance: ['territorial:review'],
      }],
      qualification: undefined,
    } as unknown as NormalizedParcelContext
    const scope = buildNormativeSearchScope({
      context: reviewContext,
      municipioCodigo: '15082',
      detected: { ordinanceResolution: { status: 'REVIEW_REQUIRED', identity: { code: 'R-2' } } },
      detected: { ...canonicalTeoSummary, ordinanceResolution: { status: 'REVIEW_REQUIRED', identity: { code: 'R-2' } } },
    })
    expect(scope.identityId).toBeUndefined()
    expect(scope.ordinance).toBeUndefined()
  })

  it('does not enrich a review-required catalog identity', () => {
    const reviewCatalogContext = {
      ...context,
      ordinanceCandidates: [{
        identity: '1', semanticDimension: 'ordinance', instrumentId: '23045', status: 'user_confirmed', provenance: ['territorial:user'],
      }],
      qualification: { source: 'manual', verification: 'confirmed', value: '1' },
    } as unknown as NormalizedParcelContext
    const scope = buildNormativeSearchScope({
      context: reviewCatalogContext,
      municipioCodigo: '36059',
      detected: { ...canonicalTeoSummary, municipalityCode: '36059', applicableInstruments: [{ id: '23045', status: 'current' } as TerritorialDetectionSummary['applicableInstruments'][number]] },
    })
    expect(scope.ordinance).toBe('1')
    expect(scope.identityId).toBeUndefined()
    expect(scope.normativeReferences).toBeUndefined()
  })

  it('does not cross instrument boundaries even when the text matches', () => {
    const crossInstrumentContext = {
      ...context,
      ordinanceCandidates: [{
        identity: 'R-2', semanticDimension: 'ordinance', instrumentId: '27387', status: 'user_confirmed', provenance: ['territorial:user'],
      }],
      qualification: { source: 'manual', verification: 'confirmed', value: 'R-2' },
    } as unknown as NormalizedParcelContext
    const scope = buildNormativeSearchScope({
      context: crossInstrumentContext,
      municipioCodigo: '15082',
      detected: { ...canonicalTeoSummary, applicableInstruments: [{ id: 'different-instrument', status: 'current' } as TerritorialDetectionSummary['applicableInstruments'][number]] },
    })
    expect(scope.instrumentId).toBe('different-instrument')
    expect(scope.identityId).toBeUndefined()
  })

  it('keeps the safe current behavior when no accepted catalog match exists', () => {
    const unknownContext = {
      ...context,
      ordinanceCandidates: [{
        identity: 'UNKNOWN-CODE', semanticDimension: 'ordinance', instrumentId: '27387', status: 'user_confirmed', provenance: ['territorial:user'],
      }],
      qualification: { source: 'manual', verification: 'confirmed', value: 'UNKNOWN-CODE' },
    } as unknown as NormalizedParcelContext
    const scope = buildNormativeSearchScope({ context: unknownContext, municipioCodigo: '15082', detected: canonicalTeoSummary })
    expect(scope.ordinance).toBe('UNKNOWN-CODE')
    expect(scope.identityId).toBeUndefined()
  })
})
