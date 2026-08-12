import { runTerritorialFactualShadowPipeline } from './shadowPipeline'
import type { TerritorialFactualContract } from '@/domain/parcel-context/factualContract'
import OpenAI from 'openai'

// NOTE: This harness is designed for manual execution ONLY (opt-in).
// It should not be imported or run automatically in the standard test suite.
// Example usage:
// ts-node src/application/parcel-context/shadow/shadowHarness.ts

async function runGoldenEvaluations() {
  if (!process.env.DEEPSEEK_API_KEY) {
    console.warn('DEEPSEEK_API_KEY not found. Skipping real shadow evaluation.')
    return
  }

  const client = new OpenAI({
    baseURL: 'https://api.deepseek.com/v1',
    apiKey: process.env.DEEPSEEK_API_KEY
  })

  const sadaContract: TerritorialFactualContract = {
    identity: { municipalityName: 'Sada' },
    scopes: {},
    classification: { code: 'SNR', semanticCompleteness: 'complete', label: 'Suelo de núcleo rural', status: 'automatic_confirmed', determination: 'automatic', confidence: 'high', evidence: [], warnings: [], discrepancies: [], nextAction: 'none' },
    categories: [
      { code: 'SNRC', label: 'Núcleo rural común', semanticCompleteness: 'complete', parcelPercentage: 98.53, status: 'conflict', determination: 'unresolved' },
      { code: 'SNRT', label: 'Núcleo rural tradicional', semanticCompleteness: 'complete', parcelPercentage: 1.47, status: 'conflict', determination: 'unresolved' }
    ],
    consolidation: { status: 'unresolved', determination: 'unresolved', confidence: 'unknown', evidence: [], warnings: [], discrepancies: [], nextAction: 'none' },
    planningAreas: [],
    affects: { status: 'checked', items: [], confidence: 'unknown', evidence: [], warnings: [], discrepancies: [], nextAction: 'none' },
    normativeReferences: {}
  } as unknown as TerritorialFactualContract

  // Convert to full contract with factsByScope
  sadaContract.factsByScope = {
    parcel: {
      classification: sadaContract.classification,
      categories: sadaContract.categories,
      consolidation: sadaContract.consolidation,
      planningAreas: sadaContract.planningAreas,
      affects: sadaContract.affects
    }
  }

  const questions = [
    "¿Cuál es la clasificación?",
    "¿Qué categorías afectan a esta parcela?",
    "¿Cuál predomina?",
    "¿Qué es ese 1,47 %?",
    "¿Puedo considerar toda la parcela SNRC?",
    "¿Qué pasa con el trocito tradicional?",
    "Explícamelo como si fuese para mi cliente.",
  ]

  console.log('=== SHADOW EVALUATION HARNESS ===')

  for (const q of questions) {
    console.log(`\nQ: ${q}`)
    try {
      const start = Date.now()
      const result = await runTerritorialFactualShadowPipeline(q, sadaContract, client, 'deepseek-v4-flash')

      console.log(`LATENCY: ${result.diagnostics.latencyMs}ms`)
      console.log(`RAW STRUCTURED OUTPUT:\n`, JSON.stringify(result.structuredOutput, null, 2))
      console.log(`VALIDATION RESULT: ${result.status}`)

      if (result.status === 'valid') {
         console.log(`RENDERED SHADOW ANSWER:\n`, result.renderedText?.join('\n'))
      } else {
         console.log(`ERRORS:`, JSON.stringify(result.validation?.errors || result.diagnostics.error, null, 2))
      }
    } catch (e) {
      console.error(`Error processing question:`, e)
    }
  }
}

// To run this harness manually, execute the file directly.
if (require.main === module) {
  runGoldenEvaluations().catch(console.error)
}
