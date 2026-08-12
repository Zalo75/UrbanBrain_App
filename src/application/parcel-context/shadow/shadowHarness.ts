import { runTerritorialFactualShadowEvaluation } from './shadowEvaluator'
import { validateShadowFactualResponse } from './shadowGuardrail'
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
    classification: { code: 'SNR', status: 'automatic_confirmed', determination: 'automatic' },
    categories: [
      { code: 'SNRC', parcelPercentage: 98.53, status: 'conflict', determination: 'unresolved' },
      { code: 'SNRT', parcelPercentage: 1.47, status: 'conflict', determination: 'unresolved' }
    ],
    consolidation: { status: 'unresolved', determination: 'unresolved' },
    planningAreas: [],
    affects: { status: 'checked', items: [] },
    normativeReferences: {}
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
      const answer = await runTerritorialFactualShadowEvaluation(q, sadaContract, { client, temperature: 0.1 })
      const latency = Date.now() - start
      console.log(`A: ${answer}`)
      console.log(`[Latency: ${latency}ms]`)

      const validation = validateShadowFactualResponse(answer, sadaContract)
      if (!validation.valid) {
        console.error(`GUARDRAIL FAIL:`, validation.reasons)
      } else {
        console.log(`GUARDRAIL PASS`)
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
