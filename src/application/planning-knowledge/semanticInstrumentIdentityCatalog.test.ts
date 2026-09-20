import { describe, expect, it } from 'vitest'
import type { ReasonerProvider } from '@/application/chat/reasonerProvider'
import { namespaceSemanticObservations } from '@/domain/planning-knowledge/semanticCatalog'
import type { SemanticCatalogObservation } from '@/domain/planning-knowledge/semanticCatalog'
import { buildInstrumentIdentityCatalog, createReasonerSemanticCatalogModel, extractReasonerSemanticCatalogBatch, isFinalNormativeIdentityCandidate, validateSemanticResponse } from './semanticInstrumentIdentityCatalog'

const packets = [
  { packetId: 'article-7', kind: 'text' as const, documentId: 'norma.pdf', officialUrl: 'https://official.test/norma.pdf', chunkIds: ['c7'], text: 'Artigo 7. A clave QX identifica a zona de protección.' },
  { packetId: 'table-2', kind: 'table' as const, documentId: 'catalogo.pdf', officialUrl: 'https://official.test/catalogo.pdf', chunkIds: ['t2'], text: 'QX | Zona de protección hídrica' },
]

function observation(overrides: Partial<SemanticCatalogObservation> & Pick<SemanticCatalogObservation, 'observationId' | 'surfaceForm' | 'name'>): SemanticCatalogObservation {
  return {
    observationId: overrides.observationId, surfaceForm: overrides.surfaceForm, code: overrides.code ?? null, name: overrides.name,
    dimension: overrides.dimension ?? { label: 'clave territorial', normalizedType: 'territorial-key' }, role: overrides.role ?? 'definition',
    semanticRole: overrides.semanticRole ?? 'territorial identity', territorialRelation: overrides.territorialRelation ?? { kind: 'characterizes', scope: 'parcel or part of parcel' },
    identityAssessment: overrides.identityAssessment ?? { isTerritorialIdentity: true, characterization: 'direct', normativeAxis: 'demonstrated', basis: 'The evidence defines a selectable territorial determination.' },
    aliases: overrides.aliases ?? [], evidence: overrides.evidence ?? [{ packetId: 'article-7', quote: overrides.surfaceForm, relation: 'defines' }], relatedObservations: overrides.relatedObservations ?? [],
    confidence: overrides.confidence ?? 'high', epistemicStatus: overrides.epistemicStatus ?? 'ACCEPTED', promotionDecision: overrides.promotionDecision ?? 'NORMATIVE_IDENTITY', reasoning: overrides.reasoning ?? 'test',
  }
}

function catalog(observations: SemanticCatalogObservation[]) {
  return buildInstrumentIdentityCatalog({ municipalityCode: '99999', instrumentId: 'abc', generatedAt: '2026-01-01', sourceManifest: [], packets, modelOutput: { warnings: [], observations } })
}

describe('semantic instrument identity catalog', () => {
  it('namespaces observations globally across batches and resolves every identity source', () => {
    const batches = Array.from({ length: 300 }, (_, batch) => namespaceSemanticObservations({ warnings: [], observations: [observation({ observationId: 'obs-001', surfaceForm: `Zona ${batch}`, name: `Zona ${batch}`, code: `Z${batch}`, evidence: [{ packetId: 'article-7', quote: `Z${batch}`, relation: 'defines' }] })] }, `batch-${batch + 1}`))
    const all = batches.flatMap((batch) => batch.observations)
    expect(new Set(all.map((item) => item.observationId)).size).toBe(all.length)
    const result = catalog(all)
    const observationsById = new Map(result.semanticObservations?.map((item) => [item.observationId, item]))
    expect(result.identities.every((identity) => identity.sourceObservationIds?.every((id) => observationsById.has(id)))).toBe(true)
  })

  function response(packetId: string) {
    return JSON.stringify({ observations: [observation({ observationId: 'q', surfaceForm: 'QX', code: 'QX', name: 'Zona X', evidence: [{ packetId, quote: 'QX', relation: 'defines' }] })], warnings: [] })
  }

  function responseWithEvidence(evidence: unknown) {
    return JSON.stringify({ observations: [{ ...observation({ observationId: 'q', surfaceForm: 'QX', code: 'QX', name: 'Zona X' }), evidence }], warnings: [] })
  }

  function abortError(message = 'Request was aborted.') {
    const error = new Error(message)
    error.name = 'AbortError'
    return error
  }

  it('uses a 120000ms timeout and reports first-attempt success as zero retries', async () => {
    const requests: Array<{ timeoutMs?: number; signal?: AbortSignal }> = []
    const reasoner: ReasonerProvider = { name: 'fake', generate: async (request) => { requests.push(request); return { provider: 'fake', model: 'fake', latencyMs: 1, rawContent: response('article-7') } } }
    const result = await extractReasonerSemanticCatalogBatch(reasoner, { municipalityCode: '99999', instrumentId: 'abc', packets }, { maxRetries: 1 })
    expect(result.attemptCount).toBe(1)
    expect(result.retryCount).toBe(0)
    expect(requests).toHaveLength(1)
    expect(requests[0]?.timeoutMs).toBe(120000)
  })

  it('reports one retry after a transient failure and uses an independent controller', async () => {
    const requests: Array<{ timeoutMs?: number; signal?: AbortSignal }> = []
    let calls = 0
    const reasoner: ReasonerProvider = { name: 'fake', generate: async (request) => { requests.push(request); calls += 1; if (calls === 1) throw abortError(); return { provider: 'fake', model: 'fake', latencyMs: 1, rawContent: response('article-7') } } }
    const result = await extractReasonerSemanticCatalogBatch(reasoner, { municipalityCode: '99999', instrumentId: 'abc', packets }, { maxRetries: 1 })
    expect(result.attemptCount).toBe(2)
    expect(result.retryCount).toBe(1)
    expect(requests.map((request) => request.timeoutMs)).toEqual([120000, 120000])
    expect(requests[0]?.signal).toBeDefined()
    expect(requests[1]?.signal).toBeDefined()
    expect(requests[0]?.signal).not.toBe(requests[1]?.signal)
  })

  it('preserves terminal timeout metadata after the single retry', async () => {
    const reasoner: ReasonerProvider = { name: 'fake', generate: async () => { throw abortError('upstream timeout') } }
    await expect(extractReasonerSemanticCatalogBatch(reasoner, { municipalityCode: '99999', instrumentId: 'abc', packets }, { maxRetries: 1 })).rejects.toMatchObject({ attemptCount: 2, retryCount: 1, lastError: 'upstream timeout', errorCause: 'upstream timeout', isTimeoutOrAbort: true, isTransient: true })
  })

  it('does not retry a non-transient error and reports one attempt', async () => {
    let calls = 0
    const reasoner: ReasonerProvider = { name: 'fake', generate: async () => { calls += 1; throw new Error('invalid request') } }
    await expect(extractReasonerSemanticCatalogBatch(reasoner, { municipalityCode: '99999', instrumentId: 'abc', packets }, { maxRetries: 1 })).rejects.toMatchObject({ attemptCount: 1, retryCount: 0, lastError: 'invalid request', isTimeoutOrAbort: false, isTransient: false })
    expect(calls).toBe(1)
  })

  it('accepts an exact packetId and rejects a documentId without silently mapping it', () => {
    expect(validateSemanticResponse(response('article-7'), packets)).toEqual({ valid: true })
    const invalid = validateSemanticResponse(response('norma.pdf'), packets)
    expect(invalid.valid).toBe(false)
    if (!invalid.valid) expect(invalid.errors[0]).toMatchObject({ path: '$.observations[0].evidence[0].packetId', received: 'norma.pdf' })
  })

  it('rejects an empty evidence array structurally', () => {
    const invalid = validateSemanticResponse(responseWithEvidence([]), packets)
    expect(invalid.valid).toBe(false)
    if (!invalid.valid) expect(invalid.errors).toContainEqual(expect.objectContaining({ path: '$.observations[0].evidence', expected: 'non-empty array' }))
  })

  it('gives repair the exact validation path, error and allowed packetIds, preserving both raw responses', async () => {
    const prompts: string[] = []
    let callCount = 0
    const reasoner: ReasonerProvider = { name: 'fake', generate: async (request) => { prompts.push(request.userPrompt); callCount += 1; return { provider: 'fake', model: 'fake', latencyMs: 1, rawContent: callCount === 1 ? response('norma.pdf') : response('article-7') } } }
    const result = await extractReasonerSemanticCatalogBatch(reasoner, { municipalityCode: '99999', instrumentId: 'abc', packets }, { maxRetries: 0 })
    expect(result.repaired).toBe(true)
    expect(result.rawOriginalContent).toBe(response('norma.pdf'))
    expect(result.rawContent).toBe(response('article-7'))
    expect(result.originalValidationErrors?.[0]).toMatchObject({ path: '$.observations[0].evidence[0].packetId', received: 'norma.pdf' })
    expect(prompts[1]).toContain('path=$.observations[0].evidence[0].packetId')
    expect(prompts[1]).toContain('received="norma.pdf"')
    expect(prompts[1]).toContain('article-7, table-2')
    expect(prompts[1]).toContain('Do not use documentId')
  })

  it('does not choose arbitrarily when a document has multiple packets', () => {
    const ambiguousPackets = [...packets, { packetId: 'article-7b', kind: 'text' as const, documentId: 'norma.pdf', officialUrl: 'https://official.test/norma.pdf', chunkIds: ['c7b'], text: 'otra evidencia' }]
    const invalid = validateSemanticResponse(response('norma.pdf'), ambiguousPackets)
    expect(invalid.valid).toBe(false)
    if (!invalid.valid) expect(invalid.errors[0]?.expected).toContain('article-7')
  })

  it('ends FAILED after one repair if the packetId remains invalid', async () => {
    const reasoner: ReasonerProvider = { name: 'fake', generate: async () => ({ provider: 'fake', model: 'fake', latencyMs: 1, rawContent: response('norma.pdf') }) }
    await expect(extractReasonerSemanticCatalogBatch(reasoner, { municipalityCode: '99999', instrumentId: 'abc', packets }, { maxRetries: 0 })).rejects.toMatchObject({ message: 'Semantic model returned structurally invalid JSON after one repair attempt', originalValidationErrors: [{ path: '$.observations[0].evidence[0].packetId' }], repairValidationErrors: [{ path: '$.observations[0].evidence[0].packetId' }], originalRawContent: expect.any(String), rawContent: expect.any(String) })
  })

  it('never destroys required evidence when repair has no valid provenance available', async () => {
    let callCount = 0
    const reasoner: ReasonerProvider = { name: 'fake', generate: async () => { callCount += 1; return { provider: 'fake', model: 'fake', latencyMs: 1, rawContent: callCount === 1 ? response('norma.pdf') : responseWithEvidence([]) } } }
    await expect(extractReasonerSemanticCatalogBatch(reasoner, { municipalityCode: '99999', instrumentId: 'abc', packets }, { maxRetries: 0 })).rejects.toMatchObject({ originalRawContent: expect.any(String), rawContent: expect.any(String), repairValidationErrors: [expect.objectContaining({ path: '$.observations[0].evidence' })] })
  })

  it('promotes an accredited territorial ordinance or zone without a fixed vocabulary', async () => {
    const reasoner: ReasonerProvider = { name: 'fake', generate: async () => ({ provider: 'fake', model: 'fake', latencyMs: 1, rawContent: JSON.stringify({ observations: [observation({ observationId: 'q', surfaceForm: 'QX', code: 'QX', name: 'Zona de protección hídrica', dimension: { label: 'clave territorial', normalizedType: 'territorial-key' }, evidence: [{ packetId: 'article-7', quote: 'clave QX identifica a zona de protección', relation: 'defines' }, { packetId: 'table-2', quote: 'QX | Zona de protección hídrica', relation: 'maps_to' }] })], warnings: [] }) }) }
    const extraction = await createReasonerSemanticCatalogModel(reasoner).extract({ municipalityCode: '99999', instrumentId: 'abc', packets })
    const result = catalog(extraction.observations)
    expect(result.identities[0]).toMatchObject({ officialCode: 'QX', semanticDimension: 'territorial-key', dimensionLabel: 'clave territorial', status: 'ACCEPTED' })
  })

  it.each([
    ['rule', 'Regla de separación'], ['parameter', 'Edificabilidad'], ['condition', 'Solar'], ['instrument', 'Plan especial'], ['group', 'Áreas de reparto'],
  ])('keeps a %s as an observation when it is not the territorial identity itself', (_kind, name) => {
    const result = catalog([observation({ observationId: _kind, surfaceForm: name, name, semanticRole: _kind, territorialRelation: { kind: 'affects', scope: 'parcel' }, identityAssessment: { isTerritorialIdentity: false, characterization: 'indirect', normativeAxis: 'not_demonstrated', basis: 'It describes, constrains or groups territorial identities.' } })])
    expect(result.identities).toHaveLength(0)
    expect(result.semanticObservations).toHaveLength(1)
  })

  it('uses a distinct final question for territorial identity without closing the semantic vocabulary', () => {
    const unforeseenIdentity = observation({ observationId: 'open', surfaceForm: 'Régimen emergente', name: 'Régimen emergente', semanticRole: 'unforeseen territorial regime', territorialRelation: { kind: 'overlaps', scope: 'part of parcel' }, evidence: [{ packetId: 'article-7', quote: 'Régimen emergente identifica el ámbito', relation: 'defines' }] })
    const applicableRule = observation({ observationId: 'rule-proposed', surfaceForm: 'Regla aplicable', name: 'Regla aplicable', semanticRole: 'open regulatory rule', territorialRelation: { kind: 'affects', scope: 'parcel' }, identityAssessment: { isTerritorialIdentity: true, characterization: 'direct', normativeAxis: 'not_demonstrated', basis: 'The model proposed it because it affects a parcel.' }, evidence: [{ packetId: 'article-7', quote: 'Se aplicará a la parcela', relation: 'regulates' }] })
    expect(isFinalNormativeIdentityCandidate(unforeseenIdentity)).toBe(true)
    expect(isFinalNormativeIdentityCandidate(applicableRule)).toBe(false)
  })

  it.each([
    ['network regime', 'corridor', 'The evidence identifies a reusable regime for this territorial network and its applicable determinations.'],
    ['environmental overlay', 'sector', 'The evidence identifies a territorial overlay used to retrieve the determinations applicable within it.'],
    ['infrastructure protection axis', 'corridor', 'The evidence identifies a protection corridor as the territorial subject of a recoverable normative regime.'],
    ['unforeseen territorial axis', 'localization', 'The evidence identifies an open territorial dimension that organizes the determinations applicable to the location.'],
  ])('promotes a demonstrated reusable territorial axis (%s) without relying on a known vocabulary', (semanticRole, scope, basis) => {
    const candidate = observation({
      observationId: `positive-${semanticRole}`,
      surfaceForm: 'Entidad territorial A',
      name: 'Entidad territorial A',
      semanticRole,
      dimension: { label: 'dimensión abierta', normalizedType: `open-${semanticRole}` },
      territorialRelation: { kind: 'characterizes', scope },
      identityAssessment: { isTerritorialIdentity: true, characterization: 'direct', normativeAxis: 'demonstrated', basis },
      evidence: [{ packetId: 'article-7', quote: 'La entidad identifica el ámbito y sus determinaciones', relation: 'defines' }],
    })
    expect(isFinalNormativeIdentityCandidate(candidate)).toBe(true)
  })

  it.each([
    ['parcel property', 'describes', 'not_demonstrated'],
    ['parcel state', 'describes', 'not_demonstrated'],
    ['numeric parameter', 'regulates', 'not_demonstrated'],
    ['individual object', 'maps_to', 'not_demonstrated'],
    ['regulating geometry', 'maps_to', 'not_demonstrated'],
    ['unresolved territorial finding', 'defines', 'uncertain'],
  ])('does not promote a finding without demonstrated reusable-axis function (%s)', (semanticRole, relation, normativeAxis) => {
    const candidate = observation({
      observationId: `negative-${semanticRole}`,
      surfaceForm: 'Entidad territorial B',
      name: 'Entidad territorial B',
      semanticRole,
      territorialRelation: { kind: 'characterizes', scope: 'localization' },
      identityAssessment: { isTerritorialIdentity: true, characterization: 'direct', normativeAxis: normativeAxis as 'not_demonstrated' | 'uncertain', basis: 'The evidence describes something about a location but does not demonstrate a reusable normative axis.' },
      evidence: [{ packetId: 'article-7', quote: 'La evidencia se refiere a la localización', relation: relation as 'defines' | 'regulates' | 'maps_to' }],
    })
    expect(isFinalNormativeIdentityCandidate(candidate)).toBe(false)
  })

  it('keeps identity relations nested on each identity and omits a root-level duplicate', () => {
    const result = catalog([
      observation({ observationId: 'rel-a', surfaceForm: 'Clave A', code: 'A', name: 'Ámbito A', territorialRelation: { kind: 'identifies', scope: 'norte' } }),
      observation({ observationId: 'rel-b', surfaceForm: 'Clave A', code: 'A', name: 'Ámbito A', territorialRelation: { kind: 'identifies', scope: 'sur' }, evidence: [{ packetId: 'table-2', quote: 'Clave A en sur', relation: 'defines' }] }),
    ])
    expect('identityRelations' in result).toBe(false)
    expect(result.identities.some((identity) => (identity.identityRelations?.length ?? 0) > 0)).toBe(true)
  })

  it('keeps a documentary instrument separate from its territorial scope', () => {
    const result = catalog([
      observation({ observationId: 'instrument', surfaceForm: 'Plan especial', name: 'Plan especial', semanticRole: 'planning instrument', territorialRelation: { kind: 'regulates', scope: 'enclave' }, identityAssessment: { isTerritorialIdentity: false, characterization: 'indirect', normativeAxis: 'not_demonstrated', basis: 'The document regulates an area but is not the area.' } }),
      observation({ observationId: 'scope', surfaceForm: 'Enclave X', name: 'Enclave X', code: 'EX', semanticRole: 'territorial area', territorialRelation: { kind: 'characterizes', scope: 'parcel or part of parcel' }, identityAssessment: { isTerritorialIdentity: true, characterization: 'direct', normativeAxis: 'demonstrated', basis: 'The evidence defines the enclave as the territorial subject.' } }),
    ])
    expect(result.identities.map((item) => item.officialName)).toEqual(['Enclave X'])
  })

  it('does not publish an unaccredited observation even if the model proposed promotion', () => {
    const result = catalog([observation({ observationId: 'unaccredited', surfaceForm: 'Z1', name: 'Zona Z1', epistemicStatus: 'OBSERVED_NOT_ACREDITED' })])
    expect(result.identities).toHaveLength(0)
    expect(result.semanticObservations?.[0]).toMatchObject({ epistemicStatus: 'OBSERVED_NOT_ACREDITED', promotionDecision: 'NORMATIVE_IDENTITY' })
  })

  it('consolidates compatible code/name aliases and retains combined provenance', () => {
    const result = catalog([
      observation({ observationId: 'q1', surfaceForm: 'QX', code: 'QX', name: 'Zona X' }),
      observation({ observationId: 'q2', surfaceForm: 'Zona X', code: 'Zona X', name: 'Zona X', aliases: ['Q-X'], evidence: [{ packetId: 'table-2', quote: 'Zona X', relation: 'maps_to' }] }),
    ])
    expect(result.identities).toHaveLength(1)
    expect(result.identities[0]).toMatchObject({ officialCode: 'QX', aliases: ['Q-X'], sourceObservationIds: ['q1', 'q2'] })
    expect(result.identities[0]?.evidence).toHaveLength(2)
  })

  it('keeps nominally similar but structurally different entities separate', () => {
    const result = catalog([
      observation({ observationId: 'zone', surfaceForm: 'Zona X', code: 'ZX', name: 'Zona X', semanticRole: 'territorial identity', territorialRelation: { kind: 'characterizes', scope: 'parcel' } }),
      observation({ observationId: 'rule', surfaceForm: 'Zona X', code: 'ZX', name: 'Zona X', semanticRole: 'regulatory rule', territorialRelation: { kind: 'regulates', scope: 'parcel' }, identityAssessment: { isTerritorialIdentity: false, characterization: 'indirect', normativeAxis: 'not_demonstrated', basis: 'The observation is a rule, not the zone.' }, promotionDecision: 'CONCEPT_ONLY' }),
    ])
    expect(result.identities).toHaveLength(1)
    expect(result.semanticObservations).toHaveLength(2)
  })

  it('keeps two promoted candidates separate when nominal overlap lacks equivalence evidence', () => {
    const result = catalog([
      observation({ observationId: 'same-a', surfaceForm: 'Clave X', code: 'X', name: 'Zona X', territorialRelation: { kind: 'identifies', scope: 'sector norte' }, evidence: [{ packetId: 'article-7', quote: 'Clave X en sector norte', relation: 'defines' }] }),
      observation({ observationId: 'same-b', surfaceForm: 'Clave X', code: 'X', name: 'Zona X', territorialRelation: { kind: 'identifies', scope: 'parcela costera' }, evidence: [{ packetId: 'table-2', quote: 'Clave X en parcela costera', relation: 'defines' }] }),
    ])
    expect(result.identities).toHaveLength(2)
    expect(result.identities.some((item) => item.identityRelations?.some((relation) => relation.relation === 'AMBIGUOUS_EQUIVALENCE'))).toBe(true)
  })

  it('does not consolidate material contradictions', () => {
    const result = catalog([
      observation({ observationId: 'm1', surfaceForm: 'M.E', code: 'M.E', name: 'Masa forestal' }),
      observation({ observationId: 'm2', surfaceForm: 'M.E1', code: 'M.E1', name: 'Masa forestal', epistemicStatus: 'AMBIGUOUS', evidence: [{ packetId: 'article-7', quote: 'M.E1', relation: 'contradicts' }] }),
    ])
    expect(result.identities).toHaveLength(1)
    expect(result.semanticObservations).toHaveLength(2)
    expect(result.semanticObservations?.map((item) => item.epistemicStatus)).toEqual(['ACCEPTED', 'AMBIGUOUS'])
  })

  it('supports an unforeseen legitimate territorial dimension as an open value', () => {
    const result = catalog([observation({ observationId: 'new', surfaceForm: 'Clave nueva', code: 'NX', name: 'Clave nueva', dimension: { label: 'régimen territorial emergente', normalizedType: 'emerging-territorial-regime' } })])
    expect(result.identities[0]).toMatchObject({ semanticDimension: 'emerging-territorial-regime', dimensionLabel: 'régimen territorial emergente' })
  })
})
