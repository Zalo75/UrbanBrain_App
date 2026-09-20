import OpenAI from 'openai';
import fs from 'fs';
import path from 'path';

export interface ReasonerImage { id: string; label: string; mediaType: 'image/png'; data: string }

export function openAIReasonerUserContent(request: ReasonerRequest) {
  if (!request.images?.length) return request.userPrompt
  return [
    { type: 'input_text' as const, text: request.userPrompt },
    ...request.images.flatMap(image => [
      { type: 'input_text' as const, text: `IMAGEN ${image.id}: ${image.label}` },
      { type: 'input_image' as const, image_url: `data:${image.mediaType};base64,${image.data}`, detail: 'high' as const },
    ]),
  ]
}

export interface ReasonerRequest {
  images?: ReasonerImage[]
  systemPrompt: string
  userPrompt: string
  signal?: AbortSignal
  timeoutMs?: number
  // Optional dynamic schema for structured outputs
  responseSchemaName?: string
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  responseSchema?: any
}

export interface ReasonerResult {
  rawContent: string
  provider: string
  model: string
  latencyMs: number
  inputTokens?: number
  outputTokens?: number
  totalTokens?: number
  cachedInputTokens?: number
  reasoningTokens?: number
}

export interface ReasonerProvider {
  readonly name: string
  generate(request: ReasonerRequest): Promise<ReasonerResult>
}

/** DeepSeek Chat Completions only supports generic JSON mode. Schema-bearing
 * requests must use its Responses API structured-output format. */
export function deepSeekResponseFormat(request: ReasonerRequest) {
  if (request.responseSchemaName && request.responseSchema) {
    return {
      type: 'json_schema' as const,
      name: request.responseSchemaName,
      schema: request.responseSchema,
    }
  }
  return { type: 'json_object' as const }
}

export class DeepSeekReasonerProvider implements ReasonerProvider {
  readonly name = 'deepseek';
  private openai: OpenAI;
  private responsesClient: OpenAI;
  private model = 'deepseek-v4-flash';

  constructor() {
    this.openai = new OpenAI({
      baseURL: 'https://api.deepseek.com/v1',
      apiKey: process.env.DEEPSEEK_API_KEY || ''
    });
    // DeepSeek's Responses API is served at /responses (without /v1).
    this.responsesClient = new OpenAI({
      baseURL: 'https://api.deepseek.com',
      apiKey: process.env.DEEPSEEK_API_KEY || ''
    });
  }

  async generate(request: ReasonerRequest): Promise<ReasonerResult> {
    if (request.images?.length) throw new Error('DeepSeek reasoner does not support accredited cartographic images');
    const t0 = performance.now();

    if (request.responseSchemaName && request.responseSchema) {
      const response = await this.responsesClient.responses.create({
        model: this.model,
        input: [
          { role: 'system', content: request.systemPrompt },
          { role: 'user', content: request.userPrompt },
        ],
        text: {
          format: {
            ...deepSeekResponseFormat(request),
            strict: true,
          } as any,
        },
        reasoning: { effort: 'none' },
      }, {
        signal: request.signal,
        ...(request.timeoutMs === undefined ? {} : { timeout: request.timeoutMs }),
      });

      const t1 = performance.now();
      return {
        rawContent: (response as any).output_text || '',
        provider: 'deepseek',
        model: this.model,
        latencyMs: Math.round(t1 - t0),
        inputTokens: response.usage?.input_tokens,
        outputTokens: response.usage?.output_tokens,
        totalTokens: response.usage?.total_tokens,
        cachedInputTokens: (response.usage as any)?.input_tokens_details?.cached_tokens,
        reasoningTokens: (response.usage as any)?.output_tokens_details?.reasoning_tokens,
      };
    }

    const completionRequest = {
      model: this.model,
      messages: [
        { role: 'system', content: request.systemPrompt },
        { role: 'user', content: request.userPrompt },
      ],
      temperature: 0.1,
      response_format: { type: 'json_object' },
      thinking: { type: 'disabled' as const },
    } satisfies Parameters<typeof this.openai.chat.completions.create>[0] & {
      thinking: { type: 'disabled' };
    };

    const requestOptions: { signal?: AbortSignal; timeout?: number } = { signal: request.signal };
    if (request.timeoutMs !== undefined) requestOptions.timeout = request.timeoutMs;
    
    const completion = await this.openai.chat.completions.create(completionRequest, requestOptions);

    const t1 = performance.now();

    return {
      rawContent: completion.choices[0]?.message?.content || '',
      provider: 'deepseek',
      model: this.model,
      latencyMs: Math.round(t1 - t0),
      inputTokens: completion.usage?.prompt_tokens,
      outputTokens: completion.usage?.completion_tokens,
      totalTokens: completion.usage?.total_tokens,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      cachedInputTokens: (completion.usage as any)?.prompt_cache_hit_tokens,
    };
  }
}

export class OpenAIReasonerProvider implements ReasonerProvider {
  readonly name = 'openai';
  private openai: OpenAI;
  private model: string;

  constructor() {
    this.openai = new OpenAI({
      apiKey: process.env.OPENAI_API_KEY || ''
    });
    this.model = process.env.URBANBRAIN_OPENAI_REASONER_MODEL || 'gpt-5.6-luna';
  }

  async generate(request: ReasonerRequest): Promise<ReasonerResult> {
    const t0 = performance.now();

    const schemaName = request.responseSchemaName || 'ReasonerOutput';
    const schemaDefinition = request.responseSchema || {
      type: 'object',
      properties: {
        answerMode: { type: 'string', enum: ['definitive', 'conditional', 'partial', 'abstain'] },
        claims: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              id: { type: 'string' },
              type: { type: 'string', enum: ['territorial_fact', 'normative_fact', 'normative_conditional', 'parcel_conclusion', 'limitation'] },
              text: { type: 'string' },
              sourceRefs: { type: 'array', items: { type: 'number' } },
              appliesToParcel: {
                anyOf: [
                  { type: 'boolean' },
                  { type: 'string', enum: ['conditional', 'unknown'] }
                ]
              },
              numericTokens: { type: 'array', items: { type: 'string' } }
            },
            required: ['id', 'type', 'text', 'sourceRefs', 'appliesToParcel', 'numericTokens'],
            additionalProperties: false
          }
        },
        missingFacts: { type: 'array', items: { type: 'string' } }
      },
      required: ['answerMode', 'claims', 'missingFacts'],
      additionalProperties: false
    };

    // Using Responses API for gpt-5.6-luna
    const requestOptions: { signal?: AbortSignal; timeout?: number } = { signal: request.signal };
    if (request.timeoutMs !== undefined) requestOptions.timeout = request.timeoutMs;
    
    const response = await this.openai.responses.create({
      model: this.model,
      input: [
        { role: 'system', content: request.systemPrompt },
        { role: 'user', content: openAIReasonerUserContent(request) }
      ],
      text: {
        format: {
          type: 'json_schema',
          name: schemaName,
          schema: schemaDefinition,
          strict: true
        }
      },
      reasoning: {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        effort: (process.env.URBANBRAIN_OPENAI_REASONING_EFFORT as any) || 'medium'
      }
    }, requestOptions);

    const t1 = performance.now();

    // Responses API returns output_text at the root when text response is configured
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const rawContent = (response as any).output_text || '';

    return {
      rawContent,
      provider: 'openai',
      model: this.model,
      latencyMs: Math.round(t1 - t0),
      inputTokens: response.usage?.input_tokens,
      outputTokens: response.usage?.output_tokens,
      totalTokens: response.usage?.total_tokens,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      cachedInputTokens: (response.usage as any)?.input_tokens_details?.cached_tokens,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      reasoningTokens: (response.usage as any)?.output_tokens_details?.reasoning_tokens,
    };
  }
}

export function getReasonerProvider(): ReasonerProvider {
  let provider: ReasonerProvider;
  let providerType = process.env.URBANBRAIN_REASONER_PROVIDER;
  
  if (!providerType && process.env.NODE_ENV === 'development') {
    providerType = 'openai';
  }

  if (providerType === 'openai') {
    provider = new OpenAIReasonerProvider();
  } else {
    provider = new DeepSeekReasonerProvider();
  }

  // Wrap the provider to capture the request if configured
  if (process.env.NODE_ENV === 'development' && process.env.URBANBRAIN_CAPTURE_REASONER_REQUEST === '1') {
    return {
      name: provider.name,
      generate: async (request: ReasonerRequest) => {
        try {
          const capturePath = path.join(process.cwd(), '.reasoner_request_capture.json');
          // Only save safe fields, avoid including any tokens/keys that might somehow end up here
          const safeRequest = {
            systemPrompt: request.systemPrompt,
            userPrompt: request.userPrompt,
            timeoutMs: request.timeoutMs
          };
          fs.writeFileSync(capturePath, JSON.stringify(safeRequest, null, 2));
          console.log(`[DEV] ReasonerRequest capturado en ${capturePath}`);
        } catch (e) {
          console.error(`[DEV] Error capturando ReasonerRequest:`, e);
        }
        return provider.generate(request);
      }
    };
  }

  return provider;
}
