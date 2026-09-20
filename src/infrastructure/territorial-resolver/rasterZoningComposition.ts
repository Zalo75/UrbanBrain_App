import type {
  DetailedZoningResolution,
  DetailedRasterZoningInput,
  DetailedRasterZoningPorts,
} from '@/application/territorial-resolver/detailedRasterZoningEngine'
import {
  DetailedRasterZoningEngine,
  DetailedRasterZoningStrategyAdapter,
} from '@/application/territorial-resolver/detailedRasterZoningEngine'
import type {
  DetailedZoningStrategy,
  DetailedZoningStrategyContext,
} from '@/application/territorial-resolver/ordinanceCandidateResolver'
import type { ParcelGeometry } from '@/domain/territorial-resolver/types'

export interface RasterPortFactoryContext {
  strategyContext: DetailedZoningStrategyContext
  input: DetailedRasterZoningInput
}

/**
 * Composition root for the raster fallback. Production callers must provide
 * all six official/evidence ports; there is intentionally no guessed default.
 */
export interface DetailedRasterPortFactory {
  create(context: RasterPortFactoryContext): DetailedRasterZoningPorts | null
}

export function createDetailedRasterZoningStrategy(
  factory: DetailedRasterPortFactory,
  options?: ConstructorParameters<typeof DetailedRasterZoningEngine>[1],
): DetailedZoningStrategy {
  let lastHasEligibility: DetailedZoningResolution['hasEligibility']

  return {
    id: 'detailed-raster-zoning-v1',
    async resolve(context) {
      lastHasEligibility = undefined
      const municipalityCode = context.municipalityCode
      const geometry = context.geometry as ParcelGeometry | undefined
      const instrumentId = context.planning.applicableInstruments?.find((item) => item.status === 'current')?.id
      if (!municipalityCode || !geometry || !instrumentId) return []
      const input: DetailedRasterZoningInput = {
        municipalityCode,
        instrumentId,
        parcelGeometry: geometry,
        superiorClassification: context.planning.classification
          ? { classificationCode: context.planning.classification.code, categoryCode: context.planning.classification.categoryCode }
          : undefined,
      }
      const ports = factory.create({ strategyContext: context, input })
      if (!ports) return []
      const adapter = new DetailedRasterZoningStrategyAdapter(
        new DetailedRasterZoningEngine(ports, options),
        () => geometry,
        () => ({ instrumentId, superiorClassification: input.superiorClassification }),
      )
      const observations = await adapter.resolve(context)
      lastHasEligibility = adapter.getHasEligibilitySignal()
      return observations
    },
    getHasEligibilitySignal: () => lastHasEligibility,
  }
}

