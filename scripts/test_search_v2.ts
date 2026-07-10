import { db } from '../src/infrastructure/db/client';
import { normativeDocumentsV2, normativeChunksV2 } from '../src/infrastructure/db/schema';
import { GeminiEmbeddingProvider } from '../src/application/embeddings/EmbeddingProvider';
import { sql, eq } from 'drizzle-orm';
import fs from 'fs';
import path from 'path';
import 'dotenv/config';

const provider = new GeminiEmbeddingProvider();

async function run() {
  const queries = [
    "¿Qué anchura debe tener una escalera de evacuación?",
    "¿Cuándo es obligatorio instalar un ascensor accesible?",
    "¿Qué resistencia al fuego debe tener una estructura?",
    "¿Qué exige el CTE sobre ventilación de viviendas?",
    "¿Qué requisitos existen frente al ruido?",
    "¿Qué condiciones de ahorro energético debe cumplir una vivienda?"
  ];

  let md = `# Resultados de Prueba de Recuperación V2\n\n`;

  for (const q of queries) {
    console.log(`Buscando: ${q}`);
    md += `## Pregunta: ${q}\n\n`;
    const qVector = await provider.generateEmbedding(q);
    
    const results = await db.select({
      docCode: normativeDocumentsV2.title,
      version: normativeDocumentsV2.versionLabel,
      section: normativeChunksV2.content, // we don't have explicit section in schema, so we approximate
      article: normativeChunksV2.article,
      chapter: normativeChunksV2.chapter,
      page: normativeChunksV2.page,
      content: normativeChunksV2.content,
      similarity: sql<number>`1 - (${normativeChunksV2.embedding} <=> ${JSON.stringify(qVector)}::vector)`.as('similarity')
    })
    .from(normativeChunksV2)
    .innerJoin(normativeDocumentsV2, eq(normativeChunksV2.documentId, normativeDocumentsV2.id))
    .orderBy(sql`${normativeChunksV2.embedding} <=> ${JSON.stringify(qVector)}::vector`)
    .limit(5);

    results.forEach((r, idx) => {
      // Parse out section, table, etc from content approximation because it's not in DB
      const sectionMatch = r.content.match(/^Sección\s+(SI\s*\d+|SUA\s*\d+|HS\s*\d+|HE\s*\d+|HR\s*\d+|SE\s*[A-Z]*)/i);
      const section = sectionMatch ? sectionMatch[0] : '-';
      const tablaMatch = r.content.match(/Tabla\s+[\d\.]+/i);
      const anejoMatch = r.content.match(/Anejo\s+[A-Z]/i);
      
      const reference = [];
      reference.push(`CTE ${r.docCode}`);
      if (section !== '-') reference.push(section);
      if (r.chapter) reference.push(`capítulo ${r.chapter}`);
      if (r.article) reference.push(`artículo ${r.article}`);
      if (tablaMatch) reference.push(tablaMatch[0]);
      if (anejoMatch) reference.push(anejoMatch[0]);
      reference.push(`página ${r.page}`);
      
      const citation = reference.join(', ') + '.';

      md += `### ${idx + 1}. [${r.docCode}] Similitud: ${(r.similarity * 100).toFixed(1)}%\n`;
      md += `- **Documento:** ${r.docCode}\n`;
      md += `- **Versión:** ${r.version}\n`;
      md += `- **Sección:** ${section}\n`;
      md += `- **Capítulo:** ${r.chapter || '-'}\n`;
      md += `- **Apartado/Artículo:** ${r.article || '-'}\n`;
      md += `- **Tabla/Anejo:** ${tablaMatch ? tablaMatch[0] : (anejoMatch ? anejoMatch[0] : '-')}\n`;
      md += `- **Páginas:** ${r.page}\n`;
      md += `- **Cita jurídica:** ${citation}\n`;
      md += `**Fragmento:**\n> ${r.content.substring(0, 300).replace(/\n/g, ' ')}...\n\n`;
    });
  }

  const outDir = process.env.APPDATA_DIR ? path.join(process.env.APPDATA_DIR, 'brain', process.env.CONVERSATION_ID || '') : __dirname;
  const mdPath = path.join(outDir, 'cte_search_v2_results.md');
  fs.writeFileSync(mdPath, md);
  console.log(`Guardado en: ${mdPath}`);
  process.exit(0);
}

run().catch(console.error);
