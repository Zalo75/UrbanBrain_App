import type OpenAI from 'openai'
import type { TerritorialFactualContract } from '@/domain/parcel-context/factualContract'
import type { StructuredFactualOutput } from './structuredFactualOutput'
import { buildFactualComposerEvidence } from './factualComposerEvidence'
import { renderFactualComposerPlan } from './factualComposerRenderer'
import { parseFactualComposerPlanDetailed, validateFactualComposerPlan } from './factualComposerSafety'
import type {
  FactualComposerDiagnostics,
  FactualComposerFallbackReason,
  FactualComposerResult,
} from './factualComposerTypes'

const DEFAULT_COMPOSER_MODEL = 'deepseek-v4-flash'
const DEFAULT_COMPOSER_TIMEOUT_MS = 2_800
const COMPOSER_MAX_TOKENS = 320

const FACTUAL_COMPOSER_SYSTEM_PROMPT = `Eres el Composer factual de UrbanBrain.
Recibes exclusivamente hechos territoriales ya validados y devuelves un plan JSON, nunca prosa ni Markdown.
Usa solo factId y enums presentes. No escribas categorías, códigos, porcentajes, causas, normativa ni consecuencias.
Schema permitido:
{"schemaVersion":"1","conclusion":{"kind":"not_strictly_homogeneous|strictly_homogeneous|category_distribution|category_identity|classification_identity|state_summary","targetFactId":"opcional"},"explanation":[{"kind":"fact_identity|category_share|territorial_coverage|geometric_dominance","factId":"..."}],"caveats":[{"kind":"conflict|unresolved|manual_review_required|manual_determination|automatic_status|automatic_determination","factId":"..."}],"recommendedChecks":["verify_minority_area|confirm_pending_determination"]}
schemaVersion y conclusion son obligatorios. explanation, caveats y recommendedChecks pueden omitirse solo cuando estarían vacíos; si contienen elementos, inclúyelos.
Reglas:
- strict_homogeneity: incluye todas las categorías con category_share, dominance si existe y targetFactId; si hay varias categorías positivas o el target no llega a 100, usa not_strictly_homogeneous.
- category_distribution: incluye todas las categorías con category_share y dominance si existe.
- Si una categoría no tiene percentage pero sí coverage, usa territorial_coverage. Solo coverage full permite strictly_homogeneous; partial o unknown nunca equivalen al 100 %.
- category_identity: incluye classification y categories con fact_identity.
- classification_identity: incluye solo classification con fact_identity.
- manual_review_required + manual: incluye ambos caveats; el renderer los sintetiza en una sola frase.
- automatic_* + automatic: incluye automatic_status + automatic_determination; el renderer conserva si está confirmado o pendiente sin duplicar.
- conserva conflict, unresolved y los estados de revisión/determinación como caveats, una vez por significado.
- verify_minority_area solo con varias categorías positivas; confirm_pending_determination solo con estado pendiente.
- no omitas hechos materiales y no añadas propiedades.`

export function isFactualComposerEnabled(
  value = process.env.URBANBRAIN_FACTUAL_COMPOSER_ENABLED
) {
  return value === 'true'
}

export function factualComposerModel(
  value = process.env.URBANBRAIN_FACTUAL_COMPOSER_MODEL
) {
  return value?.trim() || DEFAULT_COMPOSER_MODEL
}

interface ComposeValidatedFactualAnswerOptions {
  question: string
  contract: TerritorialFactualContract
  output: StructuredFactualOutput
  fallbackAnswer: string
  client: OpenAI
  model?: string
  signal?: AbortSignal
  timeoutMs?: number
}

function fallback(
  fallbackAnswer: string,
  startedAt: number,
  model: string,
  reason: FactualComposerFallbackReason,
  providerMs = 0,
  usage?: { inputTokens?: number; outputTokens?: number },
  details?: Partial<FactualComposerDiagnostics>
): FactualComposerResult {
  return {
    answer: fallbackAnswer,
    diagnostics: {
      totalMs: Math.round(performance.now() - startedAt),
      providerMs: Math.round(providerMs),
      inputTokens: usage?.inputTokens,
      outputTokens: usage?.outputTokens,
      status: 'fallback',
      fallbackUsed: true,
      fallbackReason: reason,
      model,
      ...details,
    },
  }
}

export async function composeValidatedFactualAnswer(
  options: ComposeValidatedFactualAnswerOptions
): Promise<FactualComposerResult> {
  const startedAt = performance.now()
  const model = options.model ?? factualComposerModel()
  const evidence = buildFactualComposerEvidence(options.question, options.contract, options.output)
  if (!evidence) {
    return fallback(options.fallbackAnswer, startedAt, model, 'evidence_invalid')
  }

  const controller = new AbortController()
  let timedOut = false
  const abortFromParent = () => controller.abort(options.signal?.reason)
  if (options.signal?.aborted) abortFromParent()
  else options.signal?.addEventListener('abort', abortFromParent, { once: true })
  const timeoutMs = options.timeoutMs ?? DEFAULT_COMPOSER_TIMEOUT_MS
  const timeoutId = setTimeout(() => {
    timedOut = true
    controller.abort(new DOMException('Composer timeout', 'TimeoutError'))
  }, timeoutMs)

  let providerMs = 0
  let usage: { inputTokens?: number; outputTokens?: number } | undefined
  try {
    const providerStartedAt = performance.now()
    const request = {
      model,
      messages: [
        { role: 'system' as const, content: FACTUAL_COMPOSER_SYSTEM_PROMPT },
        { role: 'user' as const, content: JSON.stringify(evidence) },
      ],
      temperature: 0,
      response_format: { type: 'json_object' as const },
      thinking: { type: 'disabled' as const },
      max_tokens: COMPOSER_MAX_TOKENS,
    } satisfies Parameters<typeof options.client.chat.completions.create>[0] & {
      thinking: { type: 'disabled' }
    }
    const completion = await options.client.chat.completions.create(request, {
      signal: controller.signal,
      timeout: timeoutMs,
    })
    providerMs = performance.now() - providerStartedAt
    usage = {
      inputTokens: completion.usage?.prompt_tokens,
      outputTokens: completion.usage?.completion_tokens,
    }
    const content = completion.choices[0]?.message?.content
    if (!content?.trim()) {
      return fallback(options.fallbackAnswer, startedAt, model, 'render_empty', providerMs, usage)
    }

    let parsed: unknown
    try {
      parsed = JSON.parse(content)
    } catch {
      return fallback(options.fallbackAnswer, startedAt, model, 'invalid_json', providerMs, usage)
    }
    const parseResult = parseFactualComposerPlanDetailed(parsed)
    if (!parseResult.success) {
      const schemaErrorCodes = [...new Set(parseResult.errors.map((error) => error.code))]
      const schemaErrorPaths = [...new Set(parseResult.errors.map((error) => error.path))]
      const schemaErrorValueTypes = [...new Set(parseResult.errors
        .filter((error) => error.valueType)
        .map((error) => `${error.path}:${error.valueType}`))]
      const schemaInvalidEnums = [...new Set(parseResult.errors
        .map((error) => error.invalidEnum)
        .filter((value): value is string => Boolean(value)))]
      return fallback(options.fallbackAnswer, startedAt, model, 'invalid_schema', providerMs, usage, {
        schemaErrorCount: parseResult.errors.length,
        schemaErrorCodes,
        schemaErrorPaths,
        schemaErrorValueTypes,
        schemaInvalidEnums,
      })
    }
    const plan = parseResult.plan
    const safety = validateFactualComposerPlan(plan, evidence)
    if (!safety.safe) {
      return fallback(options.fallbackAnswer, startedAt, model, 'safety_rejected', providerMs, usage, {
        safetyErrorCodes: safety.reason ? [safety.reason] : [],
      })
    }
    const answer = renderFactualComposerPlan(plan, evidence)
    if (!answer.trim()) {
      return fallback(options.fallbackAnswer, startedAt, model, 'render_empty', providerMs, usage)
    }

    const diagnostics: FactualComposerDiagnostics = {
      totalMs: Math.round(performance.now() - startedAt),
      providerMs: Math.round(providerMs),
      inputTokens: usage.inputTokens,
      outputTokens: usage.outputTokens,
      status: 'composed',
      fallbackUsed: false,
      fallbackReason: null,
      model,
    }
    return { answer, diagnostics }
  } catch (error) {
    providerMs = providerMs || performance.now() - startedAt
    const abortLike = error instanceof Error && /abort|timeout/i.test(`${error.name} ${error.message}`)
    return fallback(
      options.fallbackAnswer,
      startedAt,
      model,
      timedOut || abortLike ? 'timeout' : 'provider_error',
      providerMs,
      usage
    )
  } finally {
    clearTimeout(timeoutId)
    options.signal?.removeEventListener('abort', abortFromParent)
  }
}
