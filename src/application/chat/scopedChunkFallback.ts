export interface ScopedChunkRow {
  chunk_id: string | number
  texto?: string | null
  municipio_nombre?: string | null
  nombre_pdf?: string | null
  titulo_detectado?: string | null
  pagina_detectada?: string | number | null
  ruta_pdf?: string | null
  metadata?: unknown
  embedding?: string | number[] | null
}

function parseEmbedding(value: ScopedChunkRow['embedding']) {
  if (Array.isArray(value)) return value.map(Number)
  if (typeof value !== 'string') return null
  const parsed = value.replace(/^\[/, '').replace(/\]$/, '').split(',').map(Number)
  return parsed.length > 0 && parsed.every(Number.isFinite) ? parsed : null
}

function cosineSimilarity(a: number[], b: number[]) {
  if (!b || a.length !== b.length || a.length === 0) return null
  let dot = 0
  let normA = 0
  let normB = 0
  for (let index = 0; index < a.length; index += 1) {
    dot += a[index] * b[index]
    normA += a[index] * a[index]
    normB += b[index] * b[index]
  }
  if (normA === 0 || normB === 0) return null
  return dot / Math.sqrt(normA * normB)
}

function exactTextFilter(value: string) {
  const escaped = value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  return new RegExp(`(^|[^\\p{L}\\p{N}])${escaped}(?=$|[^\\p{L}\\p{N}])`, 'iu')
}

export function rankScopedChunkRows(
  rows: readonly ScopedChunkRow[],
  queryEmbedding: readonly number[],
  matchCount: number,
  filterOrdinance?: string | null,
) {
  const ordinance = filterOrdinance?.trim().toLocaleLowerCase()
  const ordinancePattern = ordinance ? exactTextFilter(ordinance) : null
  return rows
    .filter((row) => {
      if (!ordinancePattern) return true
      return ordinancePattern.test(`${row.titulo_detectado ?? ''}\n${row.texto ?? ''}`)
    })
    .map((row) => {
      const embedding = parseEmbedding(row.embedding)
      return { row, similarity: embedding ? cosineSimilarity([...queryEmbedding], embedding) ?? -1 : -1 }
    })
    .filter((item) => item.similarity >= 0)
    .sort((left, right) => right.similarity - left.similarity)
    .slice(0, matchCount)
    .map(({ row, similarity }) => ({
      chunk_id: row.chunk_id,
      texto: row.texto ?? null,
      municipio_nombre: row.municipio_nombre ?? null,
      nombre_pdf: row.nombre_pdf ?? null,
      titulo_detectado: row.titulo_detectado ?? null,
      pagina_detectada: row.pagina_detectada ?? null,
      original_path: row.ruta_pdf ?? null,
      similarity,
      metadata: row.metadata && typeof row.metadata === 'object' ? row.metadata as ScopedChunkRow['metadata'] : null,
    }))
}
