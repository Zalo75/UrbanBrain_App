import { afterEach, describe, expect, it } from 'vitest'
import { acquireChatSlot, CHAT_RATE_LIMIT, resetChatRequestGuardForTests } from './chatRequestGuard'

afterEach(resetChatRequestGuardForTests)

describe('chat request guard', () => {
  it('rejects a second concurrent request for the same user', () => {
    const first = acquireChatSlot('user-a', 1_000)
    expect(first.ok).toBe(true)
    expect(acquireChatSlot('user-a', 1_001)).toMatchObject({ ok: false, reason: 'concurrent' })
    if (first.ok) first.release()
    expect(acquireChatSlot('user-a', 1_002).ok).toBe(true)
  })

  it('limits frequency per user without affecting another user', () => {
    for (let index = 0; index < CHAT_RATE_LIMIT; index += 1) {
      const slot = acquireChatSlot('user-a', 1_000 + index)
      expect(slot.ok).toBe(true)
      if (slot.ok) slot.release()
    }
    expect(acquireChatSlot('user-a', 2_000)).toMatchObject({ ok: false, reason: 'rate_limited' })
    expect(acquireChatSlot('user-b', 2_000).ok).toBe(true)
  })

  it('expires old requests from the frequency window', () => {
    const first = acquireChatSlot('user-a', 1_000)
    if (first.ok) first.release()
    expect(acquireChatSlot('user-a', 61_001).ok).toBe(true)
  })
})
