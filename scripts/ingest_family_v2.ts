import 'dotenv/config';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { db } from '../src/infrastructure/db/client';
import { normativeDocumentsV2, normativeChunksV2, normativeFamilies } from '../src/infrastructure/db/schema';
import { eq, and } from 'drizzle-orm';
import { GeminiEmbeddingProvider } from '../src/application/embeddings/EmbeddingProvider';
const pdf = require('pdf-parse');

const ALLOWED_DOMAINS = [
  'codigotecnico.org',
  'xunta.gal',
  'boe.es',
  'mitma.gob.es',
  'mapama.gob.es'
];

function isOfficialUrl(url: string): boolean {
  try {
    const u = new URL(url);
    return ALLOWED_DOMAINS.some(domain => u.hostname === domain || u.hostname.endsWith(`.${domain}`));
  } catch (e) {
    return false;
  }
}

import { StructuredPdfExtractor } from '../src/application/document-processing/StructuredPdfExtractor';

const generateHash = (data: Buffer | string) => crypto.createHash('sha256').update(data).digest('hex');

async function run() {
  const args = process.argv.slice(2);
  const familyCode = args.find(a => !a.startsWith('--'));
  const isYes = args.includes('--yes');
  const isDryRun = args.includes('--dry-run') || !isYes;

  if (!familyCode) {
    console.error('Usage: npx tsx scripts/ingest_family_v2.ts <FAMILY_CODE> [--dry-run] [--yes]');
    process.exit(1);
  }

  console.log(`\n=== INICIANDO INGESTIÓN GENÉRICA V2: ${familyCode} ===`);
  console.log(`Modo: ${isDryRun ? 'DRY-RUN (Sin escrituras)' : 'PRODUCCIÓN (--yes detectado)'}`);

  const familyDir = path.join(process.cwd(), 'corpus_v2', 'families', familyCode);
  const manifestPath = path.join(familyDir, 'manifest.json');

  if (!fs.existsSync(manifestPath)) {
    console.error(`ERROR: No se encontró manifest en ${manifestPath}`);
    process.exit(1);
  }

  const manifestStr = fs.readFileSync(manifestPath, 'utf8');
  let manifest;
  try {
    manifest = JSON.parse(manifestStr);
  } catch (e: any) {
    console.error(`ERROR: El manifest.json es inválido (${e.message})`);
    process.exit(1);
  }

  if (!manifest.family || !manifest.documents || !Array.isArray(manifest.documents)) {
    console.error('ERROR: El manifest debe contener "family" y "documents"');
    process.exit(1);
  }

  // Check mock/dummy content
  if (manifestStr.includes('MOCK') || manifestStr.includes('DUMMY') || manifestStr.includes('TEST')) {
    console.error('ERROR: El manifest contiene datos MOCK, TEST o DUMMY. Ingestión rechazada.');
    process.exit(1);
  }

  const provider = new GeminiEmbeddingProvider();
  
  const report = {
    family: manifest.family.name,
    docsProcessed: 0,
    totalDocs: manifest.documents.length,
    totalChunks: 0,
    totalTokens: 0,
    duplicates: 0,
    errors: 0,
    costEstimate: 0,
    details: [] as any[]
  };

  const docsToInsert: any[] = [];
  const allChunksToInsert: any[] = [];

  for (const doc of manifest.documents) {
    const docReport: any = {
      code: doc.code,
      status: 'OK',
      pages: 0,
      chunks: 0,
      minTokens: Number.MAX_SAFE_INTEGER,
      maxTokens: 0,
      avgTokens: 0
    };
    report.details.push(docReport);

    if (!doc.source_url || !isOfficialUrl(doc.source_url)) {
      docReport.status = 'ERROR: URL no oficial o faltante';
      report.errors++;
      continue;
    }

    const filePath = path.join(familyDir, 'source', doc.file_name);
    if (!fs.existsSync(filePath)) {
      docReport.status = 'ERROR: Archivo no encontrado';
      report.errors++;
      continue;
    }

    const buffer = fs.readFileSync(filePath);
    const actualHash = generateHash(buffer);
    if (actualHash !== doc.file_hash) {
      docReport.status = `ERROR: Hash incorrecto. En manifest: ${doc.file_hash}, Real: ${actualHash}`;
      report.errors++;
      continue;
    }

    // Extract text using StructuredPdfExtractor
    let chunks: any[] = [];
    try {
      const extractor = new StructuredPdfExtractor();
      chunks = await extractor.extractAndChunk(filePath, doc, manifest.family.code);
      docReport.pages = extractor.stats.pagesProcessed;
    } catch(e:any) {
      docReport.status = `ERROR: Imposible parsear PDF (${e.message})`;
      report.errors++;
      continue;
    }

    const validChunks = [];
    const seenHashes = new Set();
    let docTokens = 0;

    const contentHash = generateHash(chunks.map(c => c.content).join('\n'));
    for (const c of chunks) {
      if (!c.content.trim()) continue;
      const cHash = generateHash(c.content);
      if (seenHashes.has(cHash)) continue;
      seenHashes.add(cHash);

      const tokens = c.metadata.token_count;

      validChunks.push({
        content: c.content,
        metadata: c.metadata,
        tokens,
        hash: cHash
      });
      docTokens += tokens;
      if (tokens < docReport.minTokens) docReport.minTokens = tokens;
      if (tokens > docReport.maxTokens) docReport.maxTokens = tokens;
    }

    if (validChunks.length === 0) docReport.minTokens = 0;
    else docReport.avgTokens = Math.round(docTokens / validChunks.length);
    
    docReport.chunks = validChunks.length;
    report.totalChunks += validChunks.length;
    report.totalTokens += docTokens;
    report.docsProcessed++;

    // Check idempotency in DB
    const existingDoc = await db.select().from(normativeDocumentsV2).where(eq(normativeDocumentsV2.contentHash, contentHash)).limit(1);
    if (existingDoc.length > 0) {
      docReport.status = 'SKIPPED: Documento ya ingerido (contentHash coincidente)';
      report.duplicates++;
      continue;
    }

    const docId = crypto.randomUUID();
    docsToInsert.push({
      id: docId,
      normativeFamilyId: manifest.family.id || crypto.randomUUID(), // Will link correctly if family exists
      title: doc.title || `CTE ${doc.code}`,
      versionLabel: doc.version_label,
      validFrom: doc.valid_from ? new Date(doc.valid_from) : null,
      validUntil: doc.valid_until ? new Date(doc.valid_until) : null,
      currentVersion: doc.current_version,
      isConsolidated: doc.is_consolidated,
      legalReviewStatus: doc.legal_review_status,
      status: doc.status,
      scopeType: doc.scope_type,
      category: doc.category,
      jurisdiction: manifest.family.jurisdiction,
      authority: doc.authority,
      authorityType: doc.authority_type,
      officialIdentifier: doc.official_identifier,
      sourceUrl: doc.source_url,
      language: doc.language,
      priority: doc.priority,
      confidence: doc.confidence,
      fileHash: doc.file_hash,
      contentHash: contentHash
    });

    let chunkIndex = 0;
    for (const vc of validChunks) {
      allChunksToInsert.push({
        id: crypto.randomUUID(),
        documentId: docId,
        chunkIndex: chunkIndex++,
        content: vc.content,
        tokens: vc.tokens,
        page: vc.metadata.page_start,
        article: vc.metadata.article || null,
        chapter: vc.metadata.chapter || null,
        hash: vc.hash
      });
    }
  }

  // Cost estimate (Gemini embedding: $0.00002 per 1k characters approx, but let's just log tokens)
  report.costEstimate = (report.totalTokens / 1000) * 0.0001; // Fake estimate for demonstration

  console.log('\n=== INFORME PREVIO ===');
  console.log(`Familia: ${report.family}`);
  console.log(`Documentos a procesar: ${report.docsProcessed} / ${report.totalDocs}`);
  console.log(`Errores: ${report.errors}`);
  console.log(`Duplicados ignorados: ${report.duplicates}`);
  console.log(`Chunks válidos totales: ${report.totalChunks}`);
  console.log(`Tokens totales estimados: ${report.totalTokens}`);
  console.log(`Coste estimado (${provider.getModelName()}): $${report.costEstimate.toFixed(6)}`);
  
  console.log('\n--- Detalles por documento ---');
  console.table(report.details);

  if (report.errors > 0) {
    console.error('\nERROR: Se encontraron errores de validación. Abortando ingestión.');
    process.exit(1);
  }

  if (isDryRun) {
    console.log('\nDRY-RUN FINALIZADO: 0 escrituras en base de datos. Ningún embedding generado.');
    process.exit(0);
  }

  console.log('\nIniciando transacción en base de datos e incrustación de embeddings...');

  try {
    await db.transaction(async (tx) => {
      // Upsert family
      let f = await tx.select().from(normativeFamilies).where(eq(normativeFamilies.code, manifest.family.code)).limit(1);
      let familyId;
      if (f.length === 0) {
        familyId = crypto.randomUUID();
        await tx.insert(normativeFamilies).values({
          id: familyId,
          code: manifest.family.code,
          name: manifest.family.name,
          jurisdiction: manifest.family.jurisdiction,
          category: manifest.family.category,
          authority: manifest.family.authority
        });
      } else {
        familyId = f[0].id;
      }

      for (const d of docsToInsert) {
        d.normativeFamilyId = familyId;
        await tx.insert(normativeDocumentsV2).values(d);
      }

      // Generate embeddings in chunks to avoid rate limits
      for (let i = 0; i < allChunksToInsert.length; i++) {
        const c = allChunksToInsert[i];
        console.log(`Embeddings: chunk ${i+1}/${allChunksToInsert.length}...`);
        const vector = await provider.generateEmbedding(c.content);
        await tx.insert(normativeChunksV2).values({
          documentId: c.documentId,
          chunkIndex: c.chunkIndex,
          content: c.content,
          embedding: vector as any,
          tokenCount: c.tokens,
          page: c.page,
          article: c.article,
          chapter: c.chapter
        });
      }
    });

    console.log('\n¡INGESTIÓN COMPLETADA CON ÉXITO!');
  } catch (e: any) {
    console.error('\nERROR DURANTE LA TRANSACCIÓN. Haciendo ROLLBACK...');
    console.error(e.message);
    if (e.cause) console.error('CAUSA:', e.cause);
    if (e.originalError) console.error('ORIGINAL:', e.originalError);
    process.exit(1);
  }

  process.exit(0);
}

run();
