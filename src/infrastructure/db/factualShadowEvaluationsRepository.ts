import { db } from '@/infrastructure/db/client';
import { factualShadowEvaluations } from '@/infrastructure/db/schema';

export type ShadowTelemetryEvent = {
  expedienteId?: string | null;
  municipalityIne?: string | null;
  query: string;
  shadowModel: string;
  shadowStatus: 'valid' | 'validation_failed' | 'render_failed' | 'llm_failed';
  latencyMs: number;
  validationErrors?: unknown;
  structuredOutput?: unknown;
  renderedAnswer?: string | null;
  pipelineVersion?: string | null;
};

export async function persistShadowEvaluation(event: ShadowTelemetryEvent): Promise<void> {
  try {
    await db.insert(factualShadowEvaluations).values({
      expedienteId: event.expedienteId || null,
      municipalityIne: event.municipalityIne || null,
      query: event.query,
      shadowModel: event.shadowModel,
      shadowStatus: event.shadowStatus,
      latencyMs: event.latencyMs,
      validationErrors: event.validationErrors || null,
      structuredOutput: event.structuredOutput || null,
      renderedAnswer: event.renderedAnswer || null,
      pipelineVersion: event.pipelineVersion || null,
    });
  } catch (error) {
    // "La persistencia debe poder fallar sin afectar posteriormente al flujo productivo cuando se use en 5B."
    console.warn('[Telemetry] Failed to persist factual shadow evaluation', error);
  }
}
