import fs from 'fs';
import readline from 'readline';
import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
import path from 'path';
import {
  addChunkQualityResult,
  createChunkQualityStatistics,
  evaluateChunkTextQuality,
} from '../src/application/document-processing/chunkTextQuality';

dotenv.config({ path: path.resolve(process.cwd(), '.env') });

// Define expected structure of BM25 JSONL
interface BM25Chunk {
  i: number;
  chunk_id: string;
  sha256: string;
  nombre_pdf: string;
  ruta_pdf: string;
  municipio_codigo: string;
  municipio_nombre: string;
  expediente: string;
  tipo_chunk: string;
  titulo_detectado: string;
  caracteres: number;
  texto: string;
  len_tokens: number;
}

// Config for pilot
const CORPUS_FILE = 'D:\\Agente Normativas\\CORPUS_RAG\\INDICE_LOCAL_BM25\\docs_bm25.jsonl';
const TARGET_MUNICIPALITY = 'Cambre';
const BATCH_ID = 'pilot_cambre_nhg_cte_v1';

// DRY_RUN flag from args, defaults to true
const DRY_RUN = process.argv.includes('--run') ? false : true;

// Initialize Supabase Client with Service Role
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

if (!DRY_RUN && (!supabaseUrl || !supabaseServiceKey)) {
  console.error("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env.local");
  process.exit(1);
}

const supabase = createClient(supabaseUrl || 'http://dummy', supabaseServiceKey || 'dummy');

// Helper to determine scope and source based on metadata
function parseMetadata(chunk: BM25Chunk) {
  let scopeType = 'manual';
  let sourceSystem = 'manual';
  let ccaa = null;

  const ruta = chunk.ruta_pdf || '';
  const nombre = chunk.nombre_pdf || '';
  const muni_codigo = chunk.municipio_codigo || '';
  const muni_nombre = chunk.municipio_nombre || '';

  if (ruta.includes('\\Normativas Nacionales\\CTE\\') || nombre.includes('CTE_DB')) {
    scopeType = 'estatal';
    sourceSystem = 'CTE';
  } else if (
    nombre.includes('NHV') || 
    nombre.includes('NHG') || 
    ruta.includes('Habitabilidad') || 
    ruta.includes('Habitabilidade') || 
    ruta.includes('Normas do Habitat') || 
    ruta.includes('Normas de Habitabilidade')
  ) {
    scopeType = 'autonomico';
    sourceSystem = 'NHG';
    ccaa = 'Galicia';
  } else if (muni_codigo === '15017' || muni_nombre.includes(TARGET_MUNICIPALITY) || ruta.includes(TARGET_MUNICIPALITY)) {
    scopeType = 'municipal';
    sourceSystem = 'SIOTUGA'; 
    ccaa = 'Galicia';
  }
  
  return { scopeType, sourceSystem, ccaa };
}

async function run() {
  console.log(`Starting corpus pilot import...`);
  console.log(`DRY_RUN: ${DRY_RUN} (use --run to execute real insertion)`);
  
  const fileStream = fs.createReadStream(CORPUS_FILE);
  const rl = readline.createInterface({
    input: fileStream,
    crlfDelay: Infinity
  });

  const documentsMap = new Map<string, Record<string, unknown>>();
  const chunksToImport: Record<string, unknown>[] = [];
  let qualityStatistics = createChunkQualityStatistics();
  
  for await (const line of rl) {
    if (!line.trim()) continue;
    
    try {
      const chunk = JSON.parse(line) as BM25Chunk;
      const { scopeType, sourceSystem, ccaa } = parseMetadata(chunk);
      
      if (scopeType === 'manual') continue;

      const quality = evaluateChunkTextQuality({
        text: chunk.texto ?? '',
        chunkType: chunk.tipo_chunk,
      });
      qualityStatistics = addChunkQualityResult(qualityStatistics, quality);
      if (!quality.eligible) continue;

      if (!documentsMap.has(chunk.sha256)) {
        documentsMap.set(chunk.sha256, {
          source_id: chunk.sha256,
          title: chunk.nombre_pdf,
          original_path: chunk.ruta_pdf,
          scope_type: scopeType,
          ccaa: ccaa,
          province: scopeType === 'municipal' ? 'A Coruña' : null,
          municipality_id: chunk.municipio_codigo || (scopeType === 'municipal' ? '15017' : null),
          municipality_name: chunk.municipio_nombre || (scopeType === 'municipal' ? TARGET_MUNICIPALITY : null),
          document_type: 'normativa',
          source_system: sourceSystem,
        });
      }

      chunksToImport.push({
        source_id: chunk.sha256, 
        content: chunk.texto,
        metadata: {
          tipo_chunk: chunk.tipo_chunk,
          titulo_detectado: chunk.titulo_detectado,
          caracteres: chunk.caracteres,
          len_tokens: chunk.len_tokens,
          batch_id: BATCH_ID
        },
        chunk_index: chunk.i
      });
      
    } catch {
      // ignore syntax errors from source jsonl
    }
  }

  const docsArray = Array.from(documentsMap.values());

  console.log('\n--- PRE-INSERT SUMMARY ---');
  console.log(`Target Batch ID: ${BATCH_ID}`);
  console.log(`Documents to insert: ${docsArray.length}`);
  console.log(`Chunks to insert: ${chunksToImport.length}`);
  console.log('Chunk text quality statistics:', qualityStatistics);

  const scopeCounts = docsArray.reduce((acc, doc) => {
    const scope = doc.scope_type as string;
    acc[scope] = ((acc[scope] as number) || 0) + 1;
    return acc;
  }, {} as Record<string, number>);
  console.table(scopeCounts);

  const systemCounts = docsArray.reduce((acc, doc) => {
    const sys = doc.source_system as string;
    acc[sys] = ((acc[sys] as number) || 0) + 1;
    return acc;
  }, {} as Record<string, number>);
  console.table(systemCounts);

  if (DRY_RUN) {
    console.log('\n[DRY RUN] No data was inserted into the database. Run with "npx tsx scripts/importCorpusPilot.ts --run" to insert.');
    return;
  }

  console.log('\n--- STARTING DB INSERTION ---');
  
  // 1. Insert documents with upsert
  console.log('Inserting normativa_documents...');
  const { data: insertedDocs, error: docError } = await supabase
    .from('normativa_documents')
    .upsert(docsArray, { onConflict: 'source_id', ignoreDuplicates: false })
    .select('id, source_id');

  if (docError || !insertedDocs) {
    console.error('Error inserting documents:', docError);
    process.exit(1);
  }
  
  console.log(`Successfully upserted ${insertedDocs.length} documents.`);

  // Create a map of source_id -> db_id to link chunks
  const dbIdMap = new Map<string, string>();
  for (const doc of insertedDocs) {
    dbIdMap.set(doc.source_id, doc.id);
  }

  // 2. Prepare and insert chunks in batches of 500
  console.log('Inserting normativa_chunks...');
  const chunksToInsert = chunksToImport.map(chunk => {
    const metadata = chunk.metadata as { tipo_chunk?: string | null };
    const quality = evaluateChunkTextQuality({
      text: String(chunk.content ?? ''),
      chunkType: metadata.tipo_chunk,
    });
    if (!quality.eligible) {
      throw new Error(
        `Chunk text quality invariant failed: ${quality.reasonCodes.join(',')}`
      );
    }
    return {
      normativa_document_id: dbIdMap.get(chunk.source_id as string)!,
      content: chunk.content,
      metadata: chunk.metadata,
      chunk_index: chunk.chunk_index
    };
  }).filter(c => c.normativa_document_id); // Ensure ID is mapped

  const BATCH_SIZE = 500;
  for (let i = 0; i < chunksToInsert.length; i += BATCH_SIZE) {
    const batch = chunksToInsert.slice(i, i + BATCH_SIZE);
    const { error: chunkError } = await supabase
      .from('normativa_chunks')
      .insert(batch);
    
    if (chunkError) {
      console.error(`Error inserting chunk batch ${i} - ${i + BATCH_SIZE}:`, chunkError);
      process.exit(1);
    }
    console.log(`Inserted chunks ${i} to ${i + batch.length}`);
  }

  console.log('\n--- POST-INSERT VERIFICATION ---');
  
  const { count: docsCount } = await supabase
    .from('normativa_documents')
    .select('*', { count: 'exact', head: true });

  const { count: chunksCount } = await supabase
    .from('normativa_chunks')
    .select('*', { count: 'exact', head: true });

  console.log(`Total normativa_documents in DB: ${docsCount}`);
  console.log(`Total normativa_chunks in DB: ${chunksCount}`);

  // Get breakdown by scope
  const { data: docData } = await supabase.from('normativa_documents').select('scope_type, source_system');
  
  if (docData) {
    console.log('\nDatabase Scope Breakdown:');
    const dbScopeCounts = docData.reduce((acc, doc) => {
      acc[doc.scope_type] = (acc[doc.scope_type] || 0) + 1;
      return acc;
    }, {} as Record<string, number>);
    console.table(dbScopeCounts);

    console.log('\nDatabase Source System Breakdown:');
    const dbSystemCounts = docData.reduce((acc, doc) => {
      acc[doc.source_system] = (acc[doc.source_system] || 0) + 1;
      return acc;
    }, {} as Record<string, number>);
    console.table(dbSystemCounts);
  }

  console.log('\n✅ Import completed successfully!');
}

run().catch(console.error);
