import { buildTerritorialFactualContract } from '../buildFactualContract'
import { runTerritorialFactualShadowEvaluation } from './shadowEvaluator'
import { validateStructuredFactualOutput } from './factualValidator'
import { renderFactualOutput } from './factualRenderer'
import { enforceFactualCoverage, type FactualCoverageDiagnostics } from './factualCoverage'
import type { NormalizedParcelContext } from '@/domain/parcel-context/types'
import type { TerritorialFactualContract } from '@/domain/parcel-context/factualContract'
import type { StructuredFactualOutput } from './structuredFactualOutput'
import type { ValidationErrorCode, ValidationResult } from './factualValidator'
import type OpenAI from 'openai'
import type { ShadowEvaluationDiagnostics } from './shadowEvaluator'

export interface TerritorialShadowPhaseTimings {
  contractMs: number
  payloadMs: number
  providerStartedAt?: number
  providerFinishedAt?: number
  providerMs: number
  parseMs: number
  validateMs: number
  renderMs: number
}

export interface TerritorialShadowMetrics {
  payloadChars?: number
  inputTokens?: number
  outputTokens?: number
  reasoningTokens?: number
  factCount: number
  candidateCount: number
  operationCount?: number
  abstentionCount?: number
  coverageRequiredCount?: number
  coverageSelectedCount?: number
  coverageAddedCount?: number
  coverageComplete?: boolean
  coverageReason?: string
  validationErrorCount?: number
  validationErrorCodes?: ValidationErrorCode[]
  validationErrorOperations?: SafeValidationOperation[]
}

export interface SafeValidationOperation {
  operation: StructuredFactualOutput['operations'][number]['operation']
  factRef: {
    type: StructuredFactualOutput['operations'][number]['factRef']['type']
    scope: StructuredFactualOutput['operations'][number]['factRef']['scope']
    code?: string
  }
}

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
    phases?: TerritorialShadowPhaseTimings
    metrics?: TerritorialShadowMetrics
  }
}

function countContractFacts(contract: TerritorialFactualContract) {
  const scopes = contract.factsByScope
    ? Object.values(contract.factsByScope).filter(Boolean)
    : [{
        classification: contract.classification,
        categories: contract.categories,
        consolidation: contract.consolidation,
        planningAreas: contract.planningAreas,
        affects: contract.affects,
      }]

  let factCount = 0
  let candidateCount = 0
  for (const scope of scopes) {
    if (!scope) continue
    if (scope.classification) {
      factCount += 1
      candidateCount += scope.classification.candidates?.length ?? 0
    }
    factCount += scope.categories?.length ?? 0
    candidateCount += scope.categories?.reduce(
      (total, category) => total + (category.candidates?.length ?? 0),
      0
    ) ?? 0
    if (scope.consolidation) factCount += 1
    factCount += scope.planningAreas?.length ?? 0
    if (scope.affects) {
      factCount += 1 + scope.affects.items.length
    }
  }
  return { factCount, candidateCount }
}

const SAFE_FACT_CODE = /^[A-Za-z0-9._/-]{1,64}$/

function safeValidationOperations(
  validation: ValidationResult
): SafeValidationOperation[] {
  const unique = new Map<string, SafeValidationOperation>()

  for (const error of validation.errors) {
    if (!error.operation || !error.factRef) continue
    const safeFactRef: SafeValidationOperation['factRef'] = {
      type: error.factRef.type,
      scope: error.factRef.scope,
    }
    if ('code' in error.factRef && SAFE_FACT_CODE.test(error.factRef.code)) {
      safeFactRef.code = error.factRef.code
    }
    const descriptor = { operation: error.operation, factRef: safeFactRef }
    unique.set(JSON.stringify(descriptor), descriptor)
  }

  return [...unique.values()]
}

export async function runTerritorialFactualShadowPipeline(
  question: string,
  input: NormalizedParcelContext | TerritorialFactualContract,
  client: OpenAI,
  model = 'deepseek-v4-flash'
): Promise<TerritorialShadowResult> {
  const start = performance.now()
  const contractStartedAt = performance.now()
  const contract = 'identity' in input && ('classification' in input || 'factsByScope' in input)
    ? (input as TerritorialFactualContract)
    : buildTerritorialFactualContract(input as NormalizedParcelContext)
  const contractMs = performance.now() - contractStartedAt
  const contractMetrics = countContractFacts(contract)
  let evaluationDiagnostics: ShadowEvaluationDiagnostics | undefined
  let parseMs = 0
  let validateMs = 0
  let renderMs = 0
  let operationCount: number | undefined
  let abstentionCount: number | undefined
  let coverageDiagnostics: FactualCoverageDiagnostics | undefined
  let validationDiagnostics: Pick<
    TerritorialShadowMetrics,
    'validationErrorCount' | 'validationErrorCodes' | 'validationErrorOperations'
  > | undefined
  let rawLlmResponse = ''

  const diagnostics = (error?: string) => ({
    latencyMs: Math.round(performance.now() - start),
    model,
    rawLlmResponse,
    error,
    phases: {
      contractMs,
      payloadMs: evaluationDiagnostics?.payloadMs ?? 0,
      providerStartedAt: evaluationDiagnostics?.providerStartedAt,
      providerFinishedAt: evaluationDiagnostics?.providerFinishedAt,
      providerMs: evaluationDiagnostics?.providerMs ?? 0,
      parseMs,
      validateMs,
      renderMs,
    },
    metrics: {
      ...contractMetrics,
      payloadChars: evaluationDiagnostics?.payloadChars,
      inputTokens: evaluationDiagnostics?.inputTokens,
      outputTokens: evaluationDiagnostics?.outputTokens,
      reasoningTokens: evaluationDiagnostics?.reasoningTokens,
      operationCount,
      abstentionCount,
      ...coverageDiagnostics,
      ...validationDiagnostics,
    },
  })

  try {
    rawLlmResponse = await runTerritorialFactualShadowEvaluation(question, contract, {
      client,
      model,
      temperature: 0.0,
      onDiagnostics: (value) => { evaluationDiagnostics = value },
    })

    let structuredOutput: StructuredFactualOutput
    const parseStartedAt = performance.now()
    try {
      const jsonMatch = rawLlmResponse.match(/```(?:json)?\s*(\{[\s\S]*?\})\s*```/) || rawLlmResponse.match(/(\{[\s\S]*\})/);
      const jsonStr = jsonMatch ? jsonMatch[1] : rawLlmResponse
      structuredOutput = JSON.parse(jsonStr)
      if (!structuredOutput.operations || !structuredOutput.abstentions) {
        throw new Error('Invalid JSON structure: missing operations or abstentions array')
      }
      operationCount = structuredOutput.operations.length
      abstentionCount = structuredOutput.abstentions.length
    } catch (e: any) {
      parseMs = performance.now() - parseStartedAt
      return {
        status: 'llm_failed',
        diagnostics: diagnostics(`JSON Parse error: ${e.message}`)
      }
    }
    parseMs = performance.now() - parseStartedAt

    const validateStartedAt = performance.now()
    let validation = validateStructuredFactualOutput(structuredOutput, contract)
    validateMs = performance.now() - validateStartedAt
    if (!validation.valid) {
      validationDiagnostics = {
        validationErrorCount: validation.errors.length,
        validationErrorCodes: [...new Set(validation.errors.map((error) => error.code))],
        validationErrorOperations: safeValidationOperations(validation),
      }
      return {
        status: 'validation_failed',
        structuredOutput,
        validation,
        diagnostics: diagnostics('Validation rejected output')
      }
    }

    const coverage = enforceFactualCoverage(question, contract, structuredOutput)
    structuredOutput = coverage.output
    coverageDiagnostics = coverage.diagnostics

    if (coverage.diagnostics.coverageAddedCount > 0) {
      const coverageValidationStartedAt = performance.now()
      validation = validateStructuredFactualOutput(structuredOutput, contract)
      validateMs += performance.now() - coverageValidationStartedAt
      if (!validation.valid) {
        validationDiagnostics = {
          validationErrorCount: validation.errors.length,
          validationErrorCodes: [...new Set(validation.errors.map((error) => error.code))],
          validationErrorOperations: safeValidationOperations(validation),
        }
        return {
          status: 'validation_failed',
          structuredOutput,
          validation,
          diagnostics: diagnostics('Coverage operations rejected by validation')
        }
      }
    }

    let renderedText: string[] = []
    const renderStartedAt = performance.now()
    try {
      renderedText = renderFactualOutput(structuredOutput, contract)
    } catch (e: any) {
      renderMs = performance.now() - renderStartedAt
      return {
        status: 'render_failed',
        structuredOutput,
        validation,
        diagnostics: diagnostics(`Render fail-safe triggered: ${e.message}`)
      }
    }
    renderMs = performance.now() - renderStartedAt

    return {
      status: 'valid',
      structuredOutput,
      validation,
      renderedText,
      diagnostics: diagnostics()
    }
  } catch (e: any) {
    return {
      status: 'llm_failed',
      diagnostics: diagnostics(`Pipeline exception: ${e.message}`)
    }
  }
}
