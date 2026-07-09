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

    municipio = municipio?.trim() || "";
    if (municipio === 'oza_cesuras') {
      municipio = 'Oza-Cesuras';
    }

    if (!expedienteId) {
      return NextResponse.json({ error: 'expedienteId is required' }, { status: 400 });
    }

    let userId = await authProvider.getUserId();
    userId = "af97677f-8ee6-4a3d-82a0-b907c6010957";
    
    if (!userId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    if (!message) {
      return NextResponse.json({ error: 'Message is required' }, { status: 400 });
    }

    if (!municipio) {
      return NextResponse.json({
        answer: "Necesito saber el municipio/concello del expediente para responder con seguridad jurídica.",
        sources: []
      });
    }

    // Guardar mensaje del usuario
    await db.insert(chatMessages).values({
      expedienteId,
      userId,
      role: 'user',
      content: message,
    });

    // Generar embedding con Gemini
    // El modelo disponible es 'gemini-embedding-001'
    const embeddingModel = genAI.getGenerativeModel({ model: 'gemini-embedding-001' });
    
    const embeddingResult = await embeddingModel.embedContent({
      content: { role: 'user', parts: [{ text: message }] },
      taskType: TaskType.RETRIEVAL_QUERY,
    });
    
    const rawEmbedding = Array.from(embeddingResult.embedding.values);

    if (rawEmbedding.length < 768) {
      console.error("Embedding too short:", rawEmbedding.length);
      return NextResponse.json(
        { error: `Embedding too short: ${rawEmbedding.length}` },
        { status: 500 }
      );
    }

    const query_embedding = rawEmbedding.slice(0, 768);

    console.log("Embedding dimensions:", {
      original: rawEmbedding.length,
      used: query_embedding.length
    });

    // Llamar a Supabase RPC match_normativa_chunks
    const { data: chunks, error: rpcError } = await supabase.rpc('match_normativa_chunks', {
      query_embedding,
      match_count: 8,
      filter_municipio: municipio
    });

    if (rpcError) {
      console.error("Supabase RPC error:", rpcError);
      return NextResponse.json({ error: 'Error querying database' }, { status: 500 });
    }

    const safeChunks = chunks || [];

    console.log({ 
      expedienteId, 
      municipioRecibido: municipio, 
      municipiosDevueltos: safeChunks.map((c:any) => c.municipio_nombre) 
    });

    const normalizedMunicipio = municipio.toLowerCase();

    const filteredChunks = safeChunks.filter((c: any) =>
      (c.municipio_nombre || '').toLowerCase().trim() === normalizedMunicipio
    );

    if (filteredChunks.length === 0) {
      return NextResponse.json({
        answer: "No he encontrado información suficiente en la normativa del municipio seleccionado.",
        sources: []
      });
    }

    // Construir contexto
    let contextText = "";
    
    contextText += "\n[NORMATIVA MUNICIPAL - " + municipio + "]\n";
    filteredChunks.forEach((c: any, index: number) => {
      const sourceNum = index + 1;
      contextText += `[Fuente ${sourceNum}]\n`;
      contextText += `Municipio: ${c.municipio_nombre || municipio}\n`;
      contextText += `Documento: ${c.nombre_pdf || 'Desconocido'}\n`;
      contextText += `Título detectado: ${c.titulo_detectado || 'N/A'}\n`;
      contextText += `Texto:\n${c.texto}\n\n`;
    });

    // Enviar a DeepSeek
    const systemPrompt = `Eres UrbanBrain, asistente urbanístico. Responde únicamente usando el contexto proporcionado. Si el contexto no contiene información suficiente, dilo claramente. Cita las fuentes usando exactamente el formato de corchetes proporcionado, por ejemplo: [Fuente 1], [Fuente 2]. No inventes normativa.

CONTEXTO RECUPERADO:
${contextText}`;

    const completion = await openai.chat.completions.create({
      model: "deepseek-chat",
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: message }
      ],
      temperature: 0.1,
    });

    const answer = completion.choices[0].message.content || "";

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
      fragmento_corto: c.fragmento_corto || ''
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
      sources
    });

  } catch (error) {
    console.error("Error in /api/chat:", error);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}
