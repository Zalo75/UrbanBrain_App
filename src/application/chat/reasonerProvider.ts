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
    this.model = process.env.URBANBRAIN_OPENAI_REASONER_MODEL || 'gpt-4o';
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
    } satisfies Parameters<typeof this.openai.chat.completions.create>[0];

    const completion = await this.openai.chat.completions.create(completionRequest, { 
      signal: request.signal, 
      timeout: request.timeoutMs 
    });
    
    const t1 = performance.now();

    return {
      rawContent: completion.choices[0]?.message?.content || '',
      provider: 'openai',
      model: this.model,
      latencyMs: Math.round(t1 - t0),
      inputTokens: completion.usage?.prompt_tokens,
      outputTokens: completion.usage?.completion_tokens,
      totalTokens: completion.usage?.total_tokens,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      cachedInputTokens: (completion.usage as any)?.prompt_tokens_details?.cached_tokens,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      reasoningTokens: (completion.usage as any)?.completion_tokens_details?.reasoning_tokens,
    };
  }
}

export function getReasonerProvider(): ReasonerProvider {
  if (process.env.URBANBRAIN_REASONER_PROVIDER === 'openai') {
    return new OpenAIReasonerProvider();
  }
  return new DeepSeekReasonerProvider();
}
