import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
const pdf = require('pdf-parse');

const familyCode = 'CTE';
const familyDir = path.join(process.cwd(), 'corpus_v2', 'families', familyCode);
const manifestPath = path.join(familyDir, 'manifest.json');

function chunkTextSemantically(text: string): { content: string, article: string | null, chapter: string | null, tokens: number }[] {
  const paragraphs = text.split(/\n\s*\n/);
  const chunks: { content: string, article: string | null, chapter: string | null, tokens: number }[] = [];
  
  let currentChunk = "";
  let currentArticle = null;
  let currentChapter = null;

  for (const para of paragraphs) {
    const cleanPara = para.replace(/\n/g, ' ').trim();
    if (!cleanPara) continue;

    const artMatch = cleanPara.match(/Artículo\s+(\d+[\.\d]*)/i);
    if (artMatch) {
      if (currentChunk.length > 200) {
        const tokens = Math.ceil(currentChunk.trim().split(/\s+/).length * 1.3);
        chunks.push({ content: currentChunk.trim(), article: currentArticle, chapter: currentChapter, tokens });
        currentChunk = "";
      }
      currentArticle = artMatch[0];
    }
    
    const chapMatch = cleanPara.match(/Capítulo\s+([IXV]+|\d+)/i);
    if (chapMatch) {
      if (currentChunk.length > 200) {
        const tokens = Math.ceil(currentChunk.trim().split(/\s+/).length * 1.3);
        chunks.push({ content: currentChunk.trim(), article: currentArticle, chapter: currentChapter, tokens });
        currentChunk = "";
      }
      currentChapter = chapMatch[0];
    }

    const estimatedTokensForPara = Math.ceil(cleanPara.split(/\s+/).length * 1.3);
    const currentTokens = Math.ceil(currentChunk.split(/\s+/).length * 1.3);

    if (estimatedTokensForPara > 800) {
      const subParas = cleanPara.split(/\.\s+/);
      for (const sp of subParas) {
        if (!sp.trim()) continue;
        const spTokens = Math.ceil(sp.split(/\s+/).length * 1.3);
        if (Math.ceil((currentChunk + ' ' + sp).split(/\s+/).length * 1.3) > 1000) {
           if (currentChunk.trim().length > 0) {
             const tokens = Math.ceil(currentChunk.trim().split(/\s+/).length * 1.3);
             chunks.push({ content: currentChunk.trim(), article: currentArticle, chapter: currentChapter, tokens });
             currentChunk = "";
           }
        }
        currentChunk += (currentChunk ? " " : "") + sp + ".";
      }
    } else {
      if (currentTokens + estimatedTokensForPara > 1000) {
        if (currentChunk.trim().length > 0) {
          const tokens = Math.ceil(currentChunk.trim().split(/\s+/).length * 1.3);
          chunks.push({ content: currentChunk.trim(), article: currentArticle, chapter: currentChapter, tokens });
          currentChunk = "";
        }
      }
      currentChunk += (currentChunk ? "\n\n" : "") + cleanPara;
    }
  }

  if (currentChunk.trim().length > 0) {
    const tokens = Math.ceil(currentChunk.trim().split(/\s+/).length * 1.3);
    chunks.push({ content: currentChunk.trim(), article: currentArticle, chapter: currentChapter, tokens });
  }

  return chunks;
}

async function run() {
  const manifestStr = fs.readFileSync(manifestPath, 'utf8');
  const manifest = JSON.parse(manifestStr);

  const allChunks: any[] = [];
  
  for (const doc of manifest.documents) {
    const filePath = path.join(familyDir, 'source', doc.file_name);
    const buffer = fs.readFileSync(filePath);
    const data = await pdf(buffer);
    const rawText = data.text;
    const docChunks = chunkTextSemantically(rawText);
    
    // We don't have exact page numbers per chunk with pdf-parse natively unless we parse page by page. 
    // But we know the document total pages.
    docChunks.forEach((c: any) => {
      c.docCode = doc.code;
      c.docTitle = doc.title;
      c.totalPages = data.numpages;
      allChunks.push(c);
    });
  }

  // --- Statistics ---
  const tokenSizes = allChunks.map(c => c.tokens).sort((a, b) => a - b);
  const total = tokenSizes.length;
  const mean = Math.round(tokenSizes.reduce((a, b) => a + b, 0) / total);
  const median = tokenSizes[Math.floor(total / 2)];
  const p95 = tokenSizes[Math.floor(total * 0.95)];
  const min = tokenSizes[0];
  const max = tokenSizes[total - 1];

  // --- Anomalies Detection ---
  const anomalies = {
    emptyChunks: 0,
    cutSentences: 0,
    corruptedChars: 0,
    missingArticle: 0,
    indexContamination: 0
  };

  allChunks.forEach(c => {
    if (c.content.trim().length === 0) anomalies.emptyChunks++;
    if (!/^[A-Z0-9¿¡"']/.test(c.content.trim().charAt(0))) anomalies.cutSentences++;
    if (c.content.includes('')) anomalies.corruptedChars++;
    if (!c.article && !c.chapter) anomalies.missingArticle++;
    if (/(\.{3,}|\b(Índice|Index)\b)/i.test(c.content) && c.tokens > 50) anomalies.indexContamination++;
  });

  // --- Select 20 Random Chunks (stratified slightly by doc if possible, but random is fine) ---
  const randomChunks = [];
  const indices = new Set();
  while(indices.size < 20 && indices.size < total) {
    indices.add(Math.floor(Math.random() * total));
  }
  for (const idx of indices) {
    randomChunks.push(allChunks[idx as number]);
  }

  // --- Output Markdown ---
  const outDir = process.env.APPDATA_DIR ? path.join(process.env.APPDATA_DIR, 'brain', process.env.CONVERSATION_ID || '') : __dirname;
  const mdPath = path.join(outDir, 'cte_chunk_quality_audit.md');

  let md = `# Auditoría de Calidad del Chunking (CTE V2)\n\n`;
  md += `## 1. Distribución de Tamaños (Tokens)\n`;
  md += `- **Chunks Totales:** ${total}\n`;
  md += `- **Media:** ${mean}\n`;
  md += `- **Mediana:** ${median}\n`;
  md += `- **Percentil 95:** ${p95}\n`;
  md += `- **Chunk más pequeño:** ${min}\n`;
  md += `- **Chunk más grande:** ${max}\n\n`;

  md += `## 2. Anomalías Detectadas Automáticamente\n`;
  md += `- **Chunks vacíos:** ${anomalies.emptyChunks}\n`;
  md += `- **Comienzan a mitad de frase (minúscula):** ${anomalies.cutSentences}\n`;
  md += `- **Caracteres corruptos ():** ${anomalies.corruptedChars}\n`;
  md += `- **Contaminación de índices (.....):** ${anomalies.indexContamination}\n`;
  md += `- **Chunks sin capítulo/artículo detectado:** ${anomalies.missingArticle}\n\n`;

  md += `## 3. Muestra Aleatoria de 20 Chunks\n\n`;
  
  randomChunks.forEach((c: any, i: number) => {
    md += `### Chunk #${i+1} (${c.docCode})\n`;
    md += `- **Capítulo:** ${c.chapter || 'No detectado'}\n`;
    md += `- **Artículo:** ${c.article || 'No detectado'}\n`;
    md += `- **Tokens:** ${c.tokens}\n`;
    md += `**Inicio:**\n> ${c.content.substring(0, 300).replace(/\n/g, ' ')} [...]\n\n`;
    md += `**Final:**\n> [...] ${c.content.substring(c.content.length - 300).replace(/\n/g, ' ')}\n\n`;
  });

  md += `## 4. Conclusión Crítica\n`;
  if (anomalies.cutSentences > total * 0.1 || anomalies.indexContamination > total * 0.05 || anomalies.emptyChunks > 0 || anomalies.corruptedChars > 0 || max > 1000) {
    md += `**NO APTO PARA INGESTA**\n\n`;
    md += `El algoritmo de chunking actual presenta deficiencias inaceptables para un uso jurídico estricto.\n`;
  } else {
    md += `**PARCIALMENTE APTO** (Revisar manualmente la muestra)\n\n`;
  }

  fs.writeFileSync(mdPath, md);
  console.log('Auditoría generada en:', mdPath);
}

run().catch(console.error);
