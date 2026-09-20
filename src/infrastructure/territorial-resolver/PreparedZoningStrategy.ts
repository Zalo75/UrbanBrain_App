import type {
  DetailedZoningObservation,
  DetailedZoningStrategy,
  DetailedZoningStrategyContext,
} from '@/application/territorial-resolver/ordinanceCandidateResolver'
import { intersectPreparedZoningLayer, type PreparedZoningLayer } from './preparedZoningLayer'

export interface PreparedZoningRepository {
  getLayer(municipalityCode: string, instrumentId: string): Promise<PreparedZoningLayer | null>
}

export class PreparedZoningStrategy implements DetailedZoningStrategy {
  id = 'PreparedZoning'

  constructor(private readonly repository: PreparedZoningRepository) {}

  async resolve(context: DetailedZoningStrategyContext): Promise<DetailedZoningObservation[]> {
    if (!context.geometry || !context.municipalityCode ) {
      return []
    }
    
    const currentInstrument = context.planning.applicableInstruments?.find(i => i.status === 'current')
    const instrumentId = currentInstrument?.id
    if (!instrumentId) return []

    const layer = await this.repository.getLayer(context.municipalityCode, instrumentId)
    if (!layer || layer.validationStatus !== 'VALIDATED') {
      return []
    }

    const geometry = context.geometry as { type?: string, coordinates?: number[][][][] }
    if (geometry.type !== 'MultiPolygon' || !geometry.coordinates) {
      return []
    }

    const intersections = intersectPreparedZoningLayer(layer, geometry.coordinates)
    
    console.log('Intersections found:', intersections); return intersections.map((intersection) => ({
      identity: intersection.ordinance,
      semanticDimension: 'ordinance',
      instrumentId: layer.instrumentId,
      sourceRef: layer.sourceSheet,
      sourceDocument: layer.sourceDocumentId,
      spatialEvidence: "Intersección validada sobre hoja " + layer.sourceSheet + ", cobertura " + intersection.coveragePercent.toFixed(1) + "%",
      graphicEvidence: intersection.legendEvidence,
      legendEvidence: intersection.legendEvidence,
      documentaryEvidence: intersection.documentaryEvidence,
      instrumentMembership: true,
      provenance: [...(layer.provenance ?? []), 'prepared_zoning:' + layer.sourceSheet],
      alignmentMethod: layer.georeferencingMethod,
      estimatedErrorMeters: layer.rmsMetres,
      warning: layer.automaticCriteriaWarning ??
        (layer.qualityFlags.length > 0 ? `La georreferenciación preparada conserva avisos: ${layer.qualityFlags.join(', ')}.` : undefined),
      coverage: {
        percentage: intersection.coveragePercent,
        method: 'prepared_zoning_intersection'
      },
      confidence: intersection.confidence,
    }))
  }
}



