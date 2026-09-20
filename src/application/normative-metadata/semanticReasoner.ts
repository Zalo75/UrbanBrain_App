import { OpenAIReasonerProvider } from '../chat/reasonerProvider';
import { db } from '../../infrastructure/db/client';
import { sql } from 'drizzle-orm';
import { recordLLMUsage, type LLMOperationContext } from '@/application/runtime/runtimeAccounting'

export type DocumentaryType = 'ordinance' | 'zone' | 'catalog_element' | 'qualification' | 'instrument' | 'unknown';
export type RelationshipType = 'belonging' | 'mention';

export interface TypedIdentity {
  code: string | null;
  label: string | null;
  documentaryType: DocumentaryType;
  relationship: RelationshipType;
  evidence: string;
  explanation: string;
}

export interface SemanticResult {
  identifiedCodes: TypedIdentity[];
  _metrics?: {
    latencyMs: number;
    inputTokens: number;
    outputTokens: number;
    calls: number;
  };
}

const SemanticV3Schema = {
  type: 'object',
  properties: {
    identifiedCodes: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          code: { type: ['string', 'null'] },
          label: { type: ['string', 'null'] },
          documentaryType: { 
            type: 'string', 
            enum: ['ordinance', 'zone', 'catalog_element', 'qualification', 'instrument', 'unknown'] 
          },
          relationship: {
            type: 'string',
            enum: ['belonging', 'mention']
          },
          evidence: { type: 'string' },
          explanation: { type: 'string' }
        },
        required: ['code', 'label', 'documentaryType', 'relationship', 'evidence', 'explanation'],
        additionalProperties: false
      }
    }
  },
  required: ['identifiedCodes'],
  additionalProperties: false
};

const SYSTEM_PROMPT = `Eres un lector experto de documentos urbanísticos. Identifica las identidades documentales a las que pertenece el TARGET y clasifica cada una según qué identifica documentalmente. 

REGLAS DE IDENTIFICACIÓN Y RELACIÓN:
- relationship = "belonging" cuando la identidad identifica, titula, encuadra o establece jerárquicamente a qué pertenece el TARGET.
- relationship = "mention" cuando el TARGET únicamente cita o menciona esa identidad como referencia externa.

REGLAS DE DENOMINACIÓN (CODE VS LABEL):
- "code" sólo debe contener un código, clave o identificador corto que aparezca documentalmente (ej. D-027, SU-1, PERI-4).
- Si existe una identidad descriptiva o un nombre normativo completo pero NO un código explícito, NO inventes códigos. Asigna code = null y utiliza "label" para conservar su denominación literal completa.
- Si existe código explícito, utiliza "code" y puedes utilizar "label" para el nombre.

TIPOS DOCUMENTALES:
- ordinance: identifica una ordenanza o cuerpo de reglas.
- zone: identifica un ámbito territorial, sector, núcleo o zona.
- catalog_element: identifica un elemento individual de catálogo.
- qualification: identifica una calificación o clase normativa.
- instrument: identifica un instrumento, modificación, expediente o versión documental.
- unknown: existe una identidad pero el texto no permite clasificarla con seguridad.`;

export async function extractSemanticMetadataFromTexts(
  prevText: string,
  targetText: string,
  nextText: string,
  operation?: LLMOperationContext
): Promise<SemanticResult> {
  const provider = new OpenAIReasonerProvider();
  
  const userPrompt = `DOCUMENT CONTEXT

[PREVIOUS CHUNK]
${prevText}

[TARGET CHUNK]
${targetText}
[/TARGET CHUNK]

[NEXT CHUNK]
${nextText}`;

  const response = await provider.generate({
    systemPrompt: SYSTEM_PROMPT,
    userPrompt,
    responseSchemaName: 'TypedIdentityOutput',
    responseSchema: SemanticV3Schema
  });
  if (operation) recordLLMUsage({ ...operation, requestId: operation.requestId ?? null, expedienteId: operation.expedienteId ?? null, stage: 'semantic-metadata', inferenceIndex: 1, provider: response.provider, model: response.model, inputTokens: response.inputTokens ?? null, cachedInputTokens: response.cachedInputTokens ?? null, outputTokens: response.outputTokens ?? null, reasoningTokens: response.reasoningTokens ?? null, totalTokens: response.totalTokens ?? null, durationMs: response.latencyMs ?? null, toolCallsRequested: 0, finishReason: null })

  const parsed = JSON.parse(response.rawContent);
  return {
    identifiedCodes: parsed.identifiedCodes || [],
    _metrics: {
      latencyMs: response.latencyMs,
      inputTokens: response.inputTokens || 0,
      outputTokens: response.outputTokens || 0,
      calls: 1
    }
  };
}

export async function extractSemanticMetadata(
  documentName: string,
  targetId: string,
  operation?: LLMOperationContext
): Promise<SemanticResult> {
  const contextChunks = await db.execute(sql`
    WITH Ranked AS (
      SELECT id, texto, row_number() OVER (PARTITION BY nombre_pdf ORDER BY ctid) - 1 as chunk_index
      FROM normativa_chunks
      WHERE nombre_pdf = ${documentName}
    ), Target AS (
      SELECT chunk_index as target_index FROM Ranked WHERE id = ${targetId}
    )
    SELECT r.id, r.chunk_index, r.texto, t.target_index
    FROM Ranked r, Target t
    WHERE r.chunk_index >= t.target_index - 1 AND r.chunk_index <= t.target_index + 1
    ORDER BY r.chunk_index
  `);

  let prevText = '';
  let targetText = '';
  let nextText = '';

  for (const row of contextChunks) {
    if (row.id === targetId) {
      targetText = row.texto as string;
    } else if (Number(row.chunk_index) < Number(row.target_index)) {
      prevText = row.texto as string;
    } else {
      nextText = row.texto as string;
    }
  }

  return extractSemanticMetadataFromTexts(prevText, targetText, nextText, operation);
}
