import * as dotenv from 'dotenv';
import path from 'path';

// Load environment variables for local testing
dotenv.config({ path: path.resolve(__dirname, '../.env.local') });

import { DeepSeekReasonerProvider, OpenAIReasonerProvider, type ReasonerRequest } from '../src/application/chat/reasonerProvider';
import { parseReasonerOutput, validateReasonerOutput } from '../src/application/parcel-context/responseSafety';

async function runHarness() {
  console.log('==================================================');
  console.log('URBANBRAIN REASONER A/B HARNESS');
  console.log('==================================================\n');

  if (!process.env.DEEPSEEK_API_KEY) {
    console.warn('⚠️ DEEPSEEK_API_KEY no encontrada. DeepSeek fallará.');
  }
  if (!process.env.OPENAI_API_KEY) {
    console.warn('⚠️ OPENAI_API_KEY no encontrada. OpenAI fallará.');
  }

  const systemPrompt = `
EVALUADOR URBANÍSTICO
Eres un experto. Responde en JSON.

OUTPUT JSON REQUERIDO:
{
  "answerMode": "definitive" | "conditional" | "partial" | "abstain",
  "claims": [
    {
      "id": "string",
      "type": "territorial_fact" | "normative_fact" | "normative_conditional" | "limitation",
      "text": "string (la afirmación)",
      "sourceRefs": [1, 2],
      "appliesToParcel": true | false | "conditional" | "unknown",
      "numericTokens": ["5", "10", "300"]
    }
  ],
  "missingFacts": ["string (datos pendientes)"]
}
  `.trim();

  const userPrompt = `
CONTEXTO RECUPERADO:
[Fuente 1] "En suelo rústico ordinario el retranqueo mínimo a linderos será de 5 metros."

Pregunta: ¿Cuánto retranqueo debo dejar?
  `.trim();

  const request: ReasonerRequest = {
    systemPrompt,
    userPrompt,
    timeoutMs: 30000,
  };

  const providerConstructors = [
    DeepSeekReasonerProvider,
    OpenAIReasonerProvider // Relies on URBANBRAIN_OPENAI_REASONER_MODEL or defaults to gpt-4o
  ];

  for (const ProviderClass of providerConstructors) {
    console.log(`\n▶ Evaluando Provider: ${ProviderClass.name}`);
    try {
      const provider = new ProviderClass();
      const result = await provider.generate(request);
      
      console.log('  Métricas de ejecución:');
      console.log(`  - Modelo: ${result.model}`);
      console.log(`  - Latencia: ${result.latencyMs}ms`);
      console.log(`  - Input Tokens: ${result.inputTokens ?? 'N/A'} (Cached: ${result.cachedInputTokens ?? 'N/A'})`);
      console.log(`  - Output Tokens: ${result.outputTokens ?? 'N/A'} (Reasoning: ${result.reasoningTokens ?? 'N/A'})`);
      console.log(`  - Total Tokens: ${result.totalTokens ?? 'N/A'}`);

      // Validar salida
      const parsed = parseReasonerOutput(result.rawContent);
      if (!parsed) {
        console.error('  ❌ Fallo crítico de parsing JSON.');
        console.log(`Raw output: ${result.rawContent}`);
        continue;
      }

      const validation = validateReasonerOutput(parsed, ['1']);
      
      console.log('\n  Resultados de validación:');
      console.log(`  - reasonerClaimCount: ${validation.reasonerClaimCount}`);
      console.log(`  - validClaimCount: ${validation.validClaimCount}`);
      console.log(`  - invalidClaimCount: ${validation.invalidClaimCount}`);
      
      console.log('\n  Claims Válidos:');
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      validation.validClaims.forEach((c: any) => {
        console.log(`  * [${c.type}] ${c.text} (Aplica: ${c.appliesToParcel})`);
      });

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } catch (e: any) {
      console.error(`  ❌ Error durante la evaluación de ${provider.constructor.name}:`, e.message);
    }
  }

  console.log('\n==================================================');
  console.log('HARNESS COMPLETADO');
  console.log('==================================================\n');
}

runHarness().catch(console.error);
