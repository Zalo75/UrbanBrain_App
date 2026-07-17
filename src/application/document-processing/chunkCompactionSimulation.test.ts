import { describe, expect, it } from 'vitest'

import {
  FIRST_PAGE_SQL,
  NEXT_PAGE_SQL,
  READ_ONLY_TRANSACTION_SQL,
  SIMULATION_SELECT_STATEMENTS,
  addSimulationRow,
  buildChunkCompactionSimulationReport,
  createChunkCompactionSimulationState,
  createSimulationPageRequest,
  normalizeSimulationOptions,
  type NormativaChunkSimulationRow,
} from './chunkCompactionSimulation'

function row(overrides: Partial<NormativaChunkSimulationRow> = {}): NormativaChunkSimulationRow {
  return {
    id: 'not-logged-or-reported',
    tipo_chunk: 'BLOQUE',
    nombre_pdf: 'normas.pdf',
    municipio_codigo: '15009',
    municipio_nombre: 'Betanzos',
    texto: 'Artículo 12. La ocupación máxima será del 40 por ciento de la parcela.',
    texto_bytes: '80',
    embedding_bytes: '3076',
    ...overrides,
  }
}

describe('chunk compaction simulation pagination', () => {
  it('uses bounded deterministic keyset pages and respects the limit', () => {
    const options = normalizeSimulationOptions({ batchSize: 250, limit: 620 })

    expect(createSimulationPageRequest(options, 0)).toEqual({
      sql: FIRST_PAGE_SQL,
      params: [250],
      pageSize: 250,
    })
    expect(createSimulationPageRequest(options, 500, 'last-id')).toEqual({
      sql: NEXT_PAGE_SQL,
      params: ['last-id', 120],
      pageSize: 120,
    })
    expect(createSimulationPageRequest(options, 620, 'last-id')).toBeNull()
  })

  it('rejects unsafe batch and limit values', () => {
    expect(() => normalizeSimulationOptions({ batchSize: 0 })).toThrow()
    expect(() => normalizeSimulationOptions({ batchSize: 1_001 })).toThrow()
    expect(() => normalizeSimulationOptions({ batchSize: 10, limit: -1 })).toThrow()
  })

  it('keeps every data statement SELECT-only and never selects the vector value', () => {
    const forbidden = /\b(?:insert|update|delete|alter|create|vacuum|call|do|copy|truncate|grant|revoke|merge)\b/iu
    for (const sql of SIMULATION_SELECT_STATEMENTS) {
      expect(sql.trimStart().toUpperCase().startsWith('SELECT')).toBe(true)
      expect(sql).not.toMatch(forbidden)
      expect(sql).not.toMatch(/select\s+\*/iu)
      expect(sql).toMatch(/pg_column_size\(embedding\)/iu)
      expect(sql.replace(/pg_column_size\(embedding\)/giu, '')).not.toMatch(/\bembedding\b/iu)
      expect(sql).toMatch(/order by id asc/iu)
    }
    expect(READ_ONLY_TRANSACTION_SQL).toBe(
      'BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY'
    )
  })
})

describe('chunk compaction simulation aggregation', () => {
  it('applies the production filter and calculates byte projections', () => {
    const state = createChunkCompactionSimulationState()
    addSimulationRow(state, row())
    addSimulationRow(
      state,
      row({
        id: 'another-hidden-id',
        texto: '( ( ( ( ( ( ( ( ( ( ( ( ( ( ( ( ( ( ( (',
        texto_bytes: '40',
        nombre_pdf: 'plano.pdf',
        embedding_bytes: '3076',
      })
    )

    expect(buildChunkCompactionSimulationReport(state)).toMatchObject({
      totalRows: 2,
      keptRows: 1,
      rejectedRows: 1,
      keptPercentage: 50,
      rejectedPercentage: 50,
      currentLogicalBytes: '6272',
      keptBytes: '80',
      projectedBytesWithCurrentVector: '3156',
      projectedBytesWithHalfvec768: '1624',
      topRejectedPdfs: [{ pdf: 'plano.pdf', rejected: 1 }],
      topRejectedMunicipalities: [{ municipality: '15009 - Betanzos', rejected: 1 }],
    })
  })

  it('counts every rejection reason while counting each rejected row once', () => {
    const state = createChunkCompactionSimulationState()
    addSimulationRow(
      state,
      row({ texto: '( ( ( ( ( ( ( ( ( ( ( ( ( ( ( ( ( ( ( (' })
    )
    const report = buildChunkCompactionSimulationReport(state)

    expect(report.rejectedRows).toBe(1)
    expect(Object.values(report.rejectedByReason).reduce((sum, count) => sum + count, 0)).toBeGreaterThan(1)
    expect(report.distributionByChunkType).toEqual([
      { chunkType: 'BLOQUE', total: 1, kept: 0, rejected: 1 },
    ])
  })

  it('sorts and caps rejection rankings without exposing row identifiers', () => {
    const state = createChunkCompactionSimulationState()
    for (let index = 0; index < 25; index += 1) {
      addSimulationRow(
        state,
        row({
          id: `sensitive-${index}`,
          texto: '( ( ( ( ( ( ( ( ( ( ( ( ( ( ( ( ( ( ( (',
          nombre_pdf: `plano-${String(index).padStart(2, '0')}.pdf`,
          municipio_codigo: String(15_000 + index),
          municipio_nombre: `Municipio ${index}`,
        })
      )
    }
    const serialized = JSON.stringify(buildChunkCompactionSimulationReport(state))
    const report = buildChunkCompactionSimulationReport(state)

    expect(report.topRejectedPdfs).toHaveLength(20)
    expect(report.topRejectedMunicipalities).toHaveLength(20)
    expect(serialized).not.toContain('sensitive-')
  })
})
