import { createHash } from 'node:crypto'

import type {
  MunicipalityPlanningKnowledge,
  PlanningKnowledgeRelease,
  PlanningKnowledgeReleaseDiff,
  PlanningKnowledgeReleasePayload,
  RawOfficialSource,
} from '@/domain/planning-knowledge/types'

function canonicalValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalValue)
  if (!value || typeof value !== 'object') return value

  return Object.fromEntries(
    Object.entries(value)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, child]) => [key, canonicalValue(child)])
  )
}

export function canonicalJson(value: unknown): string {
  return JSON.stringify(canonicalValue(value))
}

export function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex')
}

export function snapshotOfficialSources(rawSources: RawOfficialSource[]) {
  const ids = new Set<string>()

  return rawSources
    .map((source) => {
      if (ids.has(source.id)) throw new Error(`Duplicate official source id: ${source.id}`)
      ids.add(source.id)
      return {
        id: source.id,
        provider: source.provider,
        url: source.url,
        retrievedAt: source.retrievedAt,
        mediaType: source.mediaType,
        sha256: sha256(source.content),
      }
    })
    .sort((left, right) => left.id.localeCompare(right.id))
}

export function createPlanningKnowledgeRelease(
  payload: Omit<PlanningKnowledgeReleasePayload, 'sources'> & {
    rawSources: RawOfficialSource[]
  }
): PlanningKnowledgeRelease {
  const { rawSources, ...releasePayload } = payload
  return versionPlanningKnowledgePayload({
    ...releasePayload,
    scope: {
      ...releasePayload.scope,
      excludedMunicipalityCodes: [...releasePayload.scope.excludedMunicipalityCodes].sort(),
    },
    sources: snapshotOfficialSources(rawSources),
    municipalities: [...releasePayload.municipalities].sort((left, right) =>
      left.municipalityCode.localeCompare(right.municipalityCode)
    ),
  })
}

export function versionPlanningKnowledgePayload(
  payload: PlanningKnowledgeReleasePayload
): PlanningKnowledgeRelease {
  const normalizedPayload: PlanningKnowledgeReleasePayload = {
    ...payload,
    scope: {
      ...payload.scope,
      excludedMunicipalityCodes: [...payload.scope.excludedMunicipalityCodes].sort(),
    },
    sources: [...payload.sources].sort((left, right) => left.id.localeCompare(right.id)),
    municipalities: [...payload.municipalities].sort((left, right) =>
      left.municipalityCode.localeCompare(right.municipalityCode)
    ),
  }
  const digest = sha256(canonicalJson(normalizedPayload))

  return {
    ...normalizedPayload,
    releaseId: `pkb-es-15-${normalizedPayload.generatedAt.replace(/\D/g, '').slice(0, 14)}-${digest.slice(0, 12)}`,
    sha256: digest,
  }
}

function hashMunicipality(municipality: MunicipalityPlanningKnowledge) {
  return sha256(canonicalJson(municipality))
}

export function diffPlanningKnowledgeReleases(
  previous: PlanningKnowledgeRelease | undefined,
  next: PlanningKnowledgeRelease
): PlanningKnowledgeReleaseDiff {
  const beforeMunicipalities = new Map(
    previous?.municipalities.map((municipality) => [municipality.municipalityCode, municipality]) ?? []
  )
  const afterMunicipalities = new Map(
    next.municipalities.map((municipality) => [municipality.municipalityCode, municipality])
  )
  const beforeSources = new Map(previous?.sources.map((source) => [source.id, source]) ?? [])
  const afterSources = new Map(next.sources.map((source) => [source.id, source]))

  return {
    fromReleaseId: previous?.releaseId,
    toReleaseId: next.releaseId,
    addedMunicipalities: [...afterMunicipalities.keys()].filter(
      (code) => !beforeMunicipalities.has(code)
    ),
    removedMunicipalities: [...beforeMunicipalities.keys()].filter(
      (code) => !afterMunicipalities.has(code)
    ),
    changedMunicipalities: [...afterMunicipalities.entries()]
      .flatMap(([municipalityCode, after]) => {
        const before = beforeMunicipalities.get(municipalityCode)
        if (!before) return []
        const beforeSha256 = hashMunicipality(before)
        const afterSha256 = hashMunicipality(after)
        return beforeSha256 === afterSha256
          ? []
          : [{ municipalityCode, beforeSha256, afterSha256 }]
      })
      .sort((left, right) => left.municipalityCode.localeCompare(right.municipalityCode)),
    addedSources: [...afterSources.keys()].filter((id) => !beforeSources.has(id)).sort(),
    removedSources: [...beforeSources.keys()].filter((id) => !afterSources.has(id)).sort(),
    changedSources: [...afterSources.entries()]
      .filter(([id, source]) => {
        const before = beforeSources.get(id)
        return before && before.sha256 !== source.sha256
      })
      .map(([id]) => id)
      .sort(),
  }
}
