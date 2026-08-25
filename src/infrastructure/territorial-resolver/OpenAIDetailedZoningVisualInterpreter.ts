import OpenAI from 'openai'
import type { 
  DetailedZoningVisualInterpreter, 
  DetailedZoningVisualObservation,
  InstrumentZoningCatalog
} from './SiotugaDetailedZoningEvidenceProvider'

export class OpenAIDetailedZoningVisualInterpreter implements DetailedZoningVisualInterpreter {
  private readonly client: OpenAI
  private readonly model: string

  constructor(options: { client?: OpenAI; model?: string } = {}) {
    this.client = options.client ?? new OpenAI({ apiKey: process.env.OPENAI_API_KEY ?? '' })
    this.model = options.model ?? process.env.URBANBRAIN_DETAILED_ZONING_VISION_MODEL ?? 'gpt-5.6-luna'
  }

  async extractCatalog(input: {
    legendImage: Uint8Array
    instrumentId: string
  }): Promise<InstrumentZoningCatalog | null> {
    const imageData = Buffer.from(input.legendImage).toString('base64')
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
    sourceUrl: string
    instrumentId: string
  }): Promise<DetailedZoningVisualObservation[]> {
    const imageData = Buffer.from(input.image).toString('base64')
    const legendData = input.legendImage ? Buffer.from(input.legendImage).toString('base64') : undefined
    
    let instruction = `Analiza exclusivamente estos planos oficiales del instrumento ${input.instrumentId}. La parcela está marcada con un contorno grueso y relleno semitransparente.`
    if (input.catalog?.identities.length) {
      const catalogStr = input.catalog.identities.map((i: { code: string; label: string }) => `${i.code}: ${i.label}`).join('; ')
      instruction += ` Identifica únicamente cuáles de las identidades oficiales suministradas intersectan la parcela marcada. No inventes códigos. Catálogo oficial: [${catalogStr}].`
    } else {
      instruction += ` Identifica únicamente la etiqueta, código u ordenanza del recinto gráfico que contiene o intersecta la parcela marcada.`
    }
    instruction += ` Si no puedes distinguirlo con suficiente claridad, devuelve un array vacío o unresolved. Devuelve todas las zonas que intersectan la parcela.`

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
                    observedSymbols: { type: 'array', items: { type: 'string' } },
                    observedBoundaries: { type: 'array', items: { type: 'string' } },
                    parcelRelation: { type: 'string', enum: ['contains', 'intersects', 'ambiguous', 'unknown'] },
                    competingLabels: { type: 'array', items: { type: 'string' } },
                    confidence: { type: 'string', enum: ['high', 'medium', 'low'] },
                  },
                  required: ['observedLabel', 'observedSymbols', 'observedBoundaries', 'parcelRelation', 'competingLabels', 'confidence'],
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
    
    const text = response.output_text
    console.log("VLM raw response:", text)
    if (!text) return []
    try {
      const parsed = JSON.parse(text)
      if (parsed.status === 'unresolved' || parsed.status === 'ambiguous') {
        return []
      }
      return parsed.zones.filter((z: DetailedZoningVisualObservation) => z.observedLabel !== null)
    } catch {
      return []
    }
  }
}
