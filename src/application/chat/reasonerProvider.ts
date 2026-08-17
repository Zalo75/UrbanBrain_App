import OpenAI from 'openai';

export interface ReasonerRequest {
  systemPrompt: string
  userPrompt: string
  signal?: AbortSignal
  timeoutMs?: number
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
  generate(request: ReasonerRequest): Promise<ReasonerResult>
}

export class DeepSeekReasonerProvider implements ReasonerProvider {
  private openai: OpenAI;
  private model = 'deepseek-v4-flash';

  constructor() {
    this.openai = new OpenAI({
      baseURL: 'https://api.deepseek.com/v1',
      apiKey: process.env.DEEPSEEK_API_KEY || ''
    });
  }

  async generate(request: ReasonerRequest): Promise<ReasonerResult> {
    const t0 = performance.now();

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

    const completion = await this.openai.chat.completions.create(completionRequest, {
      signal: request.signal,
      timeout: request.timeoutMs
    });

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

    // Using Responses API for gpt-5.6-luna
    const response = await this.openai.responses.create({
      model: this.model,
      input: [
        { role: 'system', content: request.systemPrompt },
        { role: 'user', content: request.userPrompt }
      ],
      text: {
        format: {
          type: 'json_schema',
          name: 'ReasonerOutput',
          schema: {
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
          },
          strict: true
        }
      },
      reasoning: {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        effort: (process.env.URBANBRAIN_OPENAI_REASONING_EFFORT as any) || 'medium'
      }
    }, {
      signal: request.signal,
      timeout: request.timeoutMs
    });

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
  if (process.env.URBANBRAIN_REASONER_PROVIDER === 'openai') {
    return new OpenAIReasonerProvider();
  }
  return new DeepSeekReasonerProvider();
}
