import { describe, expect, it, vi } from 'vitest'

vi.mock('@/infrastructure/db/client', () => ({ db: {} }))

import { sanitizeAuditMetadata } from './adminAudit'

describe('administrative audit metadata sanitizer', () => {
  it('removes secrets and conversational content recursively', () => {
    expect(
      sanitizeAuditMetadata({
        operation: 'role_review',
        messageId: 'safe-technical-identifier',
        conversation_id: 'safe-conversation-identifier',
        token: 'forbidden',
        nested: {
          apiKey: 'forbidden',
          promptText: 'forbidden',
          safeCode: 42,
        },
      })
    ).toEqual({
      operation: 'role_review',
      messageId: 'safe-technical-identifier',
      conversation_id: 'safe-conversation-identifier',
      nested: { safeCode: 42 },
    })
  })

  it('bounds string and array metadata to avoid an unbounded audit payload', () => {
    const result = sanitizeAuditMetadata({
      label: 'x'.repeat(800),
      identifiers: Array.from({ length: 30 }, (_, index) => index),
    })

    expect(result.label).toHaveLength(500)
    expect(result.identifiers).toHaveLength(20)
  })
})
