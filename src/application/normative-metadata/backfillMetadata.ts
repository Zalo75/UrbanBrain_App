import { NormativeRegimeIdentity } from '@/domain/parcel-context/types'

export interface ChunkForBackfill {
  id: string
  content: string
  page?: number
  chunkIndex?: number
  article?: string | null
  chapter?: string | null
  detectedTitle?: string | null
}

export interface EnrichedChunkMetadata {
  id: string
  metadata: {
    regime?: NormativeRegimeIdentity
    hierarchy?: {
      title?: string
      chapter?: string
      article?: string
    }
  }
}

// Simple deterministic heuristic based on standard regexes
const ORDINANCE_HEADING_REGEX = /^\s*(?:ORDENANZA|ZONA|ÁMBITO)\s+(?:N(?:[ºo°.]|UMERO)?\s*)?([A-Z0-9][A-Z0-9._/-]{0,15})/i
const GENERAL_HEADING_REGEX = /^\s*(?:DISPOSICIONES|NORMAS)\s+GENERALES/i

export function processDocumentChunks(chunks: ChunkForBackfill[]): EnrichedChunkMetadata[] {
  // Sort chunks by index to ensure linear flow
  const sortedChunks = [...chunks].sort((a, b) => (a.chunkIndex ?? 0) - (b.chunkIndex ?? 0))
  
  const results: EnrichedChunkMetadata[] = []
  
  let currentRegime: NormativeRegimeIdentity | undefined = undefined

  for (const chunk of sortedChunks) {
    // 1. Prioritize explicit structure if available (V2)
    const hierarchy = {
      title: chunk.detectedTitle ?? undefined,
      chapter: chunk.chapter ?? undefined,
      article: chunk.article ?? undefined,
    }

    // 2. Check if this chunk introduces a new regime heading
    const textToAnalyze = [chunk.detectedTitle, chunk.content].filter(Boolean).join('\n')
    
    let chunkRegime: NormativeRegimeIdentity | undefined = undefined

    // Determine if it's a new ordinance
    const ordMatch = textToAnalyze.match(ORDINANCE_HEADING_REGEX)
    if (ordMatch) {
      chunkRegime = {
        kind: 'ordinance',
        code: ordMatch[1],
        label: ordMatch[1], // Ideally we'd extract the rest of the line as label
        provenance: 'explicit_heading',
        confidence: 'high'
      }
    } else if (GENERAL_HEADING_REGEX.test(textToAnalyze)) {
      chunkRegime = {
        kind: 'general',
        provenance: 'explicit_heading',
        confidence: 'high'
      }
    } else {
      // 3. Continuity / Herencia jerárquica
      if (currentRegime && currentRegime.kind !== 'general') {
        chunkRegime = {
          ...(currentRegime as NormativeRegimeIdentity),
          provenance: 'inherited_heading',
          // Reduce confidence slightly for inherited, unless we have AI confirmation
          confidence: currentRegime.confidence === 'high' ? 'medium' : currentRegime.confidence
        }
      } else if (currentRegime && currentRegime.kind === 'general') {
        chunkRegime = {
          ...(currentRegime as NormativeRegimeIdentity),
          provenance: 'inherited_heading',
          confidence: 'high'
        }
      }
    }

    // 4. Update the current regime for the following chunks
    if (chunkRegime && (chunkRegime.provenance === 'explicit_heading' || chunkRegime.provenance === 'deterministic_inference')) {
      currentRegime = chunkRegime
    }

    results.push({
      id: chunk.id,
      metadata: {
        regime: chunkRegime,
        hierarchy
      }
    })
  }

  return results
}
