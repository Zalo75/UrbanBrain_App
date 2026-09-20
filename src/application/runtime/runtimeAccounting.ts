import fs from 'node:fs'
import path from 'node:path'
import pricing from '../../../config/runtime-pricing.json'
import budget from '../../../config/runtime-budget.json'
import { randomUUID } from 'node:crypto'

export type RuntimeCallType = 'reasoning' | 'embedding' | 'vision' | 'other'
export type LLMOperationType = 'expediente_generation' | 'chat_query'
export interface LLMOperationContext { operationType: LLMOperationType; operationId: string; requestId?: string | null; expedienteId?: string | null }
export function createExpedienteGenerationOperation(expedienteId?: string | null): LLMOperationContext {
  return { operationType: 'expediente_generation', operationId: randomUUID(), expedienteId: expedienteId ?? null, requestId: null }
}

export interface LLMUsageEvent {
  event: 'llm-usage'
  operationType: LLMOperationType
  operationId: string
  requestId: string | null
  expedienteId: string | null
  stage: string
  inferenceIndex: number
  provider: string
  model: string
  inputTokens: number | null
  cachedInputTokens: number | null
  outputTokens: number | null
  reasoningTokens: number | null
  totalTokens: number | null
  durationMs: number | null
  toolCallsRequested: number
  finishReason: string | null
  estimatedCostUsd: number | null
}

export interface RuntimeCallUsage {
  requestId: string
  timestamp: string
  provider: string
  model: string
  callType: RuntimeCallType
  inputTokens?: number
  outputTokens?: number
  totalTokens?: number
  cachedTokens?: number
  reasoningTokens?: number
  estimatedCostUsd: number | null
  pricingVersion: string | null
  pricingSource: string | null
  pricingBasis: string | null
  costStatus: 'estimated' | 'unknown'
  retryAttempt?: number
}

type Rate = {
  inputUsdPerMillion?: number
  cachedInputUsdPerMillion?: number
  outputUsdPerMillion?: number
  source?: string
  basis?: string
}

function getRate(provider: string, model: string): Rate | undefined {
  return (pricing.rates as Record<string, Rate>)[`${provider}:${model}`]
}

function llmUsagePath() { return path.join(process.cwd(), 'diagnose_out', 'ub-llm-usage.jsonl') }

export function recordLLMUsage(input: Omit<LLMUsageEvent, 'event' | 'estimatedCostUsd'> & { estimatedCostUsd?: number | null }) {
  const estimate = input.estimatedCostUsd === undefined
    ? estimateRuntimeCostUsd({ provider: input.provider, model: input.model, inputTokens: input.inputTokens ?? undefined, outputTokens: input.outputTokens ?? undefined, cachedTokens: input.cachedInputTokens ?? undefined })
    : { costUsd: input.estimatedCostUsd }
  const event: LLMUsageEvent = { ...input, event: 'llm-usage', estimatedCostUsd: estimate.costUsd }
  try { fs.mkdirSync(path.dirname(llmUsagePath()), { recursive: true }); fs.appendFileSync(llmUsagePath(), `${JSON.stringify(event)}\n`, 'utf8') } catch { /* telemetry never breaks requests */ }
  return event
}

export function summarizeLLMUsageEvents(events: LLMUsageEvent[], operationId: string) {
  const selected = events.filter((event) => event.operationId === operationId)
  const sum = (field: keyof LLMUsageEvent) => { const values = selected.map((event) => event[field]).filter((value): value is number => typeof value === 'number'); return values.length === selected.length && selected.length > 0 ? values.reduce((total, value) => total + value, 0) : null }
  const knownCosts = selected.map((event) => event.estimatedCostUsd).filter((value): value is number => value !== null)
  return { event: 'llm-operation-summary' as const, operationType: selected[0]?.operationType ?? null, operationId, requestId: selected[0]?.requestId ?? null, expedienteId: selected[0]?.expedienteId ?? null, inferenceCount: selected.length, toolCallCount: selected.reduce((total, event) => total + event.toolCallsRequested, 0), inputTokens: sum('inputTokens'), cachedInputTokens: sum('cachedInputTokens'), outputTokens: sum('outputTokens'), reasoningTokens: sum('reasoningTokens'), totalTokens: sum('totalTokens'), durationMs: null, estimatedCostUsd: knownCosts.length === selected.length && selected.length > 0 ? knownCosts.reduce((total, value) => total + value, 0) : null, breakdownByStage: [...new Set(selected.map((event) => event.stage))].map((stage) => { const items = selected.filter((event) => event.stage === stage); return { stage, inferenceCount: items.length, inputTokens: items.every((event) => event.inputTokens !== null) ? items.reduce((total, event) => total + (event.inputTokens ?? 0), 0) : null, cachedInputTokens: items.every((event) => event.cachedInputTokens !== null) ? items.reduce((total, event) => total + (event.cachedInputTokens ?? 0), 0) : null, outputTokens: items.every((event) => event.outputTokens !== null) ? items.reduce((total, event) => total + (event.outputTokens ?? 0), 0) : null, totalTokens: items.every((event) => event.totalTokens !== null) ? items.reduce((total, event) => total + (event.totalTokens ?? 0), 0) : null, estimatedCostUsd: items.every((event) => event.estimatedCostUsd !== null) ? items.reduce((total, event) => total + (event.estimatedCostUsd ?? 0), 0) : null } }) }
}

export function summarizeLLMOperation(operationId: string) {
  let events: LLMUsageEvent[] = []
  try { events = fs.existsSync(llmUsagePath()) ? fs.readFileSync(llmUsagePath(), 'utf8').split(/\r?\n/).filter(Boolean).flatMap((line) => { try { const value = JSON.parse(line) as LLMUsageEvent; return value.event === 'llm-usage' && value.operationId === operationId ? [value] : [] } catch { return [] } }) : [] } catch { events = [] }
  return summarizeLLMUsageEvents(events, operationId)
}

export function estimateRuntimeCostUsd(input: {
  provider: string
  model: string
  inputTokens?: number
  outputTokens?: number
  cachedTokens?: number
}): { costUsd: number | null; rate?: Rate } {
  const rate = getRate(input.provider, input.model)
  if (!rate) return { costUsd: null }
  if (input.inputTokens === undefined && input.outputTokens === undefined) return { costUsd: null, rate }
  const inputTokens = Math.max(0, input.inputTokens ?? 0)
  const cachedTokens = Math.min(inputTokens, Math.max(0, input.cachedTokens ?? 0))
  const uncachedTokens = inputTokens - cachedTokens
  const inputCost = rate.inputUsdPerMillion === undefined
    ? null
    : (uncachedTokens * rate.inputUsdPerMillion + cachedTokens * (rate.cachedInputUsdPerMillion ?? rate.inputUsdPerMillion)) / 1_000_000
  const outputCost = rate.outputUsdPerMillion === undefined
    ? null
    : ((input.outputTokens ?? 0) * rate.outputUsdPerMillion) / 1_000_000
  if (inputCost === null || outputCost === null) return { costUsd: null, rate }
  return { costUsd: inputCost + outputCost, rate }
}

export function recordRuntimeCall(call: Omit<RuntimeCallUsage, 'timestamp' | 'estimatedCostUsd' | 'pricingVersion' | 'pricingSource' | 'pricingBasis' | 'costStatus'> & { costUsd?: number | null }) {
  const estimate = call.costUsd === undefined
    ? estimateRuntimeCostUsd({
        provider: call.provider,
        model: call.model,
        inputTokens: call.inputTokens,
        outputTokens: call.outputTokens,
        cachedTokens: call.cachedTokens,
      })
    : { costUsd: call.costUsd, rate: getRate(call.provider, call.model) }
  const record: RuntimeCallUsage = {
    ...call,
    timestamp: new Date().toISOString(),
    estimatedCostUsd: estimate.costUsd,
    pricingVersion: estimate.rate ? pricing.version : null,
    pricingSource: estimate.rate?.source ?? null,
    pricingBasis: estimate.rate?.basis ?? null,
    costStatus: estimate.costUsd === null ? 'unknown' : 'estimated',
  }
  try {
    const outputPath = path.join(process.cwd(), 'diagnose_out', 'ub-runtime-calls.jsonl')
    fs.mkdirSync(path.dirname(outputPath), { recursive: true })
    fs.appendFileSync(outputPath, `${JSON.stringify(record)}\n`, 'utf8')
  } catch {
    // Runtime accounting must never break the product request.
  }
  return record
}

export function summarizeRuntimeCalls(requestId?: string) {
  const outputPath = path.join(process.cwd(), 'diagnose_out', 'ub-runtime-calls.jsonl')
  if (!fs.existsSync(outputPath)) return { requestId: requestId ?? null, calls: 0, estimatedCostUsd: null, unknownCostCalls: 0 }
  const records = fs.readFileSync(outputPath, 'utf8').split(/\r?\n/).filter(Boolean).map((line) => JSON.parse(line) as RuntimeCallUsage)
  const selected = requestId ? records.filter((record) => record.requestId === requestId) : records
  const known = selected.map((record) => record.estimatedCostUsd).filter((value): value is number => value !== null)
  return {
    requestId: requestId ?? null,
    calls: selected.length,
    estimatedCostUsd: selected.length > 0 && selected.length === known.length ? known.reduce((sum, value) => sum + value, 0) : null,
    unknownCostCalls: selected.filter((record) => record.estimatedCostUsd === null).length,
  }
}

export function runtimeBudgetStatus(provider: string) {
  const summary = summarizeRuntimeCalls()
  const calls = readRuntimeCalls().filter((record) => record.provider === provider)
  const known = calls
    .map((record) => record.estimatedCostUsd)
    .filter((value): value is number => value !== null)
  const spentUsd = known.reduce((sum, value) => sum + value, 0)
  const conversion = budget.conversion.maxEurPerUsd
  const limitUsd = provider === 'openai' ? budget.openai.hardStopEur / conversion : null
  const softStopUsd = provider === 'openai' ? budget.openai.softStopEur / conversion : null
  return {
    provider,
    spentUsd,
    limitUsd,
    softStopUsd,
    spentEur: spentUsd * conversion,
    softStopEur: provider === 'openai' ? budget.openai.softStopEur : null,
    hardStopEur: provider === 'openai' ? budget.openai.hardStopEur : null,
    budgetCurrency: budget.humanCurrency,
    providerBillingCurrency: budget.providerBillingCurrency,
    conversionMaxEurPerUsd: conversion,
    unknownCostCalls: calls.filter((record) => record.estimatedCostUsd === null).length,
    blocked: limitUsd !== null && spentUsd >= limitUsd,
    totalCalls: summary.calls,
  }
}

export function assertRuntimeBudgetAvailable(provider: string) {
  const status = runtimeBudgetStatus(provider)
  if (status.blocked) {
    const error = new Error(`Runtime budget exceeded for ${provider}`)
    error.name = 'RuntimeBudgetExceeded'
    throw error
  }
  return status
}

function readRuntimeCalls(): RuntimeCallUsage[] {
  const outputPath = path.join(process.cwd(), 'diagnose_out', 'ub-runtime-calls.jsonl')
  if (!fs.existsSync(outputPath)) return []
  return fs.readFileSync(outputPath, 'utf8')
    .split(/\r?\n/)
    .filter(Boolean)
    .flatMap((line) => {
      try { return [JSON.parse(line) as RuntimeCallUsage] } catch { return [] }
    })
}
