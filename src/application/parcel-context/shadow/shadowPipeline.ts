import { buildTerritorialFactualContract } from '../buildFactualContract'
import { runTerritorialFactualShadowEvaluation } from './shadowEvaluator'
import { validateStructuredFactualOutput } from './factualValidator'
import { renderFactualOutput } from './factualRenderer'
import type { NormalizedParcelContext } from '@/domain/parcel-context/types'
import type { TerritorialFactualContract } from '@/domain/parcel-context/factualContract'
import type { StructuredFactualOutput } from './structuredFactualOutput'
import type { ValidationResult } from './factualValidator'
import type OpenAI from 'openai'

export interface TerritorialShadowResult {
  status: 'valid' | 'validation_failed' | 'render_failed' | 'llm_failed'
  structuredOutput?: StructuredFactualOutput
  validation?: ValidationResult
  renderedText?: string[]
  diagnostics: {
    latencyMs: number
    model: string
    rawLlmResponse?: string
    error?: string
  }
}

export async function runTerritorialFactualShadowPipeline(
  question: string,
  input: NormalizedParcelContext | TerritorialFactualContract,
  client: OpenAI,
  model = 'deepseek-v4-flash'
): Promise<TerritorialShadowResult> {
  const start = Date.now()
  const contract = 'identity' in input && ('classification' in input || 'factsByScope' in input)
    ? (input as TerritorialFactualContract)
    : buildTerritorialFactualContract(input as NormalizedParcelContext)

  let rawLlmResponse = ''
  try {
    rawLlmResponse = await runTerritorialFactualShadowEvaluation(question, contract, { client, model, temperature: 0.0 })
    
    let structuredOutput: StructuredFactualOutput
    try {
      const jsonMatch = rawLlmResponse.match(/```(?:json)?\s*(\{[\s\S]*?\})\s*```/) || rawLlmResponse.match(/(\{[\s\S]*\})/);
      const jsonStr = jsonMatch ? jsonMatch[1] : rawLlmResponse
      structuredOutput = JSON.parse(jsonStr)
      if (!structuredOutput.operations || !structuredOutput.abstentions) {
        throw new Error('Invalid JSON structure: missing operations or abstentions array')
      }
    } catch (e: any) {
      return {
        status: 'llm_failed',
        diagnostics: { latencyMs: Date.now() - start, model, rawLlmResponse, error: `JSON Parse error: ${e.message}` }
      }
    }

    const validation = validateStructuredFactualOutput(structuredOutput, contract)
    if (!validation.valid) {
      return {
        status: 'validation_failed',
        structuredOutput,
        validation,
        diagnostics: { latencyMs: Date.now() - start, model, rawLlmResponse, error: 'Validation rejected output' }
      }
    }

    let renderedText: string[] = []
    try {
      renderedText = renderFactualOutput(structuredOutput, contract)
    } catch (e: any) {
      return {
        status: 'render_failed',
        structuredOutput,
        validation,
        diagnostics: { latencyMs: Date.now() - start, model, rawLlmResponse, error: `Render fail-safe triggered: ${e.message}` }
      }
    }

    return {
      status: 'valid',
      structuredOutput,
      validation,
      renderedText,
      diagnostics: { latencyMs: Date.now() - start, model, rawLlmResponse }
    }
  } catch (e: any) {
    return {
      status: 'llm_failed',
      diagnostics: { latencyMs: Date.now() - start, model, rawLlmResponse, error: `Pipeline exception: ${e.message}` }
    }
  }
}
