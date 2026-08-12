import { after } from 'next/server';
import { runTerritorialFactualShadowPipeline } from './shadowPipeline';
import { persistShadowEvaluation, type ShadowTelemetryEvent } from '@/infrastructure/db/factualShadowEvaluationsRepository';
import type { NormalizedParcelContext } from '@/domain/parcel-context/types';
import OpenAI from 'openai';

export function scheduleFactualShadowPipeline(
  message: string,
  parcelContext: NormalizedParcelContext,
  expedienteId: string | null,
  municipalityIne: string | null
): void {
  try {
    // 1. Feature Flag
    if (process.env.URBANBRAIN_FACTUAL_SHADOW_ENABLED !== 'true') {
      return;
    }

    // 7. Casos sin contexto
    if (!parcelContext.municipality && !parcelContext.landClass) {
      return;
    }

    // 3. after() mechanism
    after(async () => {
      try {
        const shadowModel = 'deepseek-v4';
        const openai = new OpenAI({
          baseURL: 'https://api.deepseek.com/v1',
          apiKey: process.env.DEEPSEEK_API_KEY!,
        });

        const t0 = performance.now();
        const result = await runTerritorialFactualShadowPipeline(message, parcelContext, openai, shadowModel);
        const latencyMs = Math.round(performance.now() - t0);

        const event: ShadowTelemetryEvent = {
          expedienteId,
          municipalityIne,
          query: message,
          shadowModel,
          shadowStatus: result.status,
          latencyMs,
          validationErrors: result.validation ?? null,
          structuredOutput: result.structuredOutput ?? null,
          renderedAnswer: result.renderedText ? result.renderedText.join('\n\n') : null,
          pipelineVersion: 'L2.6-shadow-v1',
        };

        await persistShadowEvaluation(event);
      } catch (error) {
        console.warn('[FactualShadow] Unhandled exception in shadow pipeline:', error);
      }
    });
  } catch (error) {
    console.warn('[FactualShadow] Synchronous error scheduling shadow pipeline:', error);
  }
}
