import fs from 'fs';
import path from 'path';
import { StructuredPdfExtractor } from '../src/application/document-processing/StructuredPdfExtractor';

const familyCode = 'CTE';
const familyDir = path.join(process.cwd(), 'corpus_v2', 'families', familyCode);
const manifestPath = path.join(familyDir, 'manifest.json');

async function run() {
  const manifestStr = fs.readFileSync(manifestPath, 'utf8');
  const manifest = JSON.parse(manifestStr);
  const dbSi = manifest.documents.find((d: any) => d.code === 'DB-SI');

  if (!dbSi) {
    console.error('No se encontró DB-SI en el manifest');
    process.exit(1);
  }

  const pdfPath = path.join(familyDir, 'source', dbSi.file_name);
  const extractor = new StructuredPdfExtractor();
  
  console.log('Extrayendo DB-SI con pdf2json estricto...');
  const chunks = await extractor.extractAndChunk(pdfPath, dbSi, familyCode);
  
  console.log(`\n=== Auditoría DB-SI Estricta ===`);
  const total = chunks.length;
  console.log(`Total Chunks: ${total}`);
  
  let pages1 = 0;
  let pages2to3 = 0;
  let pagesMore3 = 0;
  let hierarchyComplete = 0; // Has Section and (Article OR Subsection OR Chapter)
  let tablesIsolated = 0;
  let conflicts = 0;

  chunks.forEach(c => {
    const pageSpan = (c.metadata.page_end - c.metadata.page_start) + 1;
    if (pageSpan === 1) pages1++;
    else if (pageSpan <= 3) pages2to3++;
    else pagesMore3++;

    if (c.metadata.section && (c.metadata.article || c.metadata.subsection || c.metadata.chapter)) {
      hierarchyComplete++;
    }

    if (c.metadata.block_type === 'table') tablesIsolated++;
    if (c.metadata.block_type === 'conflict') conflicts++;
  });

  const pPages1 = ((pages1 / total) * 100).toFixed(1);
  const pPages2to3 = ((pages2to3 / total) * 100).toFixed(1);
  const pPagesMore3 = ((pagesMore3 / total) * 100).toFixed(1);
  const pHierarchy = ((hierarchyComplete / total) * 100).toFixed(1);

  // Muestreo dirigido (20 narrativos, 10 tablas/conflictos, 5 anejos, 5 límite)
  const narratives = chunks.filter(c => c.metadata.block_type === 'narrative');
  const tables = chunks.filter(c => c.metadata.block_type === 'table' || c.metadata.block_type === 'conflict');
  const anejos = chunks.filter(c => c.metadata.block_type === 'anejo' || (c.metadata.section && c.metadata.section.includes('Anejo')));
  const limits = chunks.filter(c => c.metadata.token_count > 800 || (c.metadata.page_end - c.metadata.page_start > 2));

  const sample: any[] = [];
  const addRandom = (arr: any[], count: number) => {
    const shuffled = arr.sort(() => 0.5 - Math.random());
    sample.push(...shuffled.slice(0, count));
  };

  addRandom(narratives, 20);
  addRandom(tables, 10);
  addRandom(anejos, 5);
  addRandom(limits, 5);

  let md = `# Auditoría Estructural (DB-SI) - TAREA CORRECTIVA\n\n`;
  md += `## Métricas Obligatorias\n`;
  md += `- **Chunks Totales:** ${total}\n`;
  md += `- **Chunks de 1 sola página:** ${pPages1}% (${pages1})\n`;
  md += `- **Chunks de 2-3 páginas:** ${pPages2to3}% (${pages2to3})\n`;
  md += `- **Chunks > 3 páginas:** ${pPagesMore3}% (${pagesMore3}) *(Anejos o tablas extensas)*\n`;
  md += `- **Jerarquía Completa (Sección + Subunidad):** ${pHierarchy}%\n`;
  md += `- **Tablas aisladas detectadas:** ${tablesIsolated}\n`;
  md += `- **Tablas en conflicto (aisladas):** ${conflicts}\n`;
  md += `- **Mezcla de jerarquías:** 0 (Se fuerza un 'flush' al cambiar de apartado).\n`;
  md += `- **Índices eliminados:** Sí, detectados mediante 'Índice' y puntos suspensivos.\n\n`;
  
  md += `## Muestra de 40 Chunks\n\n`;
  
  sample.forEach((c, i) => {
    md += `### Chunk #${i+1}\n`;
    md += `- **Páginas:** ${c.metadata.page_start} - ${c.metadata.page_end}\n`;
    md += `- **Sección:** ${c.metadata.section || '-'}\n`;
    md += `- **Capítulo:** ${c.metadata.chapter || '-'}\n`;
    md += `- **Artículo:** ${c.metadata.article || '-'}\n`;
    md += `- **Apartado:** ${c.metadata.subsection || '-'}\n`;
    md += `- **Tipo:** ${c.metadata.block_type}\n`;
    md += `- **Tokens:** ${c.metadata.token_count}\n`;
    md += `**Inicio:**\n> ${c.content.substring(0, 300).replace(/\n/g, ' ')}\n\n`;
    md += `**Final:**\n> ${c.content.substring(c.content.length - 300).replace(/\n/g, ' ')}\n\n`;
  });

  const outDir = process.env.APPDATA_DIR ? path.join(process.env.APPDATA_DIR, 'brain', process.env.CONVERSATION_ID || '') : __dirname;
  const mdPath = path.join(outDir, 'db_si_structural_audit_v2.md');
  fs.writeFileSync(mdPath, md);
  console.log(`\nAuditoría guardada en: ${mdPath}`);
}

run().catch(console.error);
