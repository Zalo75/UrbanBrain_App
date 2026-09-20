import type { DetailedZoningStrategy, DetailedZoningStrategyContext, DetailedZoningObservation } from '@/application/territorial-resolver/ordinanceCandidateResolver';
import type { ArcGisUniversalZoningAdapter } from './ArcGisUniversalZoningAdapter';
import type { ParcelGeometry, ZoningIdentity } from '@/domain/territorial-resolver/types';

export class ArcGisDetailedZoningStrategy implements DetailedZoningStrategy {
  readonly id = 'arcgis_structured_zoning';

  constructor(
    private readonly adapter: ArcGisUniversalZoningAdapter,
    private readonly urlExtractor?: (context: DetailedZoningStrategyContext) => Array<{ url: string }> | undefined
  ) {}

  async resolve(context: DetailedZoningStrategyContext): Promise<DetailedZoningObservation[]> {
    try {
      // --------------------------------------------------------------------------------------
      // [CONTRACT CHANGE DOCUMENTATION]
      // To properly supply the ArcGIS source naturally in the UrbanBrain pipeline,
      // the 'TerritorialResourceCatalog' in types.ts should be extended to support
      // `source: 'arcgis'` and an `arcGisFeatureServerUrl?: string`.
      // Once that is added, this extractor can default to context.planning.resources.arcGisFeatureServerUrl
      // --------------------------------------------------------------------------------------

      const arcGisSources = this.urlExtractor ? this.urlExtractor(context) : undefined;
      if (!arcGisSources || !Array.isArray(arcGisSources) || arcGisSources.length === 0) {
        return [];
      }

      const geometry = context.geometry as ParcelGeometry | undefined;
      if (!geometry || typeof geometry !== 'object' || geometry.type !== 'MultiPolygon') {
        return [];
      }

      // Try candidates one by one until we get valid identities
      let identities: ZoningIdentity[] = [];
      for (const source of arcGisSources) {
        if (!source || !source.url) continue;

        const result = await this.adapter.resolveZoning({
          parcelGeometry: geometry,
          serviceUrl: source.url
        });

        const resolvedResult = result.filter((identity) => {
          const attrs = identity.rawAttributes as Record<string, unknown> | undefined
          return Boolean(identity.code || identity.label) && attrs?._status !== 'unresolved'
        })
        if (resolvedResult.length > 0) {
          identities = resolvedResult;
          break; // Stop at first valid source
        }
      }

      if (identities.length === 0) {
        return [];
      }

      const instrumentId = context.planning.instrument || 'unknown_instrument';

      // Map our new ZoningIdentity[] into the existing DetailedZoningObservation[] contract
      const resolvedIdentities = identities.filter((identity) => {
        const attrs = identity.rawAttributes as Record<string, unknown> | undefined
        return Boolean(identity.code || identity.label) && attrs?._status !== 'unresolved'
      })

      return resolvedIdentities.map(identity => ({
        identity: identity.code || identity.label!,
        semanticDimension: identity.semanticDimension,
        instrumentId,
        sourceRef: identity.sourceUrl,
        spatialEvidence: 'ArcGIS Polygon Intersection',
        graphicEvidence: 'N/A (Structured Vector Data)',
        legendEvidence: 'N/A (Attribute Table)',
        documentaryEvidence: 'N/A (FeatureService API)',
        provenance: identity.evidence,
        // Confidence cast to the exact enum/union type safely
        confidence: (identity.confidence === 'high' ? 'high' :
                     identity.confidence === 'medium' ? 'medium' :
                     'low') as DetailedZoningObservation['confidence']
      }));
    } catch {
      // Absolute fail-safe: never crash the pipeline, let subsequent strategies try
      return [];
    }
  }
}
