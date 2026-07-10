import fs from 'fs';
import PDFParser from 'pdf2json';

export interface ChunkMetadata {
  family: string;
  document_code: string;
  document_title: string;
  page_start: number;
  page_end: number;
  section: string | null;
  chapter: string | null;
  article: string | null;
  subsection: string | null;
  block_type: 'narrative' | 'table' | 'conflict' | 'anejo';
  token_count: number;
  source_url: string;
  file_hash: string;
}

export interface Chunk {
  content: string;
  metadata: ChunkMetadata;
}

interface Line {
  y: number;
  x: number;
  text: string;
  isBold: boolean;
}

interface Block {
  type: 'narrative' | 'table' | 'conflict' | 'index';
  text: string;
  page_start: number;
  page_end: number;
}

export class StructuredPdfExtractor {
  
  public stats = {
    pagesProcessed: 0,
    headersRemoved: 0,
    footersRemoved: 0,
    indicesRemoved: 0,
    dehyphenatedWords: 0
  };

  public async extractAndChunk(
    pdfPath: string, 
    manifestDoc: any, 
    family: string
  ): Promise<Chunk[]> {
    this.stats = {
      pagesProcessed: 0,
      headersRemoved: 0,
      footersRemoved: 0,
      indicesRemoved: 0,
      dehyphenatedWords: 0
    };
    const pages = await this.parsePdf(pdfPath);
    const blocks = this.cleanAndBlockPages(pages);
    return this.hierarchicalChunking(blocks, manifestDoc, family);
  }

  private async parsePdf(pdfPath: string): Promise<any[]> {
    return new Promise((resolve, reject) => {
      const pdfParser = new PDFParser();
      pdfParser.on("pdfParser_dataError", (errData: any) => reject(errData.parserError));
      pdfParser.on("pdfParser_dataReady", (pdfData: any) => {
        resolve(pdfData.Pages);
      });
      pdfParser.loadPDF(pdfPath);
    });
  }

  private safeDecode(str: string): string {
    try { return decodeURIComponent(str); } catch { return unescape(str); }
  }

  private cleanAndBlockPages(pages: any[]): Block[] {
    const allBlocks: Block[] = [];
    
    // Top/Bottom margins for headers/footers
    const topTexts = new Map<string, number>();
    const bottomTexts = new Map<string, number>();

    pages.forEach(page => {
      if (!page.Texts) return;
      page.Texts.forEach((t: any) => {
        if (!t.R || !t.R[0]) return;
        const text = this.safeDecode(t.R[0].T).trim();
        if (text.length < 3) return;
        
        if (t.y < 5) topTexts.set(text, (topTexts.get(text) || 0) + 1);
        else if (t.y > 45) bottomTexts.set(text, (bottomTexts.get(text) || 0) + 1);
      });
    });

    const headersToIgnore = new Set<string>();
    const footersToIgnore = new Set<string>();
    topTexts.forEach((count, text) => { if (count > pages.length * 0.15) headersToIgnore.add(text); });
    bottomTexts.forEach((count, text) => { if (count > pages.length * 0.15) footersToIgnore.add(text); });

    let isIndexMode = true; // Assume we start in index mode if we see "Índice"

    pages.forEach((page, pageIdx) => {
      if (!page.Texts) return;
      this.stats.pagesProcessed++;
      
      const lines: Line[] = [];
      page.Texts.forEach((t: any) => {
        if (!t.R || !t.R[0]) return;
        let text = this.safeDecode(t.R[0].T);
        if (t.R[0].TS && t.R[0].TS[2] === 1) text = " " + text; // spacing
        const cleanStr = text.trim();
        
        // Skip page numbers and repeated headers/footers
        if (/^\d+$/.test(cleanStr) && (t.y < 5 || t.y > 45)) return;
        if (t.y < 6 && (headersToIgnore.has(cleanStr) || cleanStr.includes('Documento Básico'))) {
          this.stats.headersRemoved++;
          return;
        }
        if (t.y > 44 && footersToIgnore.has(cleanStr)) {
          this.stats.footersRemoved++;
          return;
        }
        
        const isBold = t.R[0].TS && t.R[0].TS[1] > 20; // heuristic for bold
        lines.push({ y: t.y, x: t.x, text, isBold });
      });

      lines.sort((a, b) => {
        if (Math.abs(a.y - b.y) < 0.5) return a.x - b.x;
        return a.y - b.y;
      });

      const groupedLines: {y: number, text: string, countX: number}[] = [];
      let currentGroup: Line[] = [];
      
      for (const line of lines) {
        if (currentGroup.length === 0) {
          currentGroup.push(line);
        } else {
          const lastLine = currentGroup[currentGroup.length - 1];
          if (Math.abs(line.y - lastLine.y) < 0.4) {
            currentGroup.push(line);
          } else {
            const merged = currentGroup.map(g => g.text).join('').replace(/\s{2,}/g, ' ').trim();
            if (merged) groupedLines.push({ y: currentGroup[0].y, text: merged, countX: currentGroup.length });
            currentGroup = [line];
          }
        }
      }
      if (currentGroup.length > 0) {
        const merged = currentGroup.map(g => g.text).join('').replace(/\s{2,}/g, ' ').trim();
        if (merged) groupedLines.push({ y: currentGroup[0].y, text: merged, countX: currentGroup.length });
      }

      // Group into Blocks (Narrative vs Table)
      let currentBlockText = "";
      let lastY = -100;
      let blockType: 'narrative' | 'table' | 'conflict' | 'index' = 'narrative';
      let rowDensity = 0;
      let rowsInBlock = 0;

      for (let i = 0; i < groupedLines.length; i++) {
        const gl = groupedLines[i];
        
        // Detect index mode
        if (gl.text.match(/^(ÍNDICE|Índice|INDICE)$/i)) isIndexMode = true;
        if (isIndexMode && (pageIdx > 15 || gl.text.match(/^(Introducción|Sección|1\s+Objeto|Capítulo\s+1|1\.\s+Objeto)/i))) isIndexMode = false;
        
        const yDiff = gl.y - lastY;
        const isDenseRow = gl.countX > 3 && gl.text.includes('   '); // At least 4 elements and large spaces
        
        if (lastY !== -100 && (yDiff > 1.2 || (isDenseRow && blockType !== 'table'))) {
          // Break block
          if (currentBlockText) {
             if (isIndexMode || currentBlockText.match(/\.{4,}/)) blockType = 'index';
             allBlocks.push({ 
               type: blockType, 
               text: this.cleanHyphenation(currentBlockText), 
               page_start: pageIdx + 1, 
               page_end: pageIdx + 1 
             });
          }
          currentBlockText = gl.text;
          blockType = isDenseRow ? 'table' : 'narrative';
          rowDensity = isDenseRow ? gl.countX : 1;
          rowsInBlock = 1;
        } else {
          currentBlockText += (currentBlockText ? (blockType === 'table' ? "\n" : " ") : "") + gl.text;
          if (isDenseRow) blockType = 'table';
          rowDensity += gl.countX;
          rowsInBlock++;
        }
        lastY = gl.y;
      }
      
      if (currentBlockText) {
        if (isIndexMode || currentBlockText.match(/\.{4,}/)) {
           blockType = 'index';
           this.stats.indicesRemoved++;
        }
        if (blockType === 'table' && rowDensity / rowsInBlock < 1.5) blockType = 'narrative'; // weak table heuristic
        
        allBlocks.push({ 
          type: blockType, 
          text: this.cleanHyphenation(currentBlockText), 
          page_start: pageIdx + 1, 
          page_end: pageIdx + 1 
        });
      }
    });

    return allBlocks;
  }

  private cleanHyphenation(text: string): string {
    const origLength = text.length;
    const cleaned = text.replace(/([a-záéíóúñ])-\s+([a-záéíóúñ])/gi, '$1$2').replace(/\s{2,}/g, ' ');
    if (origLength !== cleaned.length) this.stats.dehyphenatedWords++;
    return cleaned;
  }

  private hierarchicalChunking(blocks: Block[], manifestDoc: any, family: string): Chunk[] {
    const chunks: Chunk[] = [];
    
    let currentSection: string | null = null;
    let currentChapter: string | null = null;
    let currentArticle: string | null = null;
    let currentSubsection: string | null = null;
    let isAnejo = false;
    
    let accumulator = "";
    let blockTypeAccumulator: 'narrative' | 'table' | 'conflict' | 'anejo' = 'narrative';
    let pStart = -1;
    let pEnd = -1;

    const flush = () => {
      const cleanAcc = accumulator.trim();
      if (!cleanAcc) return;
      
      const tokens = Math.ceil(cleanAcc.split(/\s+/).length * 1.3);
      if (tokens > 1000 && blockTypeAccumulator === 'narrative') {
         // Sub-split by paragraph (newlines or periods)
         const subChunks = cleanAcc.split(/\n|\.\s+/);
         let subAcc = "";
         let pS = pStart;
         for (const sc of subChunks) {
            if (!sc.trim()) continue;
            if (Math.ceil((subAcc + " " + sc).split(/\s+/).length * 1.3) > 1000) {
               if (subAcc.trim()) {
                 chunks.push(this.createChunk(subAcc.trim() + ".", pS, pEnd, currentSection, currentChapter, currentArticle, currentSubsection, blockTypeAccumulator, manifestDoc, family));
                 subAcc = "";
                 pS = pEnd; // Approximation
               }
            }
            subAcc += (subAcc ? " " : "") + sc + ".";
         }
         if (subAcc.trim()) {
           chunks.push(this.createChunk(subAcc.trim(), pS, pEnd, currentSection, currentChapter, currentArticle, currentSubsection, blockTypeAccumulator, manifestDoc, family));
         }
      } else {
        chunks.push(this.createChunk(cleanAcc, pStart, pEnd, currentSection, currentChapter, currentArticle, currentSubsection, blockTypeAccumulator, manifestDoc, family));
      }
      
      accumulator = "";
      blockTypeAccumulator = 'narrative';
      pStart = -1;
      pEnd = -1;
    };

    for (const b of blocks) {
      if (b.type === 'index') continue;

      // Detect hierarchy in the block
      const secMatch = b.text.match(/^Sección\s+(SI\s*\d+|SUA\s*\d+|HS\s*\d+|HE\s*\d+|HR\s*\d+|SE\s*[A-Z]*)/i);
      const capMatch = b.text.match(/^(Capítulo|Capitulo)\s+([IXV]+|\d+)\b/i);
      const artMatch = b.text.match(/^Artículo\s+(\d+[\.\d]*)\b/i);
      const subMatch = b.text.match(/^(\d+\.\d+[\.\d]*)\s+([A-ZÁÉÍÓÚÑ])/);
      const anejoMatch = b.text.match(/^Anejo\s+([A-Z]|SI [A-Z])/i);
      const tablaMatch = b.text.match(/^Tabla\s+(\d+\.\d+)/i);

      let isBoundary = false;

      if (secMatch) {
        flush();
        currentSection = secMatch[0];
        currentChapter = null;
        currentArticle = null;
        currentSubsection = null;
        isAnejo = false;
        isBoundary = true;
      } else if (anejoMatch) {
        flush();
        currentSection = anejoMatch[0];
        currentChapter = null;
        currentArticle = null;
        currentSubsection = null;
        isAnejo = true;
        isBoundary = true;
      } else if (capMatch) {
        flush();
        currentChapter = capMatch[0];
        currentArticle = null;
        currentSubsection = null;
        isBoundary = true;
      } else if (artMatch) {
        flush();
        currentArticle = artMatch[0];
        currentSubsection = null;
        isBoundary = true;
      } else if (subMatch) {
        flush();
        currentSubsection = subMatch[1];
        isBoundary = true;
      } else if (tablaMatch || b.type === 'table') {
        flush(); // Tables are isolated
        isBoundary = true;
      }

      // If we are flushing due to a boundary or token limit on current accumulator
      const potentialTokens = Math.ceil((accumulator + b.text).split(/\s+/).length * 1.3);
      if (!isBoundary && potentialTokens > 900 && blockTypeAccumulator !== 'table') {
        flush();
      }

      // Start accumulating
      if (pStart === -1) pStart = b.page_start;
      pEnd = b.page_end;

      if (b.type === 'table' || tablaMatch) {
        // Table or Conflict
        blockTypeAccumulator = b.text.includes('\n') && b.text.length > 50 ? 'conflict' : 'table';
      } else if (isAnejo) {
        blockTypeAccumulator = 'anejo';
      }

      accumulator += (accumulator ? (blockTypeAccumulator === 'conflict' ? "\n" : " ") : "") + b.text;

      // If it's a table block, flush immediately after accumulating to isolate it
      if (b.type === 'table') {
        flush();
      }
    }
    
    flush();
    return chunks;
  }

  private createChunk(
    text: string, 
    startPage: number, 
    endPage: number, 
    section: string | null,
    chapter: string | null,
    article: string | null,
    subsection: string | null,
    blockType: 'narrative' | 'table' | 'conflict' | 'anejo',
    manifestDoc: any, 
    family: string
  ): Chunk {
    return {
      content: text,
      metadata: {
        family,
        document_code: manifestDoc.code,
        document_title: manifestDoc.title,
        page_start: startPage,
        page_end: endPage,
        section,
        chapter,
        article,
        subsection,
        block_type: blockType,
        token_count: Math.ceil(text.split(/\s+/).length * 1.3),
        source_url: manifestDoc.source_url,
        file_hash: manifestDoc.file_hash
      }
    };
  }
}
