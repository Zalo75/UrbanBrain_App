import { evaluateClassificationResolution } from '@/domain/territorial-resolver/classificationDecision'
import { withUrbanisticFacts } from '@/domain/territorial-resolver/urbanisticFacts'
import type {
  ClassificationSourcePort,
  OfficialSource,
  ParcelGeometry,
  PlanningApplicability,
  PlanningPort,
  TerritorialCoordinates,
} from '@/domain/territorial-resolver/types'

export interface RegisteredClassificationSource {
  id: string
  source: OfficialSource
  adapter: ClassificationSourcePort
  requiredForAutomaticDecision: boolean
}

export class MultiSourceClassificationResolver implements PlanningPort {
  constructor(
    private readonly planning: PlanningPort,
    private readonly sources: readonly RegisteredClassificationSource[],
    private readonly now: () => Date = () => new Date()
  ) {}

  async findApplicablePlanning(location: {
    municipalityCode?: string
    coordinates?: TerritorialCoordinates
    geometry?: ParcelGeometry
  }): Promise<PlanningApplicability> {
    const planning = await this.planning.findApplicablePlanning(location)
    const results = await Promise.allSettled(
      this.sources.map((source) => source.adapter.findClassifications(planning, location))
    )

    const candidates = results.flatMap((result) =>
      result.status === 'fulfilled' ? result.value.candidates : []
    )
    const discrepancies = results.flatMap((result) =>
      result.status === 'fulfilled' ? result.value.discrepancies : []
    )
    const sourceChecks = results.flatMap((result, index) =>
      result.status === 'fulfilled'
        ? result.value.sourceChecks
        : [
            {
              source: this.sources[index].source,
              status: 'unavailable' as const,
              checkedAt: this.now().toISOString(),
              message: `La fuente oficial ${this.sources[index].id} no está disponible.`,
              requiredForAutomaticDecision:
                this.sources[index].requiredForAutomaticDecision,
            },
          ]
    )
    const officialLinks = [
      ...new Map(
        results
          .flatMap((result) =>
            result.status === 'fulfilled' ? result.value.officialLinks : []
          )
          .map((link) => [`${link.kind}|${link.url}`, link])
      ).values(),
    ]
    const evidence = [
      ...new Map(
        [
          ...planning.evidence,
          ...results.flatMap((result) =>
            result.status === 'fulfilled' ? result.value.evidence : []
          ),
        ].map((item) => [
          `${item.source}|${item.sourceUrl}|${item.method}|${item.scope ?? ''}`,
          item,
        ])
      ).values(),
    ]
    const warnings = [
      ...new Map(
        results
          .flatMap((result) =>
            result.status === 'fulfilled' ? result.value.warnings : []
          )
          .map((item) => [`${item.code}|${item.message}`, item])
      ).values(),
    ]
    const classificationResolution = evaluateClassificationResolution({
      candidates,
      discrepancies,
      sourceChecks,
      officialLinks,
      evidence,
    })
    const selectedCandidate = classificationResolution.automaticSelection
      ? candidates.find(
          (candidate) => candidate.id === classificationResolution.automaticSelection?.candidateId
        )
      : undefined
    const areas = [
      ...new Map(
        candidates
          .flatMap((candidate) => candidate.areas)
          .map((area) => [`${area.type}|${area.name}`, area])
      ).values(),
    ]
    const mergedWarnings = [
      ...new Map(
        [...planning.warnings, ...warnings].map((item) => [`${item.code}|${item.message}`, item])
      ).values(),
    ]

    return withUrbanisticFacts({
      ...planning,
      classification: selectedCandidate?.classification,
      classificationResolution,
      areas: areas.length ? areas : planning.areas,
      evidence,
      sourceChecks: [...(planning.sourceChecks ?? []), ...sourceChecks],
      warnings: mergedWarnings,
    }, this.now().toISOString())
  }
}
