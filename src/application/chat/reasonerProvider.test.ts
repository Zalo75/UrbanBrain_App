// @vitest-environment node
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { getReasonerProvider, OpenAIReasonerProvider, DeepSeekReasonerProvider } from './reasonerProvider';

describe('reasonerProvider factory', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    vi.resetModules();
    process.env = { ...originalEnv };
    process.env.OPENAI_API_KEY = 'test-key';
    process.env.DEEPSEEK_API_KEY = 'test-key';
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it('uses DeepSeek in production by default', () => {
    process.env.NODE_ENV = 'production';
    delete process.env.URBANBRAIN_REASONER_PROVIDER;
    delete process.env.URBANBRAIN_CAPTURE_REASONER_REQUEST;
    const provider = getReasonerProvider();
    expect(provider).toBeInstanceOf(DeepSeekReasonerProvider);
  });

  it('uses OpenAI in development by default', () => {
    process.env.NODE_ENV = 'development';
    delete process.env.URBANBRAIN_REASONER_PROVIDER;
    delete process.env.URBANBRAIN_CAPTURE_REASONER_REQUEST;
    const provider = getReasonerProvider();
    expect(provider).toBeInstanceOf(OpenAIReasonerProvider);
  });

  it('respects explicit URBANBRAIN_REASONER_PROVIDER=deepseek in development', () => {
    process.env.NODE_ENV = 'development';
    process.env.URBANBRAIN_REASONER_PROVIDER = 'deepseek';
    delete process.env.URBANBRAIN_CAPTURE_REASONER_REQUEST;
    const provider = getReasonerProvider();
    expect(provider).toBeInstanceOf(DeepSeekReasonerProvider);
  });

  it('respects explicit URBANBRAIN_REASONER_PROVIDER=openai in production', () => {
    process.env.NODE_ENV = 'production';
    process.env.URBANBRAIN_REASONER_PROVIDER = 'openai';
    delete process.env.URBANBRAIN_CAPTURE_REASONER_REQUEST;
    const provider = getReasonerProvider();
    expect(provider).toBeInstanceOf(OpenAIReasonerProvider);
  });
});
