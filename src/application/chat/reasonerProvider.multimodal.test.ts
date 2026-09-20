// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest'
const mocks = vi.hoisted(() => ({ create: vi.fn() }))
vi.mock('openai', () => ({ default: class { responses = { create: mocks.create } } }))
import { DeepSeekReasonerProvider, OpenAIReasonerProvider, openAIReasonerUserContent } from './reasonerProvider'
afterEach(() => vi.clearAllMocks())
describe('same-provider multimodal transport', () => {
  it('sends actual image blocks to Responses with IDs, abort options and real usage', async () => {
    mocks.create.mockResolvedValue({ output_text: '{}', usage: { input_tokens: 120, output_tokens: 4, total_tokens: 124, input_tokens_details: { cached_tokens: 20 } } })
    const abort = new AbortController()
    const request = { systemPrompt: 'rules', userPrompt: 'observe', signal: abort.signal, timeoutMs: 200, images: [{ id: 'A', label: 'historical', mediaType: 'image/png' as const, data: 'YWJj' }, { id: 'B', label: 'modern', mediaType: 'image/png' as const, data: 'ZGVm' }] }
    const result = await new OpenAIReasonerProvider().generate(request)
    const [body, options] = mocks.create.mock.calls[0]!
    expect(body.input[1].content.filter((item: { type: string }) => item.type === 'input_image')).toEqual([{ type: 'input_image', image_url: 'data:image/png;base64,YWJj', detail: 'high' }, { type: 'input_image', image_url: 'data:image/png;base64,ZGVm', detail: 'high' }])
    expect(body.input[1].content[1].text).toContain('A')
    expect(options).toMatchObject({ signal: abort.signal, timeout: 200 })
    expect(result).toMatchObject({ inputTokens: 120, outputTokens: 4, totalTokens: 124, cachedInputTokens: 20 })
  })
  it('keeps text-only requests compatible and rejects unsupported multimodal provider', async () => {
    expect(openAIReasonerUserContent({ systemPrompt: '', userPrompt: 'text' })).toBe('text')
    await expect(new DeepSeekReasonerProvider().generate({ systemPrompt: '', userPrompt: '', images: [{ id: 'A', label: 'A', mediaType: 'image/png', data: 'YWJj' }] })).rejects.toThrow('does not support')
    expect(mocks.create).not.toHaveBeenCalled()
  })
})
