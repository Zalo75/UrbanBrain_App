import { beforeEach, describe, expect, it, vi } from 'vitest'

const completionCreate = vi.hoisted(() => vi.fn())

vi.mock('openai', () => ({
  default: class {
    chat = { completions: { create: completionCreate } }
  },
}))

import { QuestionAnalyzer } from './QuestionAnalyzer'

describe('QuestionAnalyzer', () => {
  beforeEach(() => {
    completionCreate.mockReset()
    completionCreate.mockResolvedValue({
      choices: [{
        message: {
          content: JSON.stringify({
            intent: 'normativa_lookup',
            required_scopes: ['municipal'],
            required_categories: ['urbanismo_general'],
            needs_context: true,
            needs_sources: true,
            extracted_parameters: {},
          }),
        },
      }],
    })
  })

  it('uses DeepSeek V4 Flash with thinking explicitly disabled', async () => {
    await new QuestionAnalyzer().analyze('¿Qué normativa municipal aplica?')

    expect(completionCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        model: 'deepseek-v4-flash',
        thinking: { type: 'disabled' },
      }),
      { signal: undefined }
    )
  })
})
