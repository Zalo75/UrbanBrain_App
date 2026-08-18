import * as dotenv from 'dotenv';
import path from 'path';

// Load environment variables for local testing
dotenv.config({ path: path.resolve(__dirname, '../.env') });

// Force variables for the smoke test
process.env.URBANBRAIN_REASONER_PROVIDER = 'openai';
process.env.URBANBRAIN_OPENAI_REASONER_MODEL = 'gpt-5.6-luna';
process.env.URBANBRAIN_OPENAI_REASONING_EFFORT = 'medium';

import { getReasonerProvider, type ReasonerRequest } from '../src/application/chat/reasonerProvider';

async function runSmokeTest() {
  console.log('==================================================');
  console.log('SMOKE TEST: gpt-5.6-luna con Responses API');
  console.log('==================================================\n');

  const provider = getReasonerProvider();
  console.log(`Provider instance: ${provider.constructor.name}`);

  const systemPrompt = `
EVALUADOR URBANÍSTICO
Eres un experto. Responde en JSON que cumpla el schema proporcionado.

Requisitos estrictos de salida (ReasonerOutput):
1. answerMode (string)
2. claims (array de objetos con id, type, text, sourceRefs, appliesToParcel, numericTokens)
3. missingFacts (array de strings)

Instrucción: Genera un claim muy simple de tipo 'limitation'.
  `.trim();

  const userPrompt = `
Genera un limitation claim sobre una parcela genérica.
  `.trim();

  const request: ReasonerRequest = {
    systemPrompt,
    userPrompt,
    timeoutMs: 30000,
  };

  try {
    const result = await provider.generate(request);
    
    console.log('▶ LLAMADA EXITOSA');
    console.log(`- HTTP/API Success: YES`);
    console.log(`- Modelo utilizado: ${result.model}`);
    console.log(`- Input Tokens: ${result.inputTokens ?? 'N/A'}`);
    console.log(`- Cached Input Tokens: ${result.cachedInputTokens ?? 'N/A'}`);
    console.log(`- Output Tokens: ${result.outputTokens ?? 'N/A'}`);
    console.log(`- Reasoning Tokens: ${result.reasoningTokens ?? 'N/A'}`);
    console.log(`- Total Tokens: ${result.totalTokens ?? 'N/A'}`);
    console.log(`- Latency: ${result.latencyMs}ms`);

    let parsed = null;
    try {
      parsed = JSON.parse(result.rawContent);
    } catch (e) {
      console.log(`- Respuesta parseada: NO (invalid JSON)`);
      console.log('Raw output:', result.rawContent);
      return;
    }

    if (parsed && parsed.claims && parsed.answerMode) {
      console.log(`- Respuesta parseada: SÍ`);
      console.log(JSON.stringify(parsed, null, 2));
    } else {
      console.log(`- Respuesta parseada: NO (faltan campos)`);
      console.log(JSON.stringify(parsed, null, 2));
    }

  } catch (e: any) {
    console.error('▶ FALLO EN LA LLAMADA API');
    console.error(`- HTTP/API Success: NO`);
    console.error(e.message);
  }
}

runSmokeTest().catch(console.error);
