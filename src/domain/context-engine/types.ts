import { InferSelectModel } from 'drizzle-orm';
import { expedientes } from '@/infrastructure/db/schema';

export type Expediente = InferSelectModel<typeof expedientes>;

export interface ContextDetectionResult {
  summary: Record<string, any>;
  rawResponses: Record<string, any>;
  errors: Record<string, string>;
  geometryStored: boolean;
  sourceApis: string[];
}

export interface IContextDetector {
  readonly name: string;
  detect(expediente: Expediente, currentResult: ContextDetectionResult): Promise<ContextDetectionResult>;
}
