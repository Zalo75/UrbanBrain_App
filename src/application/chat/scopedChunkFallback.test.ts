import { describe, expect, it } from 'vitest'
import { rankScopedChunkRows } from './scopedChunkFallback'

function vector(values: number[]) { return `[${values.join(',')}]` }

describe('rankScopedChunkRows', () => {
  it('ranks only the already scoped corpus and preserves ordinance filtering', () => {
    const rows = [
      { chunk_id: 'a', texto: 'ocupación máxima 30%', titulo_detectado: 'Ordenanza', embedding: vector([1, 0]), municipio_nombre: 'Arzúa', nombre_pdf: '22210no001.pdf' },
      { chunk_id: 'b', texto: 'retranqueo 5m', titulo_detectado: 'Otra', embedding: vector([0, 1]), municipio_nombre: 'Arzúa', nombre_pdf: '22210no001.pdf' },
    ]
    expect(rankScopedChunkRows(rows, [1, 0], 8, 'ocupación')).toMatchObject([{ chunk_id: 'a', similarity: 1 }])
  })

  it('does not invent rows when vectors are malformed', () => {
    expect(rankScopedChunkRows([{ chunk_id: 'bad', embedding: '[x,y]' }], [1, 0], 8)).toEqual([])
  })

  it('does not confuse an ordinance code with a longer code', () => {
    const rows = [
      { chunk_id: 'exact', texto: 'Ordenanza R-2', embedding: vector([1, 0]) },
      { chunk_id: 'longer', texto: 'Ordenanza R-20', embedding: vector([1, 0]) },
    ]
    expect(rankScopedChunkRows(rows, [1, 0], 8, 'R-2').map((row) => row.chunk_id)).toEqual(['exact'])
  })
})
