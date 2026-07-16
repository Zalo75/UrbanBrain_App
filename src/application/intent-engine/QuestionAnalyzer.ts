import OpenAI from 'openai';
import { IntentAnalyzerResponse, IntentType, ScopeType, CategoryType } from "@/domain/intent-engine/types";

export class QuestionAnalyzer {
  private openai: OpenAI;
  private modelName = "deepseek-chat";

  constructor() {
    this.openai = new OpenAI({
      baseURL: 'https://api.deepseek.com/v1',
      apiKey: process.env.DEEPSEEK_API_KEY || ''
    });
  }

  public async analyze(userText: string, signal?: AbortSignal): Promise<IntentAnalyzerResponse> {
    const fallback: IntentAnalyzerResponse = {
      intent: "normativa_lookup",
      required_scopes: ["municipal"],
      required_categories: ["urbanismo_general"],
      needs_context: true,
      needs_sources: true,
      extracted_parameters: {}
    };

    try {
      const systemPrompt = `Eres el Analizador de Intenciones de UrbanBrain (un sistema de expedientes urbanísticos).
Tu tarea es analizar la petición del usuario y devolver un JSON estricto con esta estructura:

{
  "intent": "normativa_lookup" | "calculation_request" | "document_generation" | "context_update" | "general_question",
  "required_scopes": array con cero o más de ["municipal", "autonomico", "estatal", "especial", "expediente"],
  "required_categories": array con cero o más de ["CTE", "NHG", "PXOM", "ordenanza", "patrimonio", "costas", "carreteras", "augas", "accesibilidad", "incendios", "habitabilidad", "urbanismo_general"],
  "needs_context": boolean (true si necesitas saber los datos de la parcela como municipio, clasificación, calificación),
  "needs_sources": boolean (true si la respuesta requiere consultar la ley escrita),
  "extracted_parameters": objeto JSON libre con datos clave (ej: {"operacion": "ocupacion"})
}

Responde ÚNICAMENTE con el JSON válido. Sin markdown, sin explicaciones.`;

      const completion = await this.openai.chat.completions.create({
        model: this.modelName,
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userText }
        ],
        temperature: 0.1,
        response_format: { type: "json_object" }
      }, { signal });

      const responseText = completion.choices[0].message.content || '{}';
      const parsed = JSON.parse(responseText);

      return {
        intent: parsed.intent as IntentType,
        required_scopes: parsed.required_scopes as ScopeType[],
        required_categories: parsed.required_categories as CategoryType[],
        needs_context: Boolean(parsed.needs_context),
        needs_sources: Boolean(parsed.needs_sources),
        extracted_parameters: parsed.extracted_parameters || {}
      };

    } catch {
      return fallback;
    }
  }
}
