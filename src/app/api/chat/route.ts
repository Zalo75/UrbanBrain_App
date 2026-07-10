import { NextRequest, NextResponse } from 'next/server';
import { GoogleGenerativeAI, TaskType } from '@google/generative-ai';
import { createClient } from '@supabase/supabase-js';
import OpenAI from 'openai';
import { db } from '@/infrastructure/db/client';
import { chatMessages } from '@/infrastructure/db/schema';
import { authProvider } from '@/infrastructure/auth';

// Init Gemini
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY!);

// Init DeepSeek via OpenAI SDK
const openai = new OpenAI({
  baseURL: 'https://api.deepseek.com/v1',
  apiKey: process.env.DEEPSEEK_API_KEY!,
});

// Init Supabase (Service Role)
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const supabase = createClient(supabaseUrl, supabaseKey);

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    let { message, municipio, expedienteId } = body;

    municipio = municipio?.trim() || '';
    if (municipio === 'oza_cesuras') {
      municipio = 'Oza-Cesuras';
    }

    if (!expedienteId) {
      return NextResponse.json({ error: 'expedienteId is required' }, { status: 400 });
    }

    let userId = await authProvider.getUserId();

    if (!userId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    if (!message) {
      return NextResponse.json({ error: 'Message is required' }, { status: 400 });
    }

    if (!municipio) {
      return NextResponse.json({
        answer:
          'Necesito saber el municipio/concello del expediente para responder con seguridad jurídica.',
        sources: [],
      });
    }

    // Guardar mensaje del usuario
    await db.insert(chatMessages).values({
      expedienteId,
      userId,
      role: 'user',
      content: message,
    });

    // --- SPRINT 3: Integración del Knowledge Orchestrator ---
    let plan;
    try {
      const { QuestionAnalyzer } = await import('@/application/intent-engine/QuestionAnalyzer');
      const { KnowledgeOrchestrator } =
        await import('@/application/knowledge-orchestrator/KnowledgeOrchestrator');
      const { expedienteNormativeContext } = await import('@/infrastructure/db/schema');
      const { eq } = await import('drizzle-orm');

      const analyzer = new QuestionAnalyzer();
      const analysis = await analyzer.analyze(message);

      // Obtener contexto existente sin invocar de nuevo el motor
      const existingContext = await db
        .select()
        .from(expedienteNormativeContext)
        .where(eq(expedienteNormativeContext.expedienteId, expedienteId));

      const orchestrator = new KnowledgeOrchestrator();
      plan = await orchestrator.generatePlan({
        expedienteId,
        userMessage: message,
        questionAnalysis: analysis,
        existingContext,
      });
    } catch (orchestratorError) {
      console.error('[KnowledgeOrchestrator] Error en la orquestación:', orchestratorError);
      // Fallback a V1 if error
      plan = { corpus: 'v1' };
    }
    // --------------------------------------------------------
    // Generar embedding con Gemini
    // El modelo disponible es 'gemini-embedding-001'
    const embeddingModel = genAI.getGenerativeModel({ model: 'gemini-embedding-001' });

    const embeddingResult = await embeddingModel.embedContent({
      content: { role: 'user', parts: [{ text: message }] },
      taskType: TaskType.RETRIEVAL_QUERY,
    });

    const rawEmbedding = Array.from(embeddingResult.embedding.values);

    if (rawEmbedding.length < 768) {
      console.error('Embedding too short:', rawEmbedding.length);
      return NextResponse.json(
        { error: `Embedding too short: ${rawEmbedding.length}` },
        { status: 500 }
      );
    }

    const query_embedding = rawEmbedding.slice(0, 768);

    console.log('Embedding dimensions:', {
      original: rawEmbedding.length,
      used: query_embedding.length,
    });

    // Llamar a Supabase RPC match_normativa_chunks (V1)
    const t0_v1 = performance.now();
    const { data: chunks, error: rpcError } = await supabase.rpc('match_normativa_chunks', {
      query_embedding,
      match_count: 8,
      filter_municipio: municipio,
    });
    const t1_v1 = performance.now();
    const v1_time_ms = Math.round(t1_v1 - t0_v1);

    if (rpcError) {
      console.error('Supabase RPC error:', rpcError);
      return NextResponse.json({ error: 'Error querying database' }, { status: 500 });
    }

    const safeChunks = chunks || [];
    const normalizedMunicipio = municipio.toLowerCase();
    const filteredChunks = safeChunks.filter(
      (c: any) => (c.municipio_nombre || '').toLowerCase().trim() === normalizedMunicipio
    );

    // --- SPRINT 3.12: Laboratorio CTE V2 ---
    let v2FinalContext = '';
    let usedV2 = false;
    let fallbackReason = '';
    let v2_time_ms = 0;
    let v2LLMTime = 0;
    let top3Citas = '';
    let v2Citas = '';
    let v2Results: any[] = [];

    if (process.env.KNOWLEDGE_ENGINE === 'v2') {
      try {
        const { searchNormativeV2 } = await import('@/application/knowledge-engine/searchNormativeV2');

        const t0_v2 = performance.now();
        const v2Promise = searchNormativeV2({
          query_embedding,
          scopes: plan?.scopes || [],
          categories: plan?.categories || [],
          documentCodes: plan?.documentCodes || [],
          limit: 8,
        });

        const timeoutPromise = new Promise<any[]>((_, reject) => setTimeout(() => reject(new Error('Timeout')), 3000));
        v2Results = await Promise.race([v2Promise, timeoutPromise]);
        v2_time_ms = Math.round(performance.now() - t0_v2);

        // Validation for V2 usage
        const CTE_V2_MIN_SIMILARITY = process.env.CTE_V2_MIN_SIMILARITY ? parseFloat(process.env.CTE_V2_MIN_SIMILARITY) : 0.65;
        const validDBs = ['DB-SE', 'DB-SI', 'DB-SUA', 'DB-HS', 'DB-HE', 'DB-HR'];

        const hasCTECategory = plan?.categories?.includes('CTE');
        const hasValidDBCode = plan?.documentCodes?.some(code => validDBs.includes(code));
        const isDBAmbiguous = !plan?.documentCodes || plan.documentCodes.length === 0;

        if (process.env.ENABLE_CTE_V2_RESPONSES !== 'true') {
          fallbackReason = 'Feature flag desactivado';
        } else if (!hasCTECategory) {
          fallbackReason = 'Consulta no categorizada como CTE';
        } else if (isDBAmbiguous || !hasValidDBCode) {
          fallbackReason = 'DocumentCodes ambiguo o inválido';
        } else if (v2Results.length === 0) {
          fallbackReason = 'Cero resultados V2';
        } else if (v2Results[0].similarity < CTE_V2_MIN_SIMILARITY) {
          fallbackReason = `Similitud insuficiente (${v2Results[0].similarity.toFixed(4)} < ${CTE_V2_MIN_SIMILARITY})`;
        } else {
          // Success! Build V2 Context
          usedV2 = true;

          // Filter valid chunks above threshold, matching the plan's documentCodes, and MUST have sourceUrl
          let validChunks = v2Results.filter(r => r.similarity >= CTE_V2_MIN_SIMILARITY && r.sourceUrl);
          // Limit to Top 5
          validChunks = validChunks.slice(0, 5);

          if (validChunks.length === 0) {
             usedV2 = false;
             fallbackReason = 'Cero resultados V2 tras filtro estricto (similitud o falta URL oficial)';
          } else {
            v2FinalContext = 'NORMATIVA APLICABLE (CTE):\n\n';
            let cIndex = 1;

            // Collect unique chunks
            const seenContent = new Set<string>();

            for (const r of validChunks) {
              if (seenContent.has(r.content)) continue;
              seenContent.add(r.content);

              let citaParts = [`CTE ${r.title?.split(' - ')[0] || ''}`];
              if (r.chapter) citaParts.push(`Capítulo ${r.chapter}`);
              if (r.article) citaParts.push(`apartado ${r.article}`);
              citaParts.push(`página ${r.page}`);
              const citaString = citaParts.join(', ');

              v2FinalContext += `[Fuente ${cIndex}]\n`;
              v2FinalContext += `Documento: ${r.title}\n`;
              v2FinalContext += `Identificador Oficial: ${r.officialIdentifier || 'N/A'}\n`;
              v2FinalContext += `Versión: ${r.version || 'N/A'}\n`;
              v2FinalContext += `Sección/Capítulo: ${r.chapter || 'N/A'}\n`;
              v2FinalContext += `Apartado: ${r.article || 'N/A'}\n`;
              v2FinalContext += `Páginas: ${r.page || 'N/A'}\n`;
              v2FinalContext += `URL Oficial: ${r.sourceUrl}\n`;
              v2FinalContext += `Fragmento:\n${r.content}\n\n`;

              v2Citas += `- ${citaString}. Fuente oficial: ${r.sourceUrl}\n`;
              cIndex++;
            }
          }
        }
      } catch (err) {
        fallbackReason = `V2 Exception: ${(err as Error).message}`;
        usedV2 = false;
      }
    }
    // ----------------------------------

    if (!usedV2 && filteredChunks.length === 0) {
      return NextResponse.json({
        answer: 'No he encontrado información suficiente en la normativa del municipio seleccionado.',
        sources: [],
      });
    }

    // Construir contexto
    let contextText = '';
    let systemPrompt = '';

    if (usedV2) {
      contextText = v2FinalContext;
      systemPrompt = `Eres UrbanBrain, asistente urbanístico. Responde únicamente a partir de los fragmentos suministrados.
No inventes requisitos, cifras ni apartados.

Reglas:
1. Diferencia entre exigencia normativa, interpretación técnica, e información insuficiente.
2. Cita cada afirmación relevante usando los corchetes provistos [Fuente 1], [Fuente 2].
3. Si los fragmentos no permiten responder la pregunta de forma completa, dilo expresamente. No completes con conocimiento general.
4. No presentes tu interpretación como si fuese texto literal de la norma.
5. Advierte al usuario cuando la respuesta pueda depender además de normativa autonómica o municipal.

FORMATO DE RESPUESTA REQUERIDO:

CONCLUSIÓN
[Respuesta clara y directa]

FUNDAMENTO NORMATIVO
[Explicación basada en los fragmentos recuperados, citando las fuentes con corchetes]

FUENTES
[Lista de las fuentes utilizadas en formato: - CTE DB-XX, Capítulo X, apartado Y, página Z. Fuente oficial: URL]`;
    } else {
      contextText += '\n[NORMATIVA MUNICIPAL - ' + municipio + ']\n';
      filteredChunks.forEach((c: any, index: number) => {
        const sourceNum = index + 1;
        contextText += `[Fuente ${sourceNum}]\n`;
        contextText += `Municipio: ${c.municipio_nombre || municipio}\n`;
        contextText += `Documento: ${c.nombre_pdf || 'Desconocido'}\n`;
        contextText += `Título detectado: ${c.titulo_detectado || 'N/A'}\n`;
        contextText += `Texto:\n${c.texto}\n\n`;
      });

      systemPrompt = `Eres UrbanBrain, asistente urbanístico. Responde únicamente usando el contexto proporcionado. Si el contexto no contiene información suficiente, dilo claramente. Cita las fuentes usando exactamente el formato de corchetes proporcionado, por ejemplo: [Fuente 1], [Fuente 2]. No inventes normativa.

CONTEXTO RECUPERADO:
${contextText}`;
    }

    // Logging for CTE V2 Response Mode
    if (process.env.KNOWLEDGE_ENGINE === 'v2') {
      console.log(`\n========== CTE V2 RESPONSE MODE ==========
Pregunta: ${message}
Feature flag: ${process.env.ENABLE_CTE_V2_RESPONSES || 'false'}
DocumentCodes: ${plan?.documentCodes?.join(', ') || 'Ninguno'}
Chunks recuperados: ${v2Results?.length || 0}
Chunks válidos por umbral: ${usedV2 ? (v2FinalContext.match(/\[Fuente \d+\]/g) || []).length : 0}
Similitud Top 1: ${v2Results && v2Results.length > 0 ? v2Results[0].similarity.toFixed(4) : 'N/A'}
Fuente de respuesta visible:
- ${usedV2 ? 'V2_CTE' : 'V1_FALLBACK'}

Motivo: ${usedV2 ? 'Condiciones V2 superadas' : fallbackReason}
Tiempo búsqueda: ${usedV2 ? v2_time_ms : v1_time_ms}ms
Citas generadas:
${usedV2 ? v2Citas : 'N/A'}
==========================================\n`);
    }

    const t0_llm = performance.now();
    const completion = await openai.chat.completions.create({
      model: 'deepseek-chat',
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: usedV2 ? `CONTEXTO RECUPERADO:\n${contextText}\n\nPregunta: ${message}` : message },
      ],
      temperature: 0.1,
    });
    const t1_llm = performance.now();
    v2LLMTime = Math.round(t1_llm - t0_llm);

    if (usedV2 && process.env.KNOWLEDGE_ENGINE === 'v2') {
       console.log(`Tiempo LLM (V2): ${v2LLMTime}ms\n`);
    }

    const answer = completion.choices[0].message.content || '';

    // Devolver JSON
    const sources = filteredChunks.map((c: any, index: number) => ({
      chunk_id: c.chunk_id,
      municipio_nombre: c.municipio_nombre || municipio,
      nombre_pdf: c.nombre_pdf || 'Documento',
      titulo_detectado: c.titulo_detectado || '',
      similarity: c.similarity,
      source_index: index + 1,
      original_path: c.original_path || '',
      pagina_detectada: c.pagina_detectada || null,
      fragmento_corto: c.fragmento_corto || '',
    }));

    // Guardar mensaje de la IA
    await db.insert(chatMessages).values({
      expedienteId,
      userId,
      role: 'assistant',
      content: answer,
      sources,
    });

    return NextResponse.json({
      answer,
      sources,
    });
  } catch (error) {
    console.error('Error in /api/chat:', error);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}
