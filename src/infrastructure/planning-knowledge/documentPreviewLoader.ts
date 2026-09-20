import { sql } from 'drizzle-orm'
import { db } from '@/infrastructure/db/client'
import type { PlanningDocumentReference } from '@/domain/territorial-resolver/types'

export const MAX_PREVIEW_LENGTH = 250

/**
 * Normative document types that Luna can actively search for urbanistic regulations.
 * Ineligible types like 'other' (memoria, planos, cartografía) or 'catalogue' are excluded
 * to avoid inflating the document catalog with non-normative previews.
 */
export const ELIGIBLE_NORMATIVE_TYPES = new Set<string>([
  'normative_text',
  'ordinance',
  'sheet',
])

export function isEligibleForDocumentPreview(document: PlanningDocumentReference): boolean {
  if (!document.documentType) return true
  return ELIGIBLE_NORMATIVE_TYPES.has(document.documentType)
}

/**
 * Performs innocuous mechanical whitespace cleanup and caps at MAX_PREVIEW_LENGTH (250).
 * Does NOT rewrite, summarize, or alter characters (bad OCR is strictly preserved).
 */
export function sanitizeDocumentPreview(rawText: string): string {
  return rawText
    .replace(/[\u00ad\u200b]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, MAX_PREVIEW_LENGTH)
}

export function extractCorpusFileName(document: PlanningDocumentReference): string | null {
  if (/\.pdf$/i.test(document.id.trim())) return document.id.trim()
  try {
    const fileName = decodeURIComponent(new URL(document.sourceUrl).pathname.split('/').pop() ?? '')
    return /\.pdf$/i.test(fileName) ? fileName : null
  } catch {
    return null
  }
}

export type DocumentPreviewResolver = (
  municipalityCode: string,
  fileNames: string[],
  officialDocumentIds: string[],
) => Promise<Map<string, string>>

/**
 * Loads first-chunk literal previews for eligible normative documents from
 * the official database (normativa_chunks or normative_chunks_v2).
 */
export async function enrichPlanningDocumentPreviews(
  documents: PlanningDocumentReference[],
  municipalityCode?: string | null,
  instrumentId?: string | null,
  customResolver?: DocumentPreviewResolver,
): Promise<PlanningDocumentReference[]> {
  if (!Array.isArray(documents) || documents.length === 0) return documents
  const cleanMuni = municipalityCode?.trim()
  if (!cleanMuni) return documents

  const eligibleDocs = documents.filter(isEligibleForDocumentPreview)
  if (eligibleDocs.length === 0) return documents

  const fileNames: string[] = []
  const officialIds: string[] = []
  const docByFileName = new Map<string, PlanningDocumentReference>()
  const docByOfficialId = new Map<string, PlanningDocumentReference>()

  for (const doc of eligibleDocs) {
    officialIds.push(doc.id)
    docByOfficialId.set(doc.id, doc)
    const fileName = extractCorpusFileName(doc)
    if (fileName) {
      fileNames.push(fileName)
      docByFileName.set(fileName, doc)
    }
  }

  let previewsMap = new Map<string, string>()

  if (customResolver) {
    previewsMap = await customResolver(cleanMuni, fileNames, officialIds)
  } else if (typeof (db as { execute?: unknown }).execute === 'function') {
    // 1. Try v2 chunks first (if available)
    if (officialIds.length > 0) {
      try {
        const v2Rows = await db.execute<{ officialIdentifier: string; content: string }>(sql`
          select distinct on (nd.official_identifier)
            nd.official_identifier as "officialIdentifier",
            nc.content as "content"
          from public.normative_documents_v2 nd
          join public.normative_chunks_v2 nc on nc.document_id = nd.id
          where nd.municipality_id = ${cleanMuni}
            and nd.official_identifier in (${sql.join(officialIds.map((id) => sql`${id}`), sql`, `)})
            and nd.status = 'vigente'
          order by nd.official_identifier, nc.page asc nulls last, nc.id asc
        `)
        for (const row of v2Rows) {
          if (row.officialIdentifier && row.content) {
            previewsMap.set(row.officialIdentifier, row.content)
          }
        }
      } catch {
        // v2 table query may fail if table doesn't exist or is not populated
      }
    }

    // 2. Query legacy normativa_chunks for remaining files
    const remainingFiles = fileNames.filter((fileName) => {
      const doc = docByFileName.get(fileName)
      return !doc || !previewsMap.has(doc.id)
    })

    if (remainingFiles.length > 0) {
      try {
        const v1Rows = await db.execute<{ filename: string; content: string }>(sql`
          select distinct on (nombre_pdf)
            nombre_pdf as "filename",
            texto as "content"
          from public.normativa_chunks
          where municipio_codigo = ${cleanMuni}
            and nombre_pdf in (${sql.join(remainingFiles.map((name) => sql`${name}`), sql`, `)})
          order by nombre_pdf, chunk_id asc
        `)
        for (const row of v1Rows) {
          if (row.filename && row.content) {
            previewsMap.set(row.filename, row.content)
          }
        }
      } catch (err) {
        console.error('[DocumentPreviewLoader] Failed to query normativa_chunks:', err)
      }
    }
  }

  return documents.map((doc) => {
    if (!isEligibleForDocumentPreview(doc)) return doc
    const fileName = extractCorpusFileName(doc)
    const rawContent = previewsMap.get(doc.id) ?? (fileName ? previewsMap.get(fileName) : undefined)
    if (!rawContent || !rawContent.trim()) return doc
    return {
      ...doc,
      preview: sanitizeDocumentPreview(rawContent),
    }
  })
}
