import crypto from 'node:crypto'

export interface V2EmbeddingInputChunk {
  parentHeading?: unknown
  section?: unknown
  article?: unknown
  ordinanceOrZoneCandidate?: unknown
  text?: unknown
}

const clean = (value: unknown) => String(value ?? '').replace(/\s+/g, ' ').trim()

/** Canonical, versionable input for future V2 embedding generation. */
export function buildV2EmbeddingInput(chunk: V2EmbeddingInputChunk): string {
  return [
    ['parentHeading', clean(chunk.parentHeading)],
    ['section', clean(chunk.section)],
    ['article', clean(chunk.article)],
    ['ordinanceOrZoneCandidate', clean(chunk.ordinanceOrZoneCandidate)],
    ['chunkText', clean(chunk.text)],
  ].map(([key, value]) => `${key}=${value}`).join('\n')
}

export function hashV2EmbeddingInput(chunk: V2EmbeddingInputChunk): string {
  return crypto.createHash('sha256').update(buildV2EmbeddingInput(chunk), 'utf8').digest('hex')
}
