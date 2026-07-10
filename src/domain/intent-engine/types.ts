export type IntentType = "normativa_lookup" | "calculation_request" | "document_generation" | "context_update" | "general_question";
export type ScopeType = "municipal" | "autonomico" | "estatal" | "especial" | "expediente";
export type CategoryType = "CTE" | "NHG" | "PXOM" | "ordenanza" | "patrimonio" | "costas" | "carreteras" | "augas" | "accesibilidad" | "incendios" | "habitabilidad" | "urbanismo_general";

export interface IntentAnalyzerResponse {
  intent: IntentType;
  required_scopes: ScopeType[];
  required_categories: CategoryType[];
  needs_context: boolean;
  needs_sources: boolean;
  extracted_parameters: Record<string, any>;
}
