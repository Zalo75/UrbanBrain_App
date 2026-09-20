import { sql } from 'drizzle-orm'
import type { OrdinanceCandidate } from '@/domain/territorial-resolver/types'
import { db } from '@/infrastructure/db/client'

type Row = { chunkId: string; filename: string; content: string; sourceUrl: string | null }

function clean(value: string) {
  return value.replace(/[\u00ad\u200b]/g, '').replace(/\s+/g, ' ').trim()
}

function slug(value: string) {
  return value.toLocaleUpperCase('gl-ES').replace(/[^A-Z0-9]+/g, '_').replace(/^_|_$/g, '')
}

/** Extracts only explicit ordinance headings from the official instrument text. */
export async function loadDynamicInstrumentIdentityCandidates(
  municipalityCode: string | undefined,
  instrumentId: string | undefined,
  documentNames: string[] = [],
): Promise<OrdinanceCandidate[]> {
  if (!municipalityCode || !instrumentId) return []
  // Unit tests can provide the lightweight query-builder mock used by the
  // planning adapter. Dynamic enrichment is optional and must not make the
  // static planning path depend on that mock exposing raw SQL execution.
  if (typeof (db as { execute?: unknown }).execute !== 'function') return []
  const rows = await db.execute<Row>(sql`
    select chunk_id as "chunkId", nombre_pdf as filename, texto as content, ruta_pdf as "sourceUrl"
    from public.normativa_chunks
    where municipio_codigo = ${municipalityCode}
      and ${documentNames.length > 0
        ? sql`nombre_pdf in (${sql.join(documentNames.map((name) => sql`${name}`), sql`, `)})`
        : sql`nombre_pdf like ${instrumentId + '%'}`}
    order by nombre_pdf, chunk_id
  `)
  const candidates = new Map<string, OrdinanceCandidate>()
  for (const row of rows) {
    for (const rawLine of row.content.split(/\r?\n/)) {
      const line = clean(rawLine)
      const match = line.match(/\b(?:Art(?:í?culo|igo|\.|º)?\s*\d{1,4}\s*[.:-]?\s*)?Ordenanza\s+(?:N[º°o]?\s*)?([A-Za-z]{0,4}[- ]?\d{1,3}[A-Za-zªa-z]?)\s*[^A-Za-z0-9\s]?\s*(.{5,220})$/i)
      if (!match) continue
      const code = clean(match[1]).toUpperCase()
      const label = clean(match[2]).replace(/[.;,:–—-]+$/, '')
      if (!code || label.length < 5) continue
      const key = code
      const source = row.sourceUrl ?? `siotuga:instrument-documents:${instrumentId}:${row.filename}`
      const candidate: OrdinanceCandidate = {
        identity: code,
        normalizedIdentity: code,
        semanticDimension: 'ordinance',
        instrumentId,
        sourceRef: source,
        sourceDocument: row.filename,
        graphicEvidence: 'La aplicabilidad parcelaria no se ha determinado automáticamente.',
        documentaryEvidence: line,
        instrumentMembership: undefined,
        provenance: [source, `chunk:${row.chunkId}`],
        confidence: 'medium',
        status: 'review',
        identityId: `${instrumentId}:ordinance:${slug(code)}`,
        catalogStatus: 'REVIEW_REQUIRED',
        normativeReferences: [{ documentId: row.filename, chunkIds: [row.chunkId], relation: 'defines', sourceId: source }],
      }
      const existing = candidates.get(key)
      const score = (value: OrdinanceCandidate) =>
        (value.sourceDocument?.match(/no108\.pdf$/i) ? 4 : 0) +
        (value.documentaryEvidence?.match(/Art[ií]culo/i) ? 2 : 0) -
        ((value.documentaryEvidence?.match(/[?¿#]/g) ?? []).length)
      if (!existing || score(candidate) > score(existing)) candidates.set(key, candidate)
    }
  }
  return [...candidates.values()]
}
