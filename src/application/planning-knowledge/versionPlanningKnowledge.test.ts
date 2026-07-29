import { describe, expect, it } from 'vitest'

import type { PlanningKnowledgeReleasePayload } from '@/domain/planning-knowledge/types'

import {
  createPlanningKnowledgeRelease,
  diffPlanningKnowledgeReleases,
} from './versionPlanningKnowledge'

function releasePayload(): Omit<PlanningKnowledgeReleasePayload, 'sources'> & {
  rawSources: Array<{
    id: string
    provider: 'siotuga'
    url: string
    retrievedAt: string
    mediaType: string
    content: string
  }>
} {
  return {
    schemaVersion: 1,
    generatedAt: '2026-07-29T12:00:00.000Z',
    scope: {
      country: 'ES',
      autonomousCommunity: 'Galicia',
      provinceCode: '15',
      excludedMunicipalityCodes: ['15050', '15034'],
    },
    rawSources: [
      {
        id: 'source-b',
        provider: 'siotuga',
        url: 'https://siotuga.xunta.gal/b',
        retrievedAt: '2026-07-29T12:00:00.000Z',
        mediaType: 'application/json',
        content: '{"b":1}',
      },
      {
        id: 'source-a',
        provider: 'siotuga',
        url: 'https://siotuga.xunta.gal/a',
        retrievedAt: '2026-07-29T12:00:00.000Z',
        mediaType: 'application/json',
        content: '{"a":1}',
      },
    ],
    municipalities: [],
    validation: { status: 'draft', errors: [], warnings: [] },
  }
}

describe('Planning Knowledge Base releases', () => {
  it('creates a deterministic release independent of source and exclusion order', () => {
    const first = createPlanningKnowledgeRelease(releasePayload())
    const reordered = releasePayload()
    reordered.rawSources.reverse()
    reordered.scope.excludedMunicipalityCodes.reverse()
    const second = createPlanningKnowledgeRelease(reordered)

    expect(second.sha256).toBe(first.sha256)
    expect(second.releaseId).toBe(first.releaseId)
    expect(second.sources.map((source) => source.id)).toEqual(['source-a', 'source-b'])
  })

  it('detects changed official source content without storing it in the release', () => {
    const before = createPlanningKnowledgeRelease(releasePayload())
    const changedPayload = releasePayload()
    changedPayload.rawSources[0]!.content = '{"b":2}'
    const after = createPlanningKnowledgeRelease(changedPayload)
    const difference = diffPlanningKnowledgeReleases(before, after)

    expect(difference.changedSources).toEqual(['source-b'])
    expect(JSON.stringify(after)).not.toContain('{"b":2}')
  })

  it('rejects duplicate source identifiers', () => {
    const payload = releasePayload()
    payload.rawSources[1]!.id = payload.rawSources[0]!.id

    expect(() => createPlanningKnowledgeRelease(payload)).toThrow(
      'Duplicate official source id'
    )
  })
})
