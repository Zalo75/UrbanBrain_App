import { db } from '@/infrastructure/db/client';
import { expedientes, contextDetections } from '@/infrastructure/db/schema';
import { eq } from 'drizzle-orm';
import { ContextDetectionResult, IContextDetector, Expediente } from '@/domain/context-engine/types';
import { CatastroDetector } from './detectors/CatastroDetector';

export class ContextDetectionEngine {
  private detectors: IContextDetector[];

  constructor() {
    this.detectors = [
      new CatastroDetector()
    ];
  }

  // Ejecuta la detección y guarda en base de datos (Para expedientes existentes)
  public async detectContext(expedienteId: string): Promise<ContextDetectionResult | null> {
    console.log(`[ContextDetectionEngine] Iniciando motor para expediente: ${expedienteId}`);
    
    const [expediente] = await db.select().from(expedientes).where(eq(expedientes.id, expedienteId));
    
    if (!expediente) {
      console.error(`[ContextDetectionEngine] Error: Expediente ${expedienteId} no encontrado.`);
      return null;
    }

    const result = await this.runDetectors(expediente as any);

    try {
      await db.insert(contextDetections).values({
        expedienteId: expedienteId,
        summary: result.summary,
        rawResponse: result.rawResponses,
        geometryStored: result.geometryStored,
        sourceApis: result.sourceApis
      });
      console.log(`[ContextDetectionEngine] Registro guardado en context_detections correctamente.`);
    } catch (dbError) {
      console.error(`[ContextDetectionEngine] Error guardando en base de datos:`, dbError);
    }

    return result;
  }

  // Ejecuta la detección al vuelo sin guardar en base de datos (Para previsualización en UI)
  public async detectStateless(refCatastral: string): Promise<ContextDetectionResult> {
    console.log(`[ContextDetectionEngine] Iniciando motor stateless para RC: ${refCatastral}`);
    // Creamos un dummy de expediente para engañar al detector temporalmente
    const dummyExpediente = { refCatastral } as any;
    return await this.runDetectors(dummyExpediente);
  }

  private async runDetectors(expediente: Expediente): Promise<ContextDetectionResult> {
    let result: ContextDetectionResult = {
      summary: {},
      rawResponses: {},
      errors: {},
      geometryStored: false,
      sourceApis: []
    };

    for (const detector of this.detectors) {
      console.log(`[ContextDetectionEngine] Ejecutando detector: ${detector.name}...`);
      const startTime = performance.now();
      
      try {
        result = await detector.detect(expediente, result);
      } catch (err: any) {
        console.error(`[ContextDetectionEngine] Fallo catastrófico en detector ${detector.name}:`, err);
        result.errors[detector.name] = `Fallo crítico: ${err.message}`;
      }
      
      const endTime = performance.now();
      console.log(`[ContextDetectionEngine] Detector ${detector.name} finalizado en ${(endTime - startTime).toFixed(2)}ms`);
    }

    console.log(`[ContextDetectionEngine] Pipeline completado. Fuentes consultadas: ${result.sourceApis.join(', ')}`);
    return result;
  }
}
