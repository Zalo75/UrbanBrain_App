export const MAX_CHAT_MESSAGE_LENGTH = 4_000
export const CHAT_REQUEST_TIMEOUT_MS = 45_000
export const CHAT_RATE_WINDOW_MS = 60_000
export const CHAT_RATE_LIMIT = 6

type UserState = { timestamps: number[]; active: boolean }
const states = new Map<string, UserState>()

export type ChatSlotResult =
  | { ok: true; release: () => void }
  | { ok: false; reason: 'concurrent' | 'rate_limited'; retryAfterSeconds: number }

export function acquireChatSlot(userId: string, now = Date.now()): ChatSlotResult {
  for (const [key, value] of states) {
    value.timestamps = value.timestamps.filter((timestamp) => now - timestamp < CHAT_RATE_WINDOW_MS)
    if (!value.active && value.timestamps.length === 0) states.delete(key)
  }
  const state = states.get(userId) ?? { timestamps: [], active: false }
  if (state.active) return { ok: false, reason: 'concurrent', retryAfterSeconds: 2 }
  if (state.timestamps.length >= CHAT_RATE_LIMIT) {
    const retryAfterSeconds = Math.max(1, Math.ceil((CHAT_RATE_WINDOW_MS - (now - state.timestamps[0])) / 1000))
    states.set(userId, state)
    return { ok: false, reason: 'rate_limited', retryAfterSeconds }
  }
  state.active = true
  state.timestamps.push(now)
  states.set(userId, state)
  let released = false
  return { ok: true, release: () => {
    if (released) return
    released = true
    const current = states.get(userId)
    if (current) current.active = false
  } }
}

export function resetChatRequestGuardForTests() {
  states.clear()
}
