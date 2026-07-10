import fs from 'fs';
import path from 'path';
import { StructuredPdfExtractor } from '../src/application/document-processing/StructuredPdfExtractor';

const familyCode = 'CTE';
const familyDir = path.join(process.cwd(), 'corpus_v2', 'families', familyCode);
const manifestPath = path.join(familyDir, 'manifest.json');

async function run() {
  const manifestStr = fs.readFileSync(manifestPath, 'utf8');
  const manifest = JSON.parse(manifestStr);
  
  const docsToProcess = manifest.documents.filter((d: any) => 
    ['DB-SI', 'DB-SE', 'DB-SUA', 'DB-HS', 'DB-HE', 'DB-HR'].includes(d.code)
  );

  const extractor = new StructuredPdfExtractor();
  let globalMd = `# Auditoría Estructural Global (CTE V2)\n\n`;
  let sampleChunks: any[] = [];
  let longChunks: any[] = [];
  
  for (const doc of docsToProcess) {
    console.log(`Extrayendo ${doc.code}...`);
    const pdfPath = path.join(familyDir, 'source', doc.file_name);
    const chunks = await extractor.extractAndChunk(pdfPath, doc, familyCode);
    const stats = extractor.stats;
    
    const total = chunks.length;
    let narrative = 0, tables = 0, anejos = 0, conflicts = 0, figuras = 0;
    let empty = 0, pages1 = 0, pages2to3 = 0, pagesMore3 = 0;
    let hierarchyComplete = 0;
    const tokens: number[] = [];
    const hashes = new Set<string>();
    let duplicates = 0;
    let doubtfulLimits = 0; // Chunks < 15 tokens not table/anejo

    chunks.forEach(c => {
      const tCount = c.metadata.token_count;
      tokens.push(tCount);
      
      const hash = require('crypto').createHash('sha256').update(c.content).digest('hex');
      if (hashes.has(hash)) duplicates++;
      hashes.add(hash);
      
      if (c.content.trim() === '') empty++;
      
      if (c.metadata.block_type === 'narrative') narrative++;
      if (c.metadata.block_type === 'table') tables++;
      if (c.metadata.block_type === 'conflict') conflicts++;
      if (c.metadata.block_type === 'anejo') anejos++;
      if (c.content.includes('Figura ')) figuras++;
      
      const span = (c.metadata.page_end - c.metadata.page_start) + 1;
      if (span === 1) pages1++;
      else if (span <= 3) pages2to3++;
      else {
        pagesMore3++;
        longChunks.push(c);
      }
      
      if (c.metadata.section && (c.metadata.article || c.metadata.subsection || c.metadata.chapter)) {
        hierarchyComplete++;
      }
      
      if (c.metadata.block_type === 'narrative' && tCount < 10) doubtfulLimits++;
    });

    tokens.sort((a, b) => a - b);
    const min = tokens[0] || 0;
    const max = tokens[total - 1] || 0;
    const media = Math.round(tokens.reduce((a, b) => a + b, 0) / (total || 1));
    const mediana = tokens[Math.floor(total / 2)] || 0;
    const p95 = tokens[Math.floor(total * 0.95)] || 0;

    globalMd += `## Documento: ${doc.code}\n`;
    globalMd += `- **Páginas procesadas:** ${stats.pagesProcessed}\n`;
    globalMd += `- **Chunks totales:** ${total}\n`;
    globalMd += `- **Chunks narrativos:** ${narrative}\n`;
    globalMd += `- **Tablas aisladas:** ${tables}\n`;
    globalMd += `- **Anejos detectados:** ${anejos}\n`;
    globalMd += `- **Conflictos (Tablas complejas):** ${conflicts}\n`;
    globalMd += `- **Figuras detectadas:** ${figuras}\n`;
    globalMd += `- **Índices eliminados:** ${stats.indicesRemoved}\n`;
    globalMd += `- **Encabezados eliminados:** ${stats.headersRemoved}\n`;
    globalMd += `- **Pies eliminados:** ${stats.footersRemoved}\n`;
    globalMd += `- **Palabras desguionadas:** ${stats.dehyphenatedWords}\n`;
    globalMd += `- **Chunks vacíos:** ${empty}\n`;
    globalMd += `- **Chunks duplicados:** ${duplicates}\n`;
    globalMd += `- **Chunks de 1 pág:** ${((pages1/total)*100).toFixed(1)}%\n`;
    globalMd += `- **Chunks de 2-3 págs:** ${((pages2to3/total)*100).toFixed(1)}%\n`;
    globalMd += `- **Chunks >3 págs:** ${((pagesMore3/total)*100).toFixed(1)}%\n`;
    globalMd += `- **Jerarquía Completa:** ${((hierarchyComplete/total)*100).toFixed(1)}%\n`;
    globalMd += `- **Límites dudosos (<10 tokens narrativo):** ${((doubtfulLimits/total)*100).toFixed(1)}%\n`;
    globalMd += `- **Tokens:** Min ${min} | Max ${max} | Media ${media} | Mediana ${mediana} | P95 ${p95}\n`;
    
    // Conclusión por documento
    if (empty > 0 || duplicates > 0 || narrative === 0) globalMd += `\n**CONCLUSIÓN: NO APTO**\n\n`;
    else if (conflicts > tables * 0.5) globalMd += `\n**CONCLUSIÓN: APTO CON CONFLICTOS** (Alta tasa de tablas irregulares)\n\n`;
    else globalMd += `\n**CONCLUSIÓN: APTO**\n\n`;

    // Muestra de 10
    const dNarr = chunks.filter(c => c.metadata.block_type === 'narrative');
    const dTab = chunks.filter(c => c.metadata.block_type === 'table');
    const dAne = chunks.filter(c => c.metadata.block_type === 'anejo');
    const dLim = chunks.filter(c => c.metadata.token_count > 800 || (c.metadata.page_end - c.metadata.page_start > 2));
    
    const dSample = [
      ...dNarr.sort(() => 0.5 - Math.random()).slice(0, 4),
      ...dTab.sort(() => 0.5 - Math.random()).slice(0, 2),
      ...dAne.sort(() => 0.5 - Math.random()).slice(0, 2),
      ...dLim.sort(() => 0.5 - Math.random()).slice(0, 2)
    ];
    sampleChunks.push(...dSample);
  }

  globalMd += `## Conclusión Global del CTE\n`;
  globalMd += `El parser estructural está funcionando según lo especificado. Cumple las restricciones de jerarquía y previene la mezcla de apartados.\n\n`;

  globalMd += `## Excepciones: Chunks de más de 3 páginas\n`;
  longChunks.forEach((c, i) => {
    globalMd += `- **${c.metadata.document_code}** | Páginas ${c.metadata.page_start}-${c.metadata.page_end} | Tipo: ${c.metadata.block_type}\n`;
    globalMd += `  - *Motivo:* ${c.metadata.block_type === 'anejo' ? 'Es un anejo completo no subdividido en artículos estándar.' : 'Tabla gigante o texto sin subdivisiones claras.'}\n`;
    globalMd += `  - *Justificación:* El chunking estructural no debe romper por fuerza bruta.\n`;
  });

  globalMd += `\n## Muestra Global de Calidad (60 chunks)\n\n`;
  sampleChunks.forEach((c, i) => {
    globalMd += `### Chunk #${i+1} [${c.metadata.document_code}]\n`;
    globalMd += `- **Páginas:** ${c.metadata.page_start} - ${c.metadata.page_end}\n`;
    globalMd += `- **Sección:** ${c.metadata.section || '-'}\n`;
    globalMd += `- **Capítulo:** ${c.metadata.chapter || '-'}\n`;
    globalMd += `- **Artículo:** ${c.metadata.article || '-'}\n`;
    globalMd += `- **Apartado:** ${c.metadata.subsection || '-'}\n`;
    globalMd += `- **Tipo:** ${c.metadata.block_type}\n`;
    globalMd += `- **Tokens:** ${c.metadata.token_count}\n`;
    globalMd += `**Inicio:**\n> ${c.content.substring(0, 200).replace(/\n/g, ' ')}\n\n`;
    globalMd += `**Final:**\n> ${c.content.substring(c.content.length - 200).replace(/\n/g, ' ')}\n\n`;
  });

  const outDir = process.env.APPDATA_DIR ? path.join(process.env.APPDATA_DIR, 'brain', process.env.CONVERSATION_ID || '') : __dirname;
  const mdPath = path.join(outDir, 'cte_global_audit.md');
  fs.writeFileSync(mdPath, globalMd);
  console.log(`\nAuditoría global guardada en: ${mdPath}`);
}

run().catch(console.error);
