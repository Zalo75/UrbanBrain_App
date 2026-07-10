import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
const pdf = require('pdf-parse');

const CTE_DOCS = [
  { id: 'SE', url: 'https://www.codigotecnico.org/pdf/Documentos/SE/DBSE-C.pdf', name: 'cte_db_se_oficial.pdf' },
  { id: 'SI', url: 'https://www.codigotecnico.org/pdf/Documentos/SI/DBSI.pdf', name: 'cte_db_si_oficial.pdf' },
  { id: 'SUA', url: 'https://www.codigotecnico.org/pdf/Documentos/SUA/DBSUA.pdf', name: 'cte_db_sua_oficial.pdf' },
  { id: 'HS', url: 'https://www.codigotecnico.org/pdf/Documentos/HS/DBHS.pdf', name: 'cte_db_hs_oficial.pdf' },
  { id: 'HE', url: 'https://www.codigotecnico.org/pdf/Documentos/HE/DBHE.pdf', name: 'cte_db_he_oficial.pdf' },
  { id: 'HR', url: 'https://www.codigotecnico.org/pdf/Documentos/HR/DBHR.pdf', name: 'cte_db_hr_oficial.pdf' }
];

async function run() {
  const targetDir = path.join(process.cwd(), 'corpus_v2', 'official_sources', 'CTE');
  if (!fs.existsSync(targetDir)) {
    fs.mkdirSync(targetDir, { recursive: true });
  }

  const manifest: any = {
    generatedAt: new Date().toISOString(),
    source: "codigotecnico.org",
    documents: []
  };

  for (const doc of CTE_DOCS) {
    try {
      const dest = path.join(targetDir, doc.name);
      if (!fs.existsSync(dest)) continue;

      const buffer = fs.readFileSync(dest);
      const hash = crypto.createHash('sha256').update(buffer).digest('hex');
      const sizeBytes = buffer.length;

      const data = await pdf(buffer);
      const pages = data.numpages;

      manifest.documents.push({
        id: doc.id,
        filename: doc.name,
        url: doc.url,
        hash,
        sizeBytes,
        pages,
        downloadDate: new Date().toISOString(),
        verified: true
      });

      console.log(`Processed ${doc.id}: ${pages} pages, ${sizeBytes} bytes, Hash: ${hash}`);
    } catch (e: any) {
      console.error(`Error processing ${doc.id}:`, e.message);
    }
  }

  fs.writeFileSync(path.join(targetDir, 'manifest.json'), JSON.stringify(manifest, null, 2));
  
  const readme = `# Inventario Oficial CTE\n\nGenerado: ${manifest.generatedAt}\n\n` +
    manifest.documents.map((d: any) => `- **DB-${d.id}**: \`${d.filename}\` (${d.pages} págs, ${d.sizeBytes} bytes)\n  - [Enlace Oficial](${d.url})\n  - SHA256: \`${d.hash}\``).join('\n\n');
    
  fs.writeFileSync(path.join(targetDir, 'README.md'), readme);
  console.log('\nManifest and README generated successfully.');
}

run();
