import fs from 'node:fs'
import readline from 'node:readline'
import { processDocumentChunks, type ChunkForBackfill } from '../src/application/normative-metadata/backfillMetadata'

const corpusPath = process.argv[2] ?? 'D:\\Agente Normativas\\CORPUS_RAG\\INDICE_LOCAL_BM25\\docs_bm25.jsonl'
const targetArgument = process.argv[3]
if (!targetArgument) {
  console.error('Usage: tsx dryRunNormativeRegimeMetadata.ts <jsonl-path> <municipality-codes-or-names-comma-separated>')
  process.exit(1)
}
const targets = new Set(targetArgument.split(',').map((value) => value.trim().toLocaleLowerCase('es')).filter(Boolean))

function targetRow(row: Record<string, unknown>) {
  const values = [row.municipio_codigo, row.municipio_nombre].filter(Boolean).map((value) => String(value).toLocaleLowerCase('es'))
  return values.some((value) => targets.has(value))
}

function documentKey(row: Record<string, unknown>) {
  return String(row.nombre_pdf ?? row.ruta_pdf ?? row.expediente ?? 'unknown-document')
}

interface DocumentBucket { key: string; chunks: ChunkForBackfill[] }

function legacyProcess(chunks: ChunkForBackfill[]) {
  const heading = /^\s*(?:ORDENANZA|ZONA|ÁMBITO)\s+(?:N(?:[ºo°.]|UMERO)?\s*)?([A-Z0-9][A-Z0-9._/-]{0,15})/i
  const general = /^\s*(?:DISPOSICIONES|NORMAS)\s+GENERALES/i
  let current: { kind: 'ordinance' | 'general'; code?: string } | undefined
  return [...chunks].sort((a, b) => (a.chunkIndex ?? 0) - (b.chunkIndex ?? 0)).map((chunk) => {
    const text = [chunk.detectedTitle, chunk.content].filter(Boolean).join('\n')
    const explicit = text.match(heading)
    const isGeneral = general.test(text)
    let regime: { kind: 'ordinance' | 'general'; code?: string } | undefined
    if (explicit) regime = { kind: 'ordinance', code: explicit[1] }
    else if (isGeneral) regime = { kind: 'general' }
    else if (current) regime = current
    if (explicit || isGeneral) current = regime
    return regime
  })
}

async function run() {
  const buckets = new Map<string, DocumentBucket>()
  const input = readline.createInterface({ input: fs.createReadStream(corpusPath, { encoding: 'utf8' }), crlfDelay: Infinity })
  let scanned = 0
  let malformed = 0
  for await (const line of input) {
    if (!line.trim()) continue
    scanned += 1
    let row: Record<string, unknown>
    try {
      row = JSON.parse(line) as Record<string, unknown>
    } catch {
      malformed += 1
      continue
    }
    if (!targetRow(row)) continue
    const key = documentKey(row)
    const bucket = buckets.get(key) ?? { key, chunks: [] }
    bucket.chunks.push({
      id: String(row.chunk_id ?? `${key}:${row.i ?? bucket.chunks.length}`),
      content: String(row.texto ?? row.content ?? ''),
      chunkIndex: Number(row.i ?? bucket.chunks.length),
      detectedTitle: row.titulo_detectado ? String(row.titulo_detectado) : null,
      article: row.article ? String(row.article) : null,
      chapter: row.chapter ? String(row.chapter) : null,
    })
    buckets.set(key, bucket)
  }

  let total = 0
  let explicit = 0
  let inherited = 0
  let general = 0
  let unknown = 0
  let ambiguous = 0
  let high = 0
  let medium = 0
  let low = 0
  let regimeChanges = 0
  let possibleFalseNegatives = 0
  let legacyExplicit = 0
  let legacyInheritedOrGeneral = 0
  let legacyUnknown = 0
  const documentMetrics: Array<{ key: string; total: number; unknown: number; explicit: number }> = []

  for (const bucket of buckets.values()) {
    const output = processDocumentChunks(bucket.chunks)
    const legacy = legacyProcess(bucket.chunks)
    legacy.forEach((regime, index) => {
      if (!regime) legacyUnknown += 1
      else if (regime.kind === 'ordinance' && legacy[index] !== legacy[index - 1]) legacyExplicit += 1
      else legacyInheritedOrGeneral += 1
    })
    let previousRegime: string | undefined
    let docUnknown = 0
    let docExplicit = 0
    for (let index = 0; index < output.length; index += 1) {
      const item = output[index]
      const regime = item.metadata.regime
      total += 1
      if (!regime) {
        unknown += 1
        docUnknown += 1
      } else {
        if (regime.provenance === 'explicit_heading') { explicit += 1; docExplicit += 1 }
        if (regime.provenance === 'inherited_heading') inherited += 1
        if (regime.kind === 'general') general += 1
        if (regime.ambiguity?.length) ambiguous += 1
        if (regime.confidence === 'high') high += 1
        if (regime.confidence === 'medium') medium += 1
        if (regime.confidence === 'low') low += 1
        const currentRegime = `${regime.kind}:${regime.code ?? 'general'}`
        if (previousRegime && previousRegime !== currentRegime && regime.provenance === 'explicit_heading') regimeChanges += 1
        previousRegime = currentRegime
      }
      const chunk = bucket.chunks[index]
      if (/^\s*(?:ART(?:[ÍI]CULO|IGO)?\.?|CAP[IÍ]TULO|SECCI[ÓO]N|T[IÍ]TULO)\b[^\n]*(?:ORDENANZA|ZONA|[ÁA]MBITO)\b/i.test(chunk.content) && !regime) possibleFalseNegatives += 1
    }
    documentMetrics.push({ key: bucket.key, total: output.length, unknown: docUnknown, explicit: docExplicit })
  }

  const worstStructure = documentMetrics
    .sort((a, b) => (b.unknown / Math.max(1, b.total)) - (a.unknown / Math.max(1, a.total)))
    .slice(0, 10)
    .map((item) => ({ document: item.key, chunks: item.total, unknown: item.unknown, explicit: item.explicit }))

  console.log(JSON.stringify({
    corpusPath,
    scannedCorpusChunks: scanned,
    malformedLines: malformed,
    documents: buckets.size,
    totalChunks: total,
    legacy: { explicitRegime: legacyExplicit, inheritedOrGeneral: legacyInheritedOrGeneral, unknown: legacyUnknown },
    explicitRegime: explicit,
    inheritedRegime: inherited,
    general,
    unknown,
    ambiguous,
    regimeChanges,
    possibleFalsePositives: ambiguous,
    possibleFalseNegatives,
    confidence: { high, medium, low },
    worstStructure,
  }, null, 2))
}

run().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error))
  process.exitCode = 1
})
