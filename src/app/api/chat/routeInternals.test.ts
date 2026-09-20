import { describe, expect, it } from 'vitest'
import { resolveMentionedAcceptedIdentities, resolveNormativeCandidateProvenance, shouldWidenDirectedNormativeScope } from './routeInternals'
import teoCatalog from '@/infrastructure/planning-knowledge/catalogs/teo-27387.json'

describe('directed normative retrieval scope', () => {
  it('resolves multiple explicitly mentioned accepted identities from the same catalog', () => {
    const identities = resolveMentionedAcceptedIdentities(
      'una parte en R-2 y otra en R-5',
      teoCatalog as any,
    )
    expect(identities.map((identity) => identity.id)).toEqual([
      '27387:ordinance:R-2',
      '27387:ordinance:R-5',
    ])
  })

  it('does not invent identities absent from the catalog', () => {
    expect(resolveMentionedAcceptedIdentities('una zona Z-99', teoCatalog as any)).toEqual([])
  })

  const scope = {
    identityId: '27387:ordinance:R-2',
    normativeReferences: [{ documentId: 'r2.pdf', chunkIds: ['r2-chunk'], relation: 'defines', sourceId: 'catalog' as const }],
  }

  it('does not inherit canonical identity into widened anonymous evidence', () => {
    expect(resolveNormativeCandidateProvenance(null, scope, false)).toEqual({
      ordinance: null,
      planningArea: null,
      identityId: null,
      normativeReferences: undefined,
    })
  })

  it('keeps provenance carried by the chunk itself', () => {
    expect(resolveNormativeCandidateProvenance({
      kind: 'ordinance', code: 'R-5', provenance: 'explicit_heading', confidence: 'high',
    }, scope, false)).toMatchObject({ ordinance: 'R-5', identityId: null })
  })

  it('preserves the canonical scope for strict evidence', () => {
    expect(resolveNormativeCandidateProvenance(null, scope, true)).toMatchObject({
      identityId: '27387:ordinance:R-2',
      normativeReferences: scope.normativeReferences,
    })
  })

  it('keeps a canonical identity boundary for same-identity gaps', () => {
    expect(shouldWidenDirectedNormativeScope(
      '¿Cuántos m² edificables y cuántas plantas permite la ordenanza aplicable?',
      ['Falta confirmar los parámetros de edificabilidad de la ordenanza R-2'],
      'R-2',
    )).toBe(false)
  })

  it('widens only when another identity or cross-zone evidence is requested', () => {
    expect(shouldWidenDirectedNormativeScope(
      '¿Puedo construir entre R-2 y R-5?',
      ['Falta la compatibilidad entre las dos zonas'],
      'R-2',
    )).toBe(true)
  })

  it('does not invent a boundary without a canonical identity', () => {
    expect(shouldWidenDirectedNormativeScope('Busca la normativa aplicable', [], null)).toBe(true)
  })
})
