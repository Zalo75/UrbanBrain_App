import type { DetailedZoningStrategy } from '@/application/territorial-resolver/ordinanceCandidateResolver'
import { createDetailedRasterZoningStrategy } from './rasterZoningComposition'
import { createSiotugaRasterZoningPortFactory } from './siotugaRasterZoningPorts'
import { PreparedZoningStrategy } from './PreparedZoningStrategy'
import { LocalPreparedZoningRepository } from './LocalPreparedZoningRepository'
import { ArcGisDetailedZoningStrategy } from './ArcGisDetailedZoningStrategy'
import { ArcGisUniversalZoningAdapter } from './ArcGisUniversalZoningAdapter'
import { OpenAIDetailedZoningVisualInterpreter } from './OpenAIDetailedZoningVisualInterpreter'
import { SiotugaDetailedZoningEvidenceProvider } from './SiotugaDetailedZoningEvidenceProvider'
import { SiotugaDetailedZoningDocumentValidator } from './SiotugaDetailedZoningDocumentValidator'

/** Runtime wiring is enabled only when the already-configured provider key exists. */
export function defaultDetailedZoningStrategies(options: { rasterStrategy?: DetailedZoningStrategy } = {}): DetailedZoningStrategy[] {
  const strategies: DetailedZoningStrategy[] = []
  
  // 1. Prepared Zoning (Highest Priority)
  strategies.push(new PreparedZoningStrategy(new LocalPreparedZoningRepository()))

  // 1.5 ArcGIS Structured Zoning
  if (process.env['OPENAI_API_KEY']) {
    strategies.push(new ArcGisDetailedZoningStrategy(
      new ArcGisUniversalZoningAdapter(),
      (ctx) => (ctx.planning.resources as unknown as { arcGisSources?: Array<{ url: string }> } | undefined)?.arcGisSources
    ))
    // Run the existing marked-PORD + official-legend interpreter only after
    // structured/prepared resolution has failed. It remains a review
    // proposal: the common resolver never promotes visual evidence directly
    // to final authority.
    strategies.push(new SiotugaDetailedZoningEvidenceProvider({
      interpreter: new OpenAIDetailedZoningVisualInterpreter(),
      documentValidator: new SiotugaDetailedZoningDocumentValidator(),
    }))
  }

  // 2. Fallback Raster Strategies
  if (options.rasterStrategy) strategies.push(options.rasterStrategy)
  if (process.env.URBANBRAIN_DETAILED_RASTER_ENABLED === 'true' || process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY) {
    strategies.push(createDetailedRasterZoningStrategy(createSiotugaRasterZoningPortFactory()))
  }
  
  return strategies
}
