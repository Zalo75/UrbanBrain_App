import OpenAI from 'openai'
import { randomUUID } from 'node:crypto'
import { assertRuntimeBudgetAvailable, recordLLMUsage, recordRuntimeCall } from '@/application/runtime/runtimeAccounting'
import type { 
  DetailedZoningVisualInterpreter, 
  DetailedZoningVisualContext,
  DetailedZoningVisualInterpretation,
  DetailedZoningVisualObservation,
  InstrumentZoningCatalog
} from './SiotugaDetailedZoningEvidenceProvider'

export class OpenAIDetailedZoningVisualInterpreter implements DetailedZoningVisualInterpreter {
  private readonly client: OpenAI
  private readonly model: string

  constructor(options: { client?: OpenAI; model?: string } = {}) {
    this.client = options.client ?? new OpenAI({ apiKey: process.env.OPENAI_API_KEY ?? '', dangerouslyAllowBrowser: true })
    this.model = options.model ?? process.env.URBANBRAIN_DETAILED_ZONING_VISION_MODEL ?? 'gpt-5.6-luna'
  }

  private recordUsage(response: OpenAI.Responses.Response, operationId: string, stage: string) {
    const usage = response.usage as unknown as {
      input_tokens?: number
      output_tokens?: number
      total_tokens?: number
      input_tokens_details?: { cached_tokens?: number }
      output_tokens_details?: { reasoning_tokens?: number }
    } | undefined
    recordRuntimeCall({
      requestId: randomUUID(),
      provider: 'openai',
      model: this.model,
      callType: 'vision',
      inputTokens: usage?.input_tokens,
      outputTokens: usage?.output_tokens,
      totalTokens: usage?.total_tokens,
      cachedTokens: usage?.input_tokens_details?.cached_tokens,
      reasoningTokens: usage?.output_tokens_details?.reasoning_tokens,
    })
    recordLLMUsage({ operationType: 'expediente_generation', operationId, requestId: null, expedienteId: null, stage, inferenceIndex: 1, provider: 'openai', model: this.model, inputTokens: usage?.input_tokens ?? null, cachedInputTokens: usage?.input_tokens_details?.cached_tokens ?? null, outputTokens: usage?.output_tokens ?? null, reasoningTokens: usage?.output_tokens_details?.reasoning_tokens ?? null, totalTokens: usage?.total_tokens ?? null, durationMs: null, toolCallsRequested: 0, finishReason: null })
  }

  async extractCatalog(input: {
    legendImage: Uint8Array
    instrumentId: string
  }): Promise<InstrumentZoningCatalog | null> {
    const imageData = Buffer.from(input.legendImage).toString('base64')
    assertRuntimeBudgetAvailable('openai')
    const response = await this.client.responses.create({
      model: this.model,
      input: [{
        role: 'user',
        content: [
          {
            type: 'input_text',
            text: `Extrae todas las identidades (códigos y etiquetas de ordenanza, calificación o zona) de esta leyenda oficial del instrumento ${input.instrumentId}. No inventes identidades. Devuelve una lista estricta.`,
          },
          { type: 'input_image', image_url: `data:image/png;base64,${imageData}`, detail: 'high' as const },
        ],
      }],
      text: {
        format: {
          type: 'json_schema',
          name: 'InstrumentZoningCatalog',
          strict: true,
          schema: {
            type: 'object',
            properties: {
              identities: {
                type: 'array',
                items: {
                  type: 'object',
                  properties: {
                    code: { type: 'string' },
                    label: { type: 'string' },
                    aliases: { type: 'array', items: { type: 'string' } },
                  },
                  required: ['code', 'label', 'aliases'],
                  additionalProperties: false,
                }
              }
            },
            required: ['identities'],
            additionalProperties: false,
          },
        },
      },
    })
    this.recordUsage(response, `expediente-generation:${input.instrumentId}`, 'detailed-zoning-catalog')
    const text = response.output_text
    if (!text) return null
    try {
      const parsed = JSON.parse(text)
      return {
        instrumentId: input.instrumentId,
        identities: parsed.identities.map((id: { code: string; label: string; aliases: string[] }) => ({
          ...id,
          evidence: 'Extraído de la leyenda oficial WMS',
        }))
      }
    } catch {
      return null
    }
  }

  async inspect(input: {
    image: Uint8Array
    legendImage?: Uint8Array
    catalog?: InstrumentZoningCatalog
    context?: DetailedZoningVisualContext
    sourceUrl: string
    instrumentId: string
  }): Promise<DetailedZoningVisualInterpretation> {
    const imageData = Buffer.from(input.image).toString('base64')
    const legendData = input.legendImage ? Buffer.from(input.legendImage).toString('base64') : undefined
    
    const catalogText = input.catalog?.identities.length
      ? JSON.stringify(input.catalog.identities.map((identity) => ({
          identityId: identity.identityId,
          code: identity.code,
          label: identity.label,
          aliases: identity.aliases ?? [],
          semanticDimension: identity.semanticDimension,
          status: identity.status,
          normativeReferences: identity.normativeReferences ?? [],
          evidence: identity.evidence,
        })))
      : '[]'
    const contextText = JSON.stringify({
      municipalityCode: input.context?.municipalityCode,
      classification: input.context?.classification,
      category: input.context?.category,
      knownIdentities: input.context?.knownIdentities ?? [],
      evidence: input.context?.evidence ?? [],
    })
    const instruction = `Examina el PORD oficial del instrumento ${input.instrumentId}. La parcela está marcada con un contorno grueso y relleno semitransparente; usa esa marca como referencia espacial y observa su interior, los límites que la atraviesan y el contexto inmediato alrededor.

Observa libremente toda evidencia que pueda relacionar la parcela con una o varias identidades del catálogo del mismo instrumento: textos, números, códigos, etiquetas, rótulos, colores, tramas, patrones, símbolos, límites, recintos, líneas y su relación espacial con la parcela. No presupongas qué tipo de evidencia será útil ni dependas únicamente de colores, tramas o de la leyenda. Si existe una numeración o texto legible asociado a la zona, considéralo explícitamente.

Primero describe lo que observas directamente y después, solo cuando esté sustentado, relaciónalo con una identidad del catálogo. Distingue observación visual de interpretación normativa. No inventes identidades y no atribuyas al catálogo de otro instrumento. Una observación puede conservarse sin identidad canónica. Devuelve todas las zonas o grafismos relevantes si la parcela está atravesada por varios ámbitos. Si hay varias identidades plausibles, conserva las alternativas y explica la ambigüedad. No conviertas automáticamente clasificación, categoría, protección o sistema en ordenanza.

Contexto conocido: ${contextText}
Catálogo canónico del mismo instrumento: ${catalogText}`

    assertRuntimeBudgetAvailable('openai')
    const response = await this.client.responses.create({
      model: this.model,
      input: [{
        role: 'user',
        content: [
          { type: 'input_text', text: instruction },
          { type: 'input_image', image_url: `data:image/png;base64,${imageData}`, detail: 'high' as const },
          ...(legendData ? [{ type: 'input_image' as const, image_url: `data:image/png;base64,${legendData}`, detail: 'high' as const }] : []),
        ],
      }],
      text: {
        format: {
          type: 'json_schema',
          name: 'DetailedZoningVisualObservationList',
          strict: true,
          schema: {
            type: 'object',
            properties: {
              status: { type: 'string', enum: ['resolved', 'multizone', 'ambiguous', 'unresolved'] },
              zones: {
                type: 'array',
                items: {
                  type: 'object',
                  properties: {
                    observedLabel: { type: ['string', 'null'] },
                    observedText: { type: ['string', 'null'] },
                    observedCode: { type: ['string', 'null'] },
                    observedNumber: { type: ['string', 'null'] },
                    observedSymbols: { type: 'array', items: { type: 'string' } },
                    observedColors: { type: 'array', items: { type: 'string' } },
                    observedPatterns: { type: 'array', items: { type: 'string' } },
                    observedBoundaries: { type: 'array', items: { type: 'string' } },
                    spatialRelation: { type: 'string', enum: ['contains', 'intersects', 'ambiguous', 'unknown'] },
                    parcelRelation: { type: 'string', enum: ['contains', 'intersects', 'ambiguous', 'unknown'] },
                    competingLabels: { type: 'array', items: { type: 'string' } },
                    description: { type: 'string' },
                    confidence: { type: 'string', enum: ['high', 'medium', 'low'] },
                    semanticDimension: { type: 'string', enum: ['classification', 'category', 'qualification', 'zoning', 'ordinance', 'degree', 'area', 'affect', 'protection', 'unknown'] },
                  },
                  required: ['observedLabel', 'observedText', 'observedCode', 'observedNumber', 'observedSymbols', 'observedColors', 'observedPatterns', 'observedBoundaries', 'spatialRelation', 'parcelRelation', 'competingLabels', 'description', 'confidence', 'semanticDimension'],
                  additionalProperties: false,
                }
              },
              explanation: { type: 'string' }
            },
            required: ['status', 'zones', 'explanation'],
            additionalProperties: false,
          },
        },
      },
    })
    this.recordUsage(response, `expediente-generation:${input.instrumentId}`, 'detailed-zoning-inspection')
    
    const text = response.output_text
    console.log("VLM raw response:", text)
    if (!text) return { resolutionState: 'unresolved', observations: [] }
    try {
      const parsed = JSON.parse(text)
      return {
        resolutionState: parsed.status,
        observations: (parsed.zones ?? []).map((zone: DetailedZoningVisualObservation) => ({
          ...zone,
          observedText: zone.observedText ?? zone.observedLabel ?? null,
          spatialRelation: zone.spatialRelation ?? zone.parcelRelation ?? 'unknown',
        })),
        explanation: parsed.explanation,
      }
    } catch {
      return { resolutionState: 'unresolved', observations: [] }
    }
  }
}
