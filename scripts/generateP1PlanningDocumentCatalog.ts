import { createHash } from 'node:crypto'
import { writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'

import type { PlanningDocumentReference } from '@/domain/territorial-resolver/types'
import { CORUNA_P1_PLANNING_KNOWLEDGE } from '@/infrastructure/planning-knowledge/corunaP1PlanningKnowledge'
import { SiotugaPlanningKnowledgeSource } from '@/infrastructure/planning-knowledge/SiotugaPlanningKnowledgeSource'

function sha256(value: string) {
  return createHash('sha256').update(value).digest('hex')
}

async function mapWithConcurrency<T, R>(
  values: readonly T[],
  concurrency: number,
  mapper: (value: T) => Promise<R>
) {
  const results = new Array<R>(values.length)
  let nextIndex = 0
  async function worker() {
    while (nextIndex < values.length) {
      const index = nextIndex++
      results[index] = await mapper(values[index]!)
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, values.length) }, worker))
  return results
}

function renderCatalog(input: {
  generatedAt: string
  sourceSha256: string
  documentsByInstrumentId: Record<string, PlanningDocumentReference[]>
}) {
  return `/* This file is generated from official instrument manifests. Do not edit manually. */
import type { PlanningDocumentReference } from '@/domain/territorial-resolver/types'

export const CORUNA_P1_DOCUMENT_CATALOG_GENERATED_AT = ${JSON.stringify(input.generatedAt)}
export const CORUNA_P1_DOCUMENT_CATALOG_SOURCE_SHA256 = ${JSON.stringify(input.sourceSha256)}

export const CORUNA_P1_DOCUMENTS_BY_INSTRUMENT = ${JSON.stringify(input.documentsByInstrumentId, null, 2)} as const satisfies Record<string, readonly PlanningDocumentReference[]>
`
}

async function main() {
  const outputArgument = process.argv.slice(2).find((argument) => argument.startsWith('--output='))
  if (!outputArgument) throw new Error('--output is required')
  const output = resolve(outputArgument.slice('--output='.length))
  const generatedAt = new Date().toISOString()
  const source = new SiotugaPlanningKnowledgeSource()
  const collected = await mapWithConcurrency(
    CORUNA_P1_PLANNING_KNOWLEDGE,
    4,
    async (municipality) => ({
      instrumentId: municipality.instrument.officialId,
      ...(await source.collectInstrumentDocuments(
        municipality.municipalityCode,
        municipality.instrument.officialId,
        generatedAt
      )),
    })
  )
  const documentsByInstrumentId = Object.fromEntries(
    collected
      .sort((left, right) => left.instrumentId.localeCompare(right.instrumentId))
      .map((entry) => [
        entry.instrumentId,
        entry.documents.map((document): PlanningDocumentReference => ({
          id: document.officialDocumentId,
          instrumentId: document.instrumentId,
          title: document.name,
          sourceUrl: document.officialUrl,
          binding: 'general',
          documentType: document.documentType,
        })),
      ])
  )
  const sourceSha = sha256(
    JSON.stringify(
      collected
        .map((entry) => ({
          id: entry.rawSource.id,
          sha256: sha256(entry.rawSource.content),
        }))
        .sort((left, right) => left.id.localeCompare(right.id))
    )
  )
  await writeFile(
    output,
    renderCatalog({ generatedAt, sourceSha256: sourceSha, documentsByInstrumentId }),
    'utf8'
  )
  console.log(JSON.stringify({
    output,
    instruments: collected.length,
    documents: Object.values(documentsByInstrumentId).reduce(
      (total, documents) => total + documents.length,
      0
    ),
    sourceSha256: sourceSha,
  }, null, 2))
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : 'Document catalog generation failed')
  process.exitCode = 1
})
