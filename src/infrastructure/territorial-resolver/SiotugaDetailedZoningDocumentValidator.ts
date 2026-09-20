import type {
  DetailedZoningDocumentValidator,
} from './SiotugaDetailedZoningEvidenceProvider'
import type { PlanningDocumentReference } from '@/domain/territorial-resolver/types'
// Import the parser implementation directly: the package entry point runs its
// development fixture when loaded under a test runner.
// @ts-expect-error pdf-parse does not publish types for its implementation path.
import pdf from 'pdf-parse/lib/pdf-parse.js'

function normalize(value: string) {
  return value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toUpperCase().replace(/\s+/g, ' ').trim()
}

function labelVariants(label: string) {
  const normalized = normalize(label)
  const number = normalized.match(/(?:ORDENANZA|ORD|Nº|NO\.?|N)\s*([0-9]+)|^([0-9]+)$/)?.[1] ?? normalized.match(/^([0-9]+)$/)?.[1]
  if (!number) return [normalized]
  return [`ORDENANZA ${number}`, `ORDENANZA Nº ${number}`, `ORDENANZA ${number}ª`, `ORD ${number}`]
}

function extractMatches(text: string, label: string) {
  const normalizedText = normalize(text)
  const matches = new Set<string>()
  for (const variant of labelVariants(label)) {
    const index = normalizedText.indexOf(variant)
    if (index < 0) continue
    const start = Math.max(0, normalizedText.lastIndexOf('\n', index) + 1)
    const end = normalizedText.indexOf('\n', index + variant.length)
    matches.add(normalizedText.slice(start, end < 0 ? index + variant.length + 180 : end).trim())
  }
  return [...matches]
}

export class SiotugaDetailedZoningDocumentValidator implements DetailedZoningDocumentValidator {
  constructor(private readonly fetcher: typeof fetch = fetch, private readonly maxDocuments = 16) {}

  async validate(input: {
    observedLabel: string
    instrumentId: string
    documents: PlanningDocumentReference[]
  }) {
    const documents = input.documents
      .filter((document) => document.instrumentId === input.instrumentId)
      .filter((document) => document.documentType === undefined || document.documentType === 'ordinance' || document.documentType === 'normative_text' || document.documentType === 'sheet')
      .slice(0, this.maxDocuments)
    const matches: Array<{ document: PlanningDocumentReference; exactEvidence: string; page: number }> = []
    for (const document of documents) {
      let response: Response
      try {
        response = await this.fetcher(document.sourceUrl)
      } catch {
        continue
      }
      if (!response.ok) continue
      const buffer = Buffer.from(await response.arrayBuffer())
      if (!/application\/pdf|\.pdf(?:$|\?)/i.test(response.headers.get('content-type') ?? '') && !/\.pdf(?:$|\?)/i.test(document.sourceUrl)) continue
      let parsed: { text?: string }
      try {
        parsed = await pdf(buffer)
      } catch {
        continue
      }
      const pages = (parsed.text ?? '').split('\f')
      pages.forEach((page, pageIndex) => {
        for (const exactEvidence of extractMatches(page, input.observedLabel)) {
          matches.push({ document, exactEvidence, page: pageIndex + 1 })
        }
      })
    }
    const identities = [...new Set(matches.map((match) => match.exactEvidence))]
    if (identities.length !== 1) return null
    const match = matches[0]!
    return {
      identity: match.exactEvidence,
      sourceDocument: match.document.sourceUrl,
      documentaryEvidence: `${match.document.title}; página ${match.page}; ${match.exactEvidence}`,
    }
  }
}
