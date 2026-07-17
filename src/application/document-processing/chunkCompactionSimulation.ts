import {
  CHUNK_QUALITY_REASON_CODES,
  evaluateChunkTextQuality,
  type ChunkQualityReasonCode,
} from './chunkTextQuality'

export const DEFAULT_SIMULATION_BATCH_SIZE = 250
export const MAX_SIMULATION_BATCH_SIZE = 1_000
export const HALFVEC_768_LOGICAL_BYTES = BigInt(1_544)
export const READ_ONLY_TRANSACTION_SQL =
  'BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY'

export const FIRST_PAGE_SQL = `
SELECT
  id::text AS id,
  tipo_chunk,
  nombre_pdf,
  municipio_codigo,
  municipio_nombre,
  texto,
  pg_column_size(texto)::bigint::text AS texto_bytes,
  COALESCE(pg_column_size(embedding), 0)::bigint::text AS embedding_bytes
FROM public.normativa_chunks
ORDER BY id ASC
LIMIT $1
`.trim()

export const NEXT_PAGE_SQL = `
SELECT
  id::text AS id,
  tipo_chunk,
  nombre_pdf,
  municipio_codigo,
  municipio_nombre,
  texto,
  pg_column_size(texto)::bigint::text AS texto_bytes,
  COALESCE(pg_column_size(embedding), 0)::bigint::text AS embedding_bytes
FROM public.normativa_chunks
WHERE id > $1
ORDER BY id ASC
LIMIT $2
`.trim()

export const SIMULATION_SELECT_STATEMENTS = [FIRST_PAGE_SQL, NEXT_PAGE_SQL] as const

export interface NormativaChunkSimulationRow {
  id: string
  tipo_chunk: string | null
  nombre_pdf: string | null
  municipio_codigo: string | null
  municipio_nombre: string | null
  texto: string | null
  texto_bytes: string | number
  embedding_bytes: string | number
}

export interface SimulationPageRequest {
  sql: string
  params: Array<string | number>
  pageSize: number
}

export interface SimulationOptions {
  batchSize: number
  limit?: number
}

interface DistributionCounter {
  total: number
  kept: number
  rejected: number
}

interface NamedRejectionCounter {
  key: string
  label: string
  rejected: number
}

export interface ChunkCompactionSimulationState {
  totalRows: number
  keptRows: number
  rejectedRows: number
  rejectedByReason: Record<ChunkQualityReasonCode, number>
  byChunkType: Map<string, DistributionCounter>
  rejectedByPdf: Map<string, NamedRejectionCounter>
  rejectedByMunicipality: Map<string, NamedRejectionCounter>
  currentTextBytes: bigint
  currentEmbeddingBytes: bigint
  keptTextBytes: bigint
  keptCurrentEmbeddingBytes: bigint
  keptRowsWithEmbedding: number
}

export interface ChunkCompactionSimulationReport {
  totalRows: number
  keptRows: number
  rejectedRows: number
  keptPercentage: number
  rejectedPercentage: number
  rejectedByReason: Record<ChunkQualityReasonCode, number>
  distributionByChunkType: Array<{
    chunkType: string
    total: number
    kept: number
    rejected: number
  }>
  topRejectedPdfs: Array<{ pdf: string; rejected: number }>
  topRejectedMunicipalities: Array<{ municipality: string; rejected: number }>
  currentLogicalBytes: string
  keptBytes: string
  projectedBytesWithCurrentVector: string
  projectedBytesWithHalfvec768: string
  physicalSizeWarning: string
}

function positiveInteger(value: number, label: string) {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new Error(`${label} must be a positive integer`)
  }
  return value
}

export function normalizeSimulationOptions(options: Partial<SimulationOptions>) {
  const batchSize = positiveInteger(
    options.batchSize ?? DEFAULT_SIMULATION_BATCH_SIZE,
    'batchSize'
  )
  if (batchSize > MAX_SIMULATION_BATCH_SIZE) {
    throw new Error(`batchSize cannot exceed ${MAX_SIMULATION_BATCH_SIZE}`)
  }
  const limit =
    options.limit === undefined ? undefined : positiveInteger(options.limit, 'limit')
  return { batchSize, limit }
}

export function createSimulationPageRequest(
  options: SimulationOptions,
  processedRows: number,
  lastId?: string
): SimulationPageRequest | null {
  const remaining = options.limit === undefined ? undefined : options.limit - processedRows
  if (remaining !== undefined && remaining <= 0) return null

  const pageSize = Math.min(options.batchSize, remaining ?? options.batchSize)
  if (lastId === undefined) {
    return { sql: FIRST_PAGE_SQL, params: [pageSize], pageSize }
  }
  return { sql: NEXT_PAGE_SQL, params: [lastId, pageSize], pageSize }
}

export function createChunkCompactionSimulationState(): ChunkCompactionSimulationState {
  return {
    totalRows: 0,
    keptRows: 0,
    rejectedRows: 0,
    rejectedByReason: Object.fromEntries(
      CHUNK_QUALITY_REASON_CODES.map((reason) => [reason, 0])
    ) as Record<ChunkQualityReasonCode, number>,
    byChunkType: new Map(),
    rejectedByPdf: new Map(),
    rejectedByMunicipality: new Map(),
    currentTextBytes: BigInt(0),
    currentEmbeddingBytes: BigInt(0),
    keptTextBytes: BigInt(0),
    keptCurrentEmbeddingBytes: BigInt(0),
    keptRowsWithEmbedding: 0,
  }
}

function normalizedLabel(value: string | null, fallback: string) {
  const normalized = value?.trim()
  return normalized || fallback
}

function incrementNamedRejection(
  counters: Map<string, NamedRejectionCounter>,
  key: string,
  label: string
) {
  const current = counters.get(key)
  counters.set(key, {
    key,
    label,
    rejected: (current?.rejected ?? 0) + 1,
  })
}

export function addSimulationRow(
  state: ChunkCompactionSimulationState,
  row: NormativaChunkSimulationRow
) {
  const textBytes = BigInt(row.texto_bytes)
  const embeddingBytes = BigInt(row.embedding_bytes)
  const result = evaluateChunkTextQuality({
    text: row.texto ?? '',
    chunkType: row.tipo_chunk,
  })
  const chunkType = normalizedLabel(row.tipo_chunk, '(sin tipo)')
  const typeCounter = state.byChunkType.get(chunkType) ?? {
    total: 0,
    kept: 0,
    rejected: 0,
  }

  state.totalRows += 1
  state.currentTextBytes += textBytes
  state.currentEmbeddingBytes += embeddingBytes
  typeCounter.total += 1

  if (result.eligible) {
    state.keptRows += 1
    state.keptTextBytes += textBytes
    state.keptCurrentEmbeddingBytes += embeddingBytes
    if (embeddingBytes > BigInt(0)) state.keptRowsWithEmbedding += 1
    typeCounter.kept += 1
  } else {
    state.rejectedRows += 1
    typeCounter.rejected += 1
    for (const reason of result.reasonCodes) state.rejectedByReason[reason] += 1

    const pdf = normalizedLabel(row.nombre_pdf, '(sin PDF)')
    incrementNamedRejection(state.rejectedByPdf, pdf, pdf)

    const municipalityCode = normalizedLabel(row.municipio_codigo, '(sin codigo)')
    const municipalityName = normalizedLabel(row.municipio_nombre, '(sin municipio)')
    incrementNamedRejection(
      state.rejectedByMunicipality,
      `${municipalityCode}\u0000${municipalityName}`,
      `${municipalityCode} - ${municipalityName}`
    )
  }

  state.byChunkType.set(chunkType, typeCounter)
  return result
}

function topRejections(counters: Map<string, NamedRejectionCounter>) {
  return [...counters.values()]
    .sort((left, right) => right.rejected - left.rejected || left.key.localeCompare(right.key))
    .slice(0, 20)
}

export function buildChunkCompactionSimulationReport(
  state: ChunkCompactionSimulationState
): ChunkCompactionSimulationReport {
  const projectedCurrentVectorBytes =
    state.keptTextBytes + state.keptCurrentEmbeddingBytes
  const projectedHalfvecBytes =
    state.keptTextBytes + BigInt(state.keptRowsWithEmbedding) * HALFVEC_768_LOGICAL_BYTES
  const percentage = (rows: number) =>
    state.totalRows === 0 ? 0 : Number(((rows / state.totalRows) * 100).toFixed(2))

  return {
    totalRows: state.totalRows,
    keptRows: state.keptRows,
    rejectedRows: state.rejectedRows,
    keptPercentage: percentage(state.keptRows),
    rejectedPercentage: percentage(state.rejectedRows),
    rejectedByReason: { ...state.rejectedByReason },
    distributionByChunkType: [...state.byChunkType.entries()]
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([chunkType, counts]) => ({ chunkType, ...counts })),
    topRejectedPdfs: topRejections(state.rejectedByPdf).map(({ label, rejected }) => ({
      pdf: label,
      rejected,
    })),
    topRejectedMunicipalities: topRejections(state.rejectedByMunicipality).map(
      ({ label, rejected }) => ({ municipality: label, rejected })
    ),
    currentLogicalBytes: (state.currentTextBytes + state.currentEmbeddingBytes).toString(),
    keptBytes: state.keptTextBytes.toString(),
    projectedBytesWithCurrentVector: projectedCurrentVectorBytes.toString(),
    projectedBytesWithHalfvec768: projectedHalfvecBytes.toString(),
    physicalSizeWarning:
      'El tamaño físico final solo puede conocerse creando y midiendo una tabla paralela.',
  }
}
