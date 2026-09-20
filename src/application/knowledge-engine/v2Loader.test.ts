import { describe, expect, it } from 'vitest'
import { DEFAULT_ROOT, validateV2Batch } from '../../../scripts/validate_v2_batch'
import { buildV2EmbeddingInput, hashV2EmbeddingInput } from './v2EmbeddingInput'
import { buildRollbackPlan, simulateRollback } from '../../../scripts/rollback_v2_batch'

describe('Vila de Cruces V2 loader dry-run', () => {
  it('reads and transforms the physical corpus without writing remote data', () => {
    const result = validateV2Batch(DEFAULT_ROOT)
    expect(result.remoteDbWrites).toBe(0)
    expect(result.actual.chunks).toBe(10536)
    expect(result.actual.embeddings).toBe(10536)
    expect(result.actual.physicalUniquePdfs).toBe(72)
    expect(result.expected.officialDocumentRecords).toBe(73)
    expect(result.actual.unmappedChunks).toBe(0)
    expect(result.actual.orphanEmbeddings).toBe(0)
    expect(result.plannedDocuments).toBe(72)
    expect(result.chunkPayloads).toHaveLength(10536)
    expect(result.pass).toBe(true)
    expect(result.embeddingHashStatus.legacyAlgorithmUnknown).toBe(0)
    expect(result.embeddingHashStatus.canonicalMatches).toBe(10536)
    expect(result.actual.uniqueSemanticEmbeddings).toBe(10246)
  })

  it('deduplicates 2623no002 physical bytes while retaining both official identities', () => {
    const result = validateV2Batch(DEFAULT_ROOT)
    const documents = result.documents.filter((document) => document.metadata?.filename === '2623no002.pdf')
    expect(documents).toHaveLength(1)
    expect(documents[0].metadata.officialDocumentIds).toEqual(expect.arrayContaining(['35461', '35463']))
    expect(new Set(result.documents.map((document) => document.file_hash)).size).toBe(result.documents.length)
  })

  it('keeps canonical embedding input and hash deterministic', () => {
    const chunk = { parentHeading: '  A  ', section: null, article: '1', ordinanceOrZoneCandidate: undefined, text: 'hola\n mundo' }
    expect(buildV2EmbeddingInput(chunk)).toBe('parentHeading=A\nsection=\narticle=1\nordinanceOrZoneCandidate=\nchunkText=hola mundo')
    expect(hashV2EmbeddingInput(chunk)).toBe(hashV2EmbeddingInput({ ...chunk }))
  })

  it('defines an isolated, shared-document-safe rollback plan', () => {
    expect(buildRollbackPlan('batch').executable).toBe(false)
    expect(simulateRollback([
      { documentId: 'a', batchId: 'batch', otherBatchReferences: 0 },
      { documentId: 'b', batchId: 'batch', otherBatchReferences: 1 },
    ], 'batch')).toMatchObject({ deletedChunks: 2, deletedDocuments: 1, retainedSharedDocuments: 1, remoteDbWrites: 0 })
  })
})
