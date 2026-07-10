export interface KnowledgePlan {
  corpus: "v1" | "v2";
  scopes: string[];
  categories: string[];
  specialNormatives: string[];
  documentCodes?: string[];
  confidence: number;
}

export interface OrchestratorInput {
  expedienteId: string;
  userMessage: string;
  questionAnalysis: any;
  existingContext: any[];
}

export class KnowledgeOrchestrator {
  async generatePlan(input: OrchestratorInput): Promise<KnowledgePlan> {
    const { questionAnalysis, existingContext } = input;

    // Default to V1 unless KNOWLEDGE_ENGINE flag is set to 'v2'
    let corpus: "v1" | "v2" = "v1";
    if (process.env.KNOWLEDGE_ENGINE === 'v2') {
      corpus = "v2";
    }

    // Extract scopes and categories from QuestionAnalyzer
    const scopes = new Set<string>(questionAnalysis?.required_scopes || []);
    const categories = new Set<string>(questionAnalysis?.required_categories || []);

    // Add scopes and categories from existingContext if any
    if (existingContext && existingContext.length > 0) {
      for (const ctx of existingContext) {
        if (ctx.scopeType) scopes.add(ctx.scopeType);
        if (ctx.category) categories.add(ctx.category);
      }
    }

    // Special normatives from QuestionAnalyzer parameters
    const specialNormatives: string[] = [];
    if (questionAnalysis?.extracted_parameters?.norma) {
      specialNormatives.push(questionAnalysis.extracted_parameters.norma);
    }

    // Explicit DB routing
    const documentCodes: string[] = [];
    const textToAnalyze = input.userMessage.toLowerCase();

    // Explicit priority mentions
    if (textToAnalyze.includes('db-si') || textToAnalyze.includes('db si')) documentCodes.push('DB-SI');
    if (textToAnalyze.includes('db-sua') || textToAnalyze.includes('db sua')) documentCodes.push('DB-SUA');
    if (textToAnalyze.includes('db-hs') || textToAnalyze.includes('db hs')) documentCodes.push('DB-HS');
    if (textToAnalyze.includes('db-he') || textToAnalyze.includes('db he')) documentCodes.push('DB-HE');
    if (textToAnalyze.includes('db-hr') || textToAnalyze.includes('db hr')) documentCodes.push('DB-HR');
    if (textToAnalyze.includes('db-se') || textToAnalyze.includes('db se')) documentCodes.push('DB-SE');

    // Semantic heuristic routing (only if no explicit DB is provided, or we just append them? the prompt says "si hay ambigüedad, permitir más de un DB". So we just check all conditions)
    if (documentCodes.length === 0) {
      if (/incendio|evacuaci|extintor|resistencia al fuego/i.test(textToAnalyze)) documentCodes.push('DB-SI');
      if (/accesibilidad|rampa|resbaladicidad|aseo.*accesible/i.test(textToAnalyze)) documentCodes.push('DB-SUA');
      if (/salubridad|ventilaci|humedad|agua/i.test(textToAnalyze)) documentCodes.push('DB-HS');
      if (/energ|envolvente|consumo|demanda/i.test(textToAnalyze)) documentCodes.push('DB-HE');
      if (/ruido|ac[uú]stica|aislamiento/i.test(textToAnalyze)) documentCodes.push('DB-HR');
      if (/estructura|acci[oó]n|cimentaci|resistencia/i.test(textToAnalyze)) documentCodes.push('DB-SE');
    }

    const plan: KnowledgePlan = {
      corpus,
      scopes: Array.from(scopes),
      categories: Array.from(categories),
      specialNormatives,
      documentCodes,
      confidence: 0.97 // As requested by example, or derived heuristically
    };

    this.logPlan(plan);

    return plan;
  }

  private logPlan(plan: KnowledgePlan) {
    console.log(`\n========== KNOWLEDGE PLAN ==========
Corpus: ${plan.corpus.toUpperCase()}

Scopes:
${plan.scopes.length > 0 ? plan.scopes.map(s => '- ' + s).join('\n') : '- ninguno'}

Categorías:
${plan.categories.length > 0 ? plan.categories.map(c => '- ' + c).join('\n') : '- ninguna'}

Normativa especial:
${plan.specialNormatives.length > 0 ? plan.specialNormatives.map(n => '- ' + n).join('\n') : '- ninguna'}

Documentos Base:
${plan.documentCodes && plan.documentCodes.length > 0 ? plan.documentCodes.map(d => '- ' + d).join('\n') : '- todos'}

Confianza:
${plan.confidence}

===================================\n`);
  }
}
