export interface V2ProvenanceInput {
  municipalityCode?: string | null
  instrumentId?: string | null
  parentInstrumentId?: string | null
  officialDocumentId?: string | null
  article?: string | null
  page?: string | number | null
  officialUrl?: string | null
  checksum?: string | null
  documentType?: string | null
  batchId?: string | null
  metadata?: Record<string, unknown> | null
}

const value = (direct: unknown, metadata: Record<string, unknown> | null | undefined, key: string) =>
  (typeof direct === 'string' && direct.trim() ? direct.trim() : undefined) ??
  (typeof metadata?.[key] === 'string' && String(metadata[key]).trim() ? String(metadata[key]).trim() : null)

export function preserveV2Provenance(input: V2ProvenanceInput) {
  const metadata = input.metadata
  return {
    municipalityCode: value(input.municipalityCode, metadata, 'municipalityCode'),
    instrumentId: value(input.instrumentId, metadata, 'instrumentId'),
    parentInstrumentId: value(input.parentInstrumentId, metadata, 'parentInstrumentId'),
    officialDocumentId: value(input.officialDocumentId, metadata, 'officialDocumentId'),
    article: value(input.article, metadata, 'article'),
    page: input.page ?? metadata?.page ?? null,
    officialUrl: value(input.officialUrl, metadata, 'officialUrl'),
    checksum: value(input.checksum, metadata, 'checksum'),
    documentType: value(input.documentType, metadata, 'documentType'),
    batchId: value(input.batchId, metadata, 'batchId'),
  }
}
