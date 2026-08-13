import { after } from 'next/server';
import { runTerritorialFactualShadowPipeline } from './shadowPipeline';
import { persistShadowEvaluation, type ShadowTelemetryEvent } from '@/infrastructure/db/factualShadowEvaluationsRepository';
import type { NormalizedParcelContext } from '@/domain/parcel-context/types';
import OpenAI from 'openai';
import type { TerritorialShadowResult } from './shadowPipeline';

interface FactualShadowPersistenceInput {
  result: TerritorialShadowResult
  query: string
  expedienteId: string | null
  municipalityIne: string | null
  shadowModel: string
  latencyMs: number
  pipelineVersion: string
}

async function persistFactualShadowResult(input: FactualShadowPersistenceInput) {
  const event: ShadowTelemetryEvent = {
    expedienteId: input.expedienteId,
    municipalityIne: input.municipalityIne,
    query: input.query,
    shadowModel: input.shadowModel,
    shadowStatus: input.result.status,
    latencyMs: input.latencyMs,
    validationErrors: input.result.validation ?? null,
    structuredOutput: input.result.structuredOutput ?? null,
    renderedAnswer: input.result.renderedText ? input.result.renderedText.join('\n\n') : null,
    pipelineVersion: input.pipelineVersion,
  };

  await persistShadowEvaluation(event);
}

export function scheduleFactualShadowResultPersistence(
  input: FactualShadowPersistenceInput
): void {
  try {
    after(async () => {
      try {
        await persistFactualShadowResult(input);
      } catch (error) {
        console.warn('[FactualSync] Unable to persist factual telemetry:', error);
      }
    });
  } catch (error) {
    console.warn('[FactualSync] Unable to schedule factual telemetry:', error);
  }
}

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
        const shadowModel = 'deepseek-v4-flash';
        const openai = new OpenAI({
          baseURL: 'https://api.deepseek.com/v1',
          apiKey: process.env.DEEPSEEK_API_KEY!,
        });

        const t0 = performance.now();
        const result = await runTerritorialFactualShadowPipeline(message, parcelContext, openai, shadowModel);
        const latencyMs = Math.round(performance.now() - t0);

        await persistFactualShadowResult({
          result,
          query: message,
          expedienteId,
          municipalityIne,
          shadowModel,
          latencyMs,
          pipelineVersion: 'L2.6-shadow-v1',
        });
      } catch (error) {
        console.warn('[FactualShadow] Unhandled exception in shadow pipeline:', error);
      }
    });
  } catch (error) {
    console.warn('[FactualShadow] Synchronous error scheduling shadow pipeline:', error);
  }
}
