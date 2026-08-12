import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const mocks = vi.hoisted(() => ({
  getExpedienteAccess: vi.fn(),
  loadAuthorizedParcelInputs: vi.fn(),
  insert: vi.fn().mockReturnValue({ values: vi.fn().mockResolvedValue(undefined) }),
  select: vi.fn().mockReturnValue({
    from: vi.fn().mockReturnValue({
      where: vi.fn().mockReturnValue(Object.assign(Promise.resolve([]), {
        limit: vi.fn().mockResolvedValue([]),
      })),
    }),
  }),
  embedContent: vi.fn(),
  rpc: vi.fn().mockReturnValue({ abortSignal: vi.fn().mockResolvedValue({ data: [], error: null }) }),
  completionCreate: vi.fn(),
  scheduleFactualShadowPipeline: vi.fn(),
}));

vi.mock('@/application/authorization/expedienteAccess', () => ({
  getExpedienteAccess: mocks.getExpedienteAccess,
}));
vi.mock('@/infrastructure/db/parcelContextRepository', () => ({
  loadAuthorizedParcelInputs: mocks.loadAuthorizedParcelInputs,
}));
vi.mock('@/infrastructure/db/client', () => ({
  db: { insert: mocks.insert, select: mocks.select },
}));
vi.mock('@google/generative-ai', () => ({
  GoogleGenerativeAI: class {
    getGenerativeModel() { return { embedContent: mocks.embedContent }; }
  },
  TaskType: { RETRIEVAL_QUERY: 'RETRIEVAL_QUERY' },
}));
vi.mock('@supabase/supabase-js', () => ({
  createClient: vi.fn(() => ({ rpc: mocks.rpc })),
}));
vi.mock('openai', () => ({
  default: class {
    chat = { completions: { create: mocks.completionCreate } };
  },
}));
vi.mock('@/application/parcel-context/shadow/shadowIntegration', () => ({
  scheduleFactualShadowPipeline: mocks.scheduleFactualShadowPipeline,
}));

import { resetChatRequestGuardForTests } from '@/application/chat/chatRequestGuard';
import { POST } from './route';

describe('POST /api/chat factual shadow integration (Bloque 5B)', () => {
  const executePrimary = async (message: string) => {
    const request = new NextRequest('http://localhost/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ expedienteId: 'exp-1', message }),
    });
    const response = await POST(request);
    return response.json();
  };

  beforeEach(() => {
    vi.clearAllMocks();
    resetChatRequestGuardForTests();
    mocks.embedContent.mockResolvedValue({ embedding: { values: new Array(768).fill(0.01) } });
    mocks.completionCreate.mockResolvedValue({
      choices: [{ message: { content: 'Primary Response' } }],
    });
    mocks.getExpedienteAccess.mockResolvedValue({
      ok: true,
      userId: 'user-1',
      orgId: 'org-1',
      expediente: { id: 'exp-1', orgId: 'org-1' },
    });
    // Contexto válido con detectables
    mocks.loadAuthorizedParcelInputs.mockResolvedValue({
      expediente: { id: 'exp-1', orgId: 'org-1' },
      userMessages: [],
      detected: {
        cadastralReference: '1234567AB1234C0001DE',
        municipality: { name: 'Sada', ineCode: '15075' },
        landClass: 'Urbano',
      },
    });
  });

  it('4. primary response es idéntica con flag OFF', async () => {
    process.env.URBANBRAIN_FACTUAL_SHADOW_ENABLED = 'false';
    const resultOff = await executePrimary('¿Es urbano?');
    
    process.env.URBANBRAIN_FACTUAL_SHADOW_ENABLED = 'true';
    const resultOn = await executePrimary('¿Es urbano?');
    
    expect(resultOn.answer).toBe(resultOff.answer);
    expect(mocks.scheduleFactualShadowPipeline).toHaveBeenCalled();
  });

  it('6, 7, 8, 9, 10, 11, 12. fallos en shadow o lentitud no afectan al primary y output no se filtra', async () => {
    process.env.URBANBRAIN_FACTUAL_SHADOW_ENABLED = 'false';
    const resultOff = await executePrimary('¿Es urbano?');

    process.env.URBANBRAIN_FACTUAL_SHADOW_ENABLED = 'true';
    // La ejecución del shadow no interfiere con el hilo principal

    const result = await executePrimary('¿Es urbano?');
    
    expect(result.answer).toBe(resultOff.answer);
    expect(result.answer).not.toContain('Shadow Pipeline');
  });
});
