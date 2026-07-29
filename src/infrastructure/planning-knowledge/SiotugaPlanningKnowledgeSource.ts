import {
  CORUNA_PLANNING_KNOWLEDGE_EXCLUSIONS,
  extractWfsLayerNames,
} from '@/application/planning-knowledge/generatePlanningKnowledge'
import { fetchSiotugaPlanningHtml, parseSiotugaCorunaPlanning } from '@/application/municipal-planning-import/corunaPlanningImport'
import type {
  PlanningInstrumentKind,
  PlanningInstrumentKnowledge,
  PlanningKnowledgeGenerationInput,
  RawOfficialSource,
} from '@/domain/planning-knowledge/types'
import { aCorunaMunicipalities } from '@/shared/territory/provinces/a_coruna'

const SIOTUGA_BASE_URL = 'https://siotuga.xunta.gal/siotuga/'
const SIOTUGA_STATUS_URL = `${SIOTUGA_BASE_URL}urb?lang=es_ES`
const REQUEST_HEADERS = {
  accept: 'text/html,application/xhtml+xml,application/json,application/xml;q=0.9,*/*;q=0.8',
  'accept-language': 'es-ES,es;q=0.9',
  'user-agent': 'Mozilla/5.0 (compatible; UrbanBrain planning knowledge generator/1.0)',
}

const INVENTORY_CLASSES = [
  { id: '14', kind: 'general' },
  { id: '13', kind: 'development' },
  { id: '16', kind: 'historical' },
  { id: '18', kind: 'rural_nucleus_delimitation' },
] as const satisfies ReadonlyArray<{ id: string; kind: PlanningInstrumentKind }>

interface SiotugaInventoryRow {
  id?: unknown
  docnome?: unknown
  figura?: unknown
  fechaaddef?: unknown
  fechabop?: unknown
  fechadog?: unknown
  fechanormativabop?: unknown
  incidencias_iuris?: unknown
}

function requiredString(value: unknown, field: string) {
  if (typeof value !== 'string' || !value.trim()) {
    throw new Error(`SIOTUGA inventory contract changed: ${field} is missing`)
  }
  return value.trim()
}

function optionalString(value: unknown) {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined
}

function inventoryToken(html: string) {
  const token = /id=["']token["'][^>]*value=["']([^"']+)["']/i.exec(html)?.[1]
  if (!token) throw new Error('SIOTUGA inventory contract changed: token missing')
  return token
}

function sessionCookie(response: Response) {
  const setCookie = response.headers.get('set-cookie')
  if (!setCookie) throw new Error('SIOTUGA inventory contract changed: session cookie missing')
  return setCookie.split(';', 1)[0] ?? ''
}

async function responseText(response: Response, label: string) {
  const content = await response.text()
  if (!response.ok) throw new Error(`${label} failed with HTTP ${response.status}`)
  return content
}

function parseInventoryResponse(content: string, kind: PlanningInstrumentKind, sourceId: string) {
  let parsed: unknown
  try {
    parsed = JSON.parse(content)
  } catch {
    throw new Error('SIOTUGA inventory contract changed: invalid JSON')
  }
  if (parsed === null) return []
  if (!Array.isArray(parsed)) throw new Error('SIOTUGA inventory contract changed: array expected')

  return parsed.map((value): PlanningInstrumentKnowledge => {
    const row = value as SiotugaInventoryRow
    const figure = requiredString(row.figura, 'figura')
    const name = optionalString(row.docnome) ?? figure
    const resolvedKind =
      kind === 'general' &&
      /modificaci[oó]n|cambio de uso|correcci[oó]n|texto refundido/i.test(`${figure} ${name}`)
        ? 'general_modification'
        : kind
    return {
      officialId: requiredString(row.id, 'id'),
      kind: resolvedKind,
      name,
      figure,
      approvalDate: optionalString(row.fechaaddef),
      bopDate: optionalString(row.fechabop),
      dogDate: optionalString(row.fechadog),
      normativePublicationDate: optionalString(row.fechanormativabop),
      legalIncidents: optionalString(row.incidencias_iuris),
      sourceId,
    }
  })
}

function source(input: Omit<RawOfficialSource, 'provider'>): RawOfficialSource {
  return { provider: 'siotuga', ...input }
}

export class SiotugaPlanningKnowledgeSource {
  constructor(private readonly fetcher: typeof fetch = fetch) {}

  private async collectInventory(municipalityCode: string, retrievedAt: string) {
    const pageUrl = `${SIOTUGA_BASE_URL}inventario.php?inv=1&idconcello=${municipalityCode}`
    const pageResponse = await this.fetcher(pageUrl, { headers: REQUEST_HEADERS })
    const pageContent = await responseText(pageResponse, `SIOTUGA inventory ${municipalityCode}`)
    const cookie = sessionCookie(pageResponse)
    const token = inventoryToken(pageContent)
    // The inventory page contains an ephemeral anti-CSRF token. It is used only
    // for this session and is deliberately excluded from versioned snapshots.
    const rawSources: RawOfficialSource[] = []
    const instruments: PlanningInstrumentKnowledge[] = []

    for (const inventoryClass of INVENTORY_CLASSES) {
      const endpoint = `${SIOTUGA_BASE_URL}assets/inventario/query_document.php`
      const body = new URLSearchParams({
        id: municipalityCode,
        token,
        idclase: inventoryClass.id,
      })
      const response = await this.fetcher(endpoint, {
        method: 'POST',
        headers: {
          ...REQUEST_HEADERS,
          accept: 'application/json',
          'content-type': 'application/x-www-form-urlencoded; charset=UTF-8',
          cookie,
        },
        body,
      })
      const content = await responseText(
        response,
        `SIOTUGA ${inventoryClass.kind} inventory ${municipalityCode}`
      )
      const sourceId = `siotuga:inventory:${municipalityCode}:${inventoryClass.kind}`
      rawSources.push(
        source({
          id: sourceId,
          url: `${endpoint}#municipality=${municipalityCode}&class=${inventoryClass.id}`,
          retrievedAt,
          mediaType: 'application/json',
          content,
        })
      )
      instruments.push(...parseInventoryResponse(content, inventoryClass.kind, sourceId))
    }

    return { instruments, rawSources }
  }

  async collectMunicipality(municipalityCode: string, retrievedAt: string) {
    const capabilitiesUrl = `${SIOTUGA_BASE_URL}ws?codine=${municipalityCode}&SERVICE=WFS&VERSION=1.1.0&REQUEST=GetCapabilities`
    const capabilitiesResponse = await this.fetcher(capabilitiesUrl, { headers: REQUEST_HEADERS })
    const capabilitiesXml = await responseText(
      capabilitiesResponse,
      `SIOTUGA WFS capabilities ${municipalityCode}`
    )
    if (!/WFS_Capabilities|WFS_Capability/i.test(capabilitiesXml)) {
      throw new Error(`SIOTUGA WFS contract changed for ${municipalityCode}`)
    }
    const capabilitiesSourceId = `siotuga:wfs-capabilities:${municipalityCode}`
    const rawSources: RawOfficialSource[] = [
      source({
        id: capabilitiesSourceId,
        url: capabilitiesUrl,
        retrievedAt,
        mediaType: 'application/xml',
        content: capabilitiesXml,
      }),
    ]
    const layerSchemas: Record<string, { sourceId: string; xml: string }> = {}

    for (const layerName of extractWfsLayerNames(capabilitiesXml, municipalityCode).filter((name) =>
      name.includes('_3CLAS_')
    )) {
      const describeUrl = `${SIOTUGA_BASE_URL}ws?codine=${municipalityCode}&SERVICE=WFS&VERSION=1.1.0&REQUEST=DescribeFeatureType&TYPENAME=${encodeURIComponent(layerName)}`
      const describeResponse = await this.fetcher(describeUrl, { headers: REQUEST_HEADERS })
      const xml = await responseText(
        describeResponse,
        `SIOTUGA DescribeFeatureType ${municipalityCode}/${layerName}`
      )
      const sourceId = `siotuga:wfs-schema:${municipalityCode}:${layerName}`
      layerSchemas[layerName] = { sourceId, xml }
      rawSources.push(
        source({
          id: sourceId,
          url: describeUrl,
          retrievedAt,
          mediaType: 'application/xml',
          content: xml,
        })
      )
    }

    const inventory = await this.collectInventory(municipalityCode, retrievedAt)
    rawSources.push(...inventory.rawSources)

    return {
      municipalityCode,
      capabilitiesSourceId,
      capabilitiesXml,
      inventory: inventory.instruments,
      layerSchemas,
      sourceIds: rawSources.map((item) => item.id),
      rawSources,
    }
  }
}

async function mapWithConcurrency<T, R>(
  values: T[],
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

export async function collectCorunaPlanningKnowledgeInput(options?: {
  fetcher?: typeof fetch
  generatedAt?: string
  concurrency?: number
}): Promise<PlanningKnowledgeGenerationInput> {
  const generatedAt = options?.generatedAt ?? new Date().toISOString()
  const fetcher = options?.fetcher ?? fetch
  const statusHtml = await fetchSiotugaPlanningHtml(fetcher)
  const statusSource = source({
    id: 'siotuga:planning-status:galicia',
    url: SIOTUGA_STATUS_URL,
    retrievedAt: generatedAt,
    mediaType: 'text/html',
    content: statusHtml,
  })
  const municipalityCatalog = aCorunaMunicipalities.flatMap((municipality) =>
    municipality.ineCode ? [{ ineCode: municipality.ineCode, name: municipality.name }] : []
  )
  const excluded = new Set<string>(CORUNA_PLANNING_KNOWLEDGE_EXCLUSIONS)
  const targets = municipalityCatalog.filter((municipality) => !excluded.has(municipality.ineCode))
  const collector = new SiotugaPlanningKnowledgeSource(fetcher)
  const collected = await mapWithConcurrency(
    targets,
    options?.concurrency ?? 4,
    (municipality) => collector.collectMunicipality(municipality.ineCode, generatedAt)
  )

  return {
    generatedAt,
    municipalityCatalog,
    currentPlanningRecords: parseSiotugaCorunaPlanning(statusHtml),
    municipalitySources: collected.map((municipality) => ({
      municipalityCode: municipality.municipalityCode,
      capabilitiesSourceId: municipality.capabilitiesSourceId,
      capabilitiesXml: municipality.capabilitiesXml,
      inventory: municipality.inventory,
      layerSchemas: municipality.layerSchemas,
      sourceIds: municipality.sourceIds,
    })),
    rawSources: [statusSource, ...collected.flatMap((municipality) => municipality.rawSources)],
    excludedMunicipalityCodes: [...CORUNA_PLANNING_KNOWLEDGE_EXCLUSIONS],
  }
}
