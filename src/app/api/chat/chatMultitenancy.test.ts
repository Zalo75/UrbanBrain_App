import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

const mocks = vi.hoisted(() => ({
  getExpedienteAccess: vi.fn(),
  insert: vi.fn(),
  select: vi.fn(),
}))

vi.mock('@/application/authorization/expedienteAccess', () => ({
  getExpedienteAccess: mocks.getExpedienteAccess,
}))

vi.mock('@/infrastructure/db/client', () => ({
  db: {
    insert: mocks.insert,
    select: mocks.select,
  },
}))

vi.mock('@google/generative-ai', () => ({
  GoogleGenerativeAI: class {
    getGenerativeModel() {
      return { embedContent: vi.fn() }
    }
  },
  TaskType: { RETRIEVAL_QUERY: 'RETRIEVAL_QUERY' },
}))

vi.mock('@supabase/supabase-js', () => ({
  createClient: vi.fn(() => ({ rpc: vi.fn() })),
}))

vi.mock('openai', () => ({
  default: class {
    chat = { completions: { create: vi.fn() } }
  },
}))

import { generateMetadata } from '@/app/(dashboard)/expedientes/[id]/page'
import { POST } from '@/app/api/chat/route'
import { GET } from '@/app/api/chat/history/route'
import { MAX_CHAT_MESSAGE_LENGTH, resetChatRequestGuardForTests } from '@/application/chat/chatRequestGuard'

describe('chat multitenancy boundaries', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    resetChatRequestGuardForTests()
    mocks.getExpedienteAccess.mockResolvedValue({
      ok: false,
      reason: 'not_found_or_forbidden',
    })
  })

  it('rejects oversized messages before reading context or writing chat data', async () => {
    mocks.getExpedienteAccess.mockResolvedValue({
      ok: true,
      userId: 'user-a',
      orgId: 'org-a',
      membershipRole: 'member',
      expediente: { id: 'expediente-org-a', orgId: 'org-a' },
    })
    const request = new NextRequest('http://localhost/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        expedienteId: 'expediente-org-a',
        message: 'x'.repeat(MAX_CHAT_MESSAGE_LENGTH + 1),
      }),
    })

    const response = await POST(request)

    expect(response.status).toBe(413)
    expect(mocks.insert).not.toHaveBeenCalled()
  })

  it('prevents a user from organization A from reading organization B chat history', async () => {
    const request = new NextRequest(
      'http://localhost/api/chat/history?expedienteId=expediente-org-b'
    )

    const response = await GET(request)

    expect(response.status).toBe(404)
    expect(mocks.getExpedienteAccess).toHaveBeenCalledWith('expediente-org-b')
    expect(mocks.select).not.toHaveBeenCalled()
  })

  it('prevents a user from organization A from writing to organization B chat', async () => {
    const request = new NextRequest('http://localhost/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        expedienteId: 'expediente-org-b',
        message: 'Consulta privada',
        municipio: 'municipio-manipulado',
      }),
    })

    const response = await POST(request)

    expect(response.status).toBe(404)
    expect(mocks.getExpedienteAccess).toHaveBeenCalledWith('expediente-org-b')
    expect(mocks.insert).not.toHaveBeenCalled()
  })

  it('does not reveal organization B expediente data through metadata', async () => {
    const metadata = await generateMetadata({
      params: Promise.resolve({ id: 'expediente-org-b' }),
    })

    expect(metadata).toEqual({ title: 'Expediente - UrbanBrain' })
    expect(JSON.stringify(metadata)).not.toContain('Proyecto secreto B')
  })
})
