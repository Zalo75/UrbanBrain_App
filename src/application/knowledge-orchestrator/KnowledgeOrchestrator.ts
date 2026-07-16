export interface KnowledgePlan {
  corpus: 'v1' | 'v2'
  scopes: string[]
  categories: string[]
  specialNormatives: string[]
  documentCodes?: string[]
  confidence: number
}

export interface OrchestratorInput {
  expedienteId: string
  userMessage: string
  questionAnalysis?: {
    required_scopes?: string[]
    required_categories?: string[]
    extracted_parameters?: { norma?: string }
  }
  existingContext: Array<{ scopeType?: string; category?: string }>
}

export class KnowledgeOrchestrator {
  async generatePlan(input: OrchestratorInput): Promise<KnowledgePlan> {
    const { questionAnalysis, existingContext } = input
    const corpus: 'v1' | 'v2' = process.env.KNOWLEDGE_ENGINE === 'v2' ? 'v2' : 'v1'
    const scopes = new Set(questionAnalysis?.required_scopes ?? [])
    const categories = new Set(questionAnalysis?.required_categories ?? [])

    for (const context of existingContext) {
      if (context.scopeType) scopes.add(context.scopeType)
      if (context.category) categories.add(context.category)
    }

    const specialNormatives = questionAnalysis?.extracted_parameters?.norma
      ? [questionAnalysis.extracted_parameters.norma]
      : []
    const documentCodes: string[] = []
    const textToAnalyze = input.userMessage.toLowerCase()

    if (textToAnalyze.includes('db-si') || textToAnalyze.includes('db si')) documentCodes.push('DB-SI')
    if (textToAnalyze.includes('db-sua') || textToAnalyze.includes('db sua')) documentCodes.push('DB-SUA')
    if (textToAnalyze.includes('db-hs') || textToAnalyze.includes('db hs')) documentCodes.push('DB-HS')
    if (textToAnalyze.includes('db-he') || textToAnalyze.includes('db he')) documentCodes.push('DB-HE')
    if (textToAnalyze.includes('db-hr') || textToAnalyze.includes('db hr')) documentCodes.push('DB-HR')
    if (textToAnalyze.includes('db-se') || textToAnalyze.includes('db se')) documentCodes.push('DB-SE')

    if (documentCodes.length === 0) {
      if (/incendio|evacuaci|extintor|resistencia al fuego/i.test(textToAnalyze)) documentCodes.push('DB-SI')
      if (/accesibilidad|rampa|resbaladicidad|aseo.*accesible/i.test(textToAnalyze)) documentCodes.push('DB-SUA')
      if (/salubridad|ventilaci|humedad|agua/i.test(textToAnalyze)) documentCodes.push('DB-HS')
      if (/energ|envolvente|consumo|demanda/i.test(textToAnalyze)) documentCodes.push('DB-HE')
      if (/ruido|ac[uú]stica|aislamiento/i.test(textToAnalyze)) documentCodes.push('DB-HR')
      if (/estructura|acci[oó]n|cimentaci|resistencia/i.test(textToAnalyze)) documentCodes.push('DB-SE')
    }

    return {
      corpus,
      scopes: Array.from(scopes),
      categories: Array.from(categories),
      specialNormatives,
      documentCodes,
      confidence: 0.97,
    }
  }
}
