import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  scheduleFactualShadowPipeline,
  scheduleFactualShadowResultPersistence,
} from './shadowIntegration';
import { runTerritorialFactualShadowPipeline } from './shadowPipeline';
import { persistShadowEvaluation } from '@/infrastructure/db/factualShadowEvaluationsRepository';
import type { NormalizedParcelContext } from '../types';

vi.mock('next/server', () => ({
  after: vi.fn((cb: Function) => {
    // In tests, we don't await the promise returned by after() automatically,
    // so we can test the synchronous part and asynchronous part explicitly.
    // For simplicity, we just save the callback to be called manually.
    globalThis.__afterCallback = cb;
  }),
}));

vi.mock('./shadowPipeline', () => ({
  runTerritorialFactualShadowPipeline: vi.fn(),
}));

vi.mock('@/infrastructure/db/factualShadowEvaluationsRepository', () => ({
  persistShadowEvaluation: vi.fn(),
}));

vi.mock('openai', () => ({
  default: class OpenAI {}
}));

describe('shadowIntegration', () => {
  let envCache: string | undefined;

  beforeEach(() => {
    vi.clearAllMocks();
    envCache = process.env.URBANBRAIN_FACTUAL_SHADOW_ENABLED;
    globalThis.__afterCallback = undefined;
    vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    process.env.URBANBRAIN_FACTUAL_SHADOW_ENABLED = envCache;
  });

  const getValidContext = (): NormalizedParcelContext => ({
    municipality: { value: { name: 'A Coruña', ineCode: '15030' }, source: 'catastro', confidence: 1, verification: 'confirmed' },
    landClass: { value: 'URBANO', source: 'catastro', confidence: 1, verification: 'confirmed' },
    conflicts: [],
    pendingValidation: [],
    knownConstraints: [],
  });

  const getInvalidContext = (): NormalizedParcelContext => ({
    conflicts: [],
    pendingValidation: [],
    knownConstraints: [],
  });

  it('1. flag OFF -> Shadow no se ejecuta', () => {
    process.env.URBANBRAIN_FACTUAL_SHADOW_ENABLED = 'false';
    scheduleFactualShadowPipeline('Test', getValidContext(), 'exp-1', '15030');
    expect(globalThis.__afterCallback).toBeUndefined();
  });

  it('17. flag distinto de string exacto "true" => OFF', () => {
    process.env.URBANBRAIN_FACTUAL_SHADOW_ENABLED = 'TRUE';
    scheduleFactualShadowPipeline('Test', getValidContext(), 'exp-1', '15030');
    expect(globalThis.__afterCallback).toBeUndefined();
  });

  it('2. flag ON + contexto válido -> Shadow se agenda', () => {
    process.env.URBANBRAIN_FACTUAL_SHADOW_ENABLED = 'true';
    scheduleFactualShadowPipeline('Test', getValidContext(), 'exp-1', '15030');
    expect(globalThis.__afterCallback).toBeDefined();
  });

  it('3. sin contexto -> Shadow no se ejecuta', () => {
    process.env.URBANBRAIN_FACTUAL_SHADOW_ENABLED = 'true';
    scheduleFactualShadowPipeline('Test', getInvalidContext(), 'exp-1', '15030');
    expect(globalThis.__afterCallback).toBeUndefined();
  });

  it('9. Shadow throw no afecta al primary', async () => {
    process.env.URBANBRAIN_FACTUAL_SHADOW_ENABLED = 'true';
    vi.mocked(runTerritorialFactualShadowPipeline).mockRejectedValueOnce(new Error('Pipeline error'));

    scheduleFactualShadowPipeline('Test', getValidContext(), 'exp-1', '15030');
    const cb = globalThis.__afterCallback;
    expect(cb).toBeDefined();

    // Call the background task, it shouldn't throw globally
    await expect(cb()).resolves.toBeUndefined();
    expect(console.warn).toHaveBeenCalledWith(
      '[FactualShadow] Unhandled exception in shadow pipeline:',
      expect.any(Error)
    );
  });

  it('10. persistShadowEvaluation throw no afecta al primary', async () => {
    process.env.URBANBRAIN_FACTUAL_SHADOW_ENABLED = 'true';
    vi.mocked(runTerritorialFactualShadowPipeline).mockResolvedValueOnce({
      status: 'valid',
      validation: undefined,
      structuredOutput: undefined,
      renderedText: undefined,
      diagnostics: { latencyMs: 100, model: 'test' },
    });
    vi.mocked(persistShadowEvaluation).mockRejectedValueOnce(new Error('DB error'));

    scheduleFactualShadowPipeline('Test', getValidContext(), 'exp-1', '15030');
    const cb = globalThis.__afterCallback;

    await expect(cb()).resolves.toBeUndefined();
    expect(console.warn).toHaveBeenCalledWith(
      '[FactualShadow] Unhandled exception in shadow pipeline:',
      expect.any(Error)
    );
  });

  it('13, 14, 15, 16. Mapeo a telemetría', async () => {
    process.env.URBANBRAIN_FACTUAL_SHADOW_ENABLED = 'true';
    vi.mocked(runTerritorialFactualShadowPipeline).mockResolvedValueOnce({
      status: 'valid',
      validation: undefined,
      structuredOutput: { isUrban: true } as any,
      renderedText: ['Yes'],
      diagnostics: { latencyMs: 100, model: 'test' },
    });

    scheduleFactualShadowPipeline('Test Query', getValidContext(), 'exp-123', '15030');
    await globalThis.__afterCallback();

    expect(persistShadowEvaluation).toHaveBeenCalledWith(expect.objectContaining({
      query: 'Test Query',
      expedienteId: 'exp-123',
      municipalityIne: '15030',
      shadowModel: 'deepseek-v4-flash',
      shadowStatus: 'valid',
      structuredOutput: { isUrban: true },
      renderedAnswer: 'Yes',
      pipelineVersion: 'L2.6-shadow-v1',
    }));
    // Latency is tested implicitly as any number
    expect(vi.mocked(persistShadowEvaluation).mock.calls[0][0].latencyMs).toBeGreaterThanOrEqual(0);
  });

  it('persiste telemetría de un resultado sync ya calculado sin ejecutar de nuevo el pipeline', async () => {
    const result = {
      status: 'valid' as const,
      structuredOutput: { operations: [], abstentions: [] },
      renderedText: ['Respuesta visible'],
      diagnostics: { latencyMs: 321, model: 'deepseek-v4-flash' },
    };

    scheduleFactualShadowResultPersistence({
      result,
      query: 'Consulta territorial',
      expedienteId: 'exp-sync',
      municipalityIne: '15075',
      shadowModel: 'deepseek-v4-flash',
      latencyMs: 321,
      pipelineVersion: 'L2.6-sync-visible-v1',
    });
    await globalThis.__afterCallback();

    expect(runTerritorialFactualShadowPipeline).not.toHaveBeenCalled();
    expect(persistShadowEvaluation).toHaveBeenCalledWith(expect.objectContaining({
      expedienteId: 'exp-sync',
      shadowStatus: 'valid',
      latencyMs: 321,
      renderedAnswer: 'Respuesta visible',
      pipelineVersion: 'L2.6-sync-visible-v1',
    }));
  });
});
