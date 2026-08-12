import { serializeTerritorialFactualContract } from './contractSerializer'
import { SHADOW_FACTUAL_SYSTEM_PROMPT } from './shadowSystemPrompt'
import type { TerritorialFactualContract } from '@/domain/parcel-context/factualContract'
import type OpenAI from 'openai'

export interface ShadowEvaluationOptions {
  client: OpenAI
  model?: string
  temperature?: number
}

export async function runTerritorialFactualShadowEvaluation(
  question: string,
  contract: TerritorialFactualContract,
  options: ShadowEvaluationOptions
): Promise<string> {
  const jsonContract = serializeTerritorialFactualContract(contract)
  const systemMessage = `${SHADOW_FACTUAL_SYSTEM_PROMPT}\n\nCONTRATO FACTUAL:\n${jsonContract}`

  const completion = await options.client.chat.completions.create({
    model: options.model ?? 'deepseek-v4-flash', // Fallback to current model if not strictly specified
    messages: [
      { role: 'system', content: systemMessage },
      { role: 'user', content: question }
    ],
    temperature: options.temperature ?? 0.0, // Using 0.0 for predictability in factual extraction
  })

  return completion.choices[0]?.message?.content ?? ''
}
