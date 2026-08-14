import { serializeTerritorialFactualContract } from './contractSerializer'
import { SHADOW_FACTUAL_SYSTEM_PROMPT } from './shadowSystemPrompt'
import type { TerritorialFactualContract } from '@/domain/parcel-context/factualContract'
import type OpenAI from 'openai'

export interface ShadowEvaluationOptions {
  client: OpenAI
  model?: string
  temperature?: number
  onDiagnostics?: (diagnostics: ShadowEvaluationDiagnostics) => void
}

export interface ShadowEvaluationDiagnostics {
  payloadMs: number
  providerStartedAt: number
  providerFinishedAt: number
  providerMs: number
  payloadChars: number
  inputTokens?: number
  outputTokens?: number
}

export async function runTerritorialFactualShadowEvaluation(
  question: string,
  contract: TerritorialFactualContract,
  options: ShadowEvaluationOptions
): Promise<string> {
  const payloadStartedAt = performance.now()
  const jsonContract = serializeTerritorialFactualContract(contract)
  const systemMessage = `${SHADOW_FACTUAL_SYSTEM_PROMPT}\n\nCONTRATO FACTUAL:\n${jsonContract}`
  const payloadMs = performance.now() - payloadStartedAt
  const payloadChars = systemMessage.length + question.length
  const providerStartedAt = performance.now()

  try {
    const completion = await options.client.chat.completions.create({
      model: options.model ?? 'deepseek-v4-flash', // Fallback to current model if not strictly specified
      messages: [
        { role: 'system', content: systemMessage },
        { role: 'user', content: question }
      ],
      temperature: options.temperature ?? 0.0,
      response_format: { type: 'json_object' }
    })

    const providerFinishedAt = performance.now()
    options.onDiagnostics?.({
      payloadMs,
      providerStartedAt,
      providerFinishedAt,
      providerMs: providerFinishedAt - providerStartedAt,
      payloadChars,
      inputTokens: completion.usage?.prompt_tokens,
      outputTokens: completion.usage?.completion_tokens,
    })

    return completion.choices[0]?.message?.content ?? ''
  } catch (error) {
    const providerFinishedAt = performance.now()
    options.onDiagnostics?.({
      payloadMs,
      providerStartedAt,
      providerFinishedAt,
      providerMs: providerFinishedAt - providerStartedAt,
      payloadChars,
    })
    throw error
  }
}
