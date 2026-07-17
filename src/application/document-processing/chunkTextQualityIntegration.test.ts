import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

const pilot = readFileSync(
  path.resolve(process.cwd(), 'scripts/importCorpusPilot.ts'),
  'utf8'
)
const v2 = readFileSync(
  path.resolve(process.cwd(), 'scripts/ingest_family_v2.ts'),
  'utf8'
)

describe('chunk text quality ingestion boundaries', () => {
  it('filtra el corpus piloto antes de preparar la inserción V1', () => {
    expect(pilot).toContain('evaluateChunkTextQuality')
    expect(pilot.indexOf('if (!quality.eligible) continue')).toBeLessThan(
      pilot.indexOf('chunksToImport.push')
    )
    const insertionGuard = pilot.lastIndexOf('evaluateChunkTextQuality')
    expect(insertionGuard).toBeLessThan(pilot.indexOf(".from('normativa_chunks')"))
    expect(pilot.slice(insertionGuard)).toContain('if (!quality.eligible)')
    expect(pilot).not.toMatch(/console\.(?:log|error|warn)\([^\n]*chunk\.texto/)
  })

  it('comprueba la calidad antes de solicitar el embedding V2', () => {
    const invariant = v2.lastIndexOf('evaluateChunkTextQuality')
    const embeddingRequest = v2.indexOf('provider.generateEmbedding')

    expect(invariant).toBeGreaterThan(-1)
    expect(invariant).toBeLessThan(embeddingRequest)
    expect(v2.slice(invariant, embeddingRequest)).toContain('if (!quality.eligible)')
    expect(v2).not.toMatch(/console\.(?:log|error|warn)\([^\n]*c\.content/)
  })
})
