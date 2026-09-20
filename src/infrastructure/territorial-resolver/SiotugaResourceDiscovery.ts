import type {
  PlanningApplicability,
  PlanningInstrumentReference,
} from '@/domain/territorial-resolver/types'
import { fetchOfficial, isExternalServiceFailure, type FetchLike } from './officialHttp'

const SIOTUGA_WFS_URL = 'https://siotuga.xunta.gal/siotuga/ws'

export interface SiotugaResourceCatalog {
  municipalityCode: string
  instrument: PlanningInstrumentReference
  source: 'siotuga'
  capabilities: {
    wfs: string
    wms: string
  }
  classificationLayer?: string
  detailedPlanningLayer?: string
  planningTileIndex?: string
  boundaryLayer?: string
}

export interface SiotugaResourceDiscoveryResult {
  catalog?: SiotugaResourceCatalog
  wfsCapabilitiesXml?: string
  wmsCapabilitiesXml?: string
}

function decodeXml(value: string) {
  return value
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
}

export function extractSiotugaLayerNames(xml: string, municipalityCode: string) {
  return [
    ...xml.matchAll(/<(?:\w+:)?Name>([^<]+)<\/(?:\w+:)?Name>/gi),
  ]
    .map((match) => decodeXml(match[1] ?? '').trim())
    .filter((name) => name.startsWith(`_${municipalityCode}_`))
    .filter((name, index, names) => names.indexOf(name) === index)
}

function currentInstrument(planning: PlanningApplicability) {
  return planning.applicableInstruments?.find((instrument) => instrument.status === 'current')
}

function layerKind(name: string) {
  const match = name.match(/^_(\d{5})_(.*?)_(\d{6})_AD_(3CLAS|PORD_02CL(?:_TILEINDEX)?|1DEL)_(\d+)$/)
  if (!match) return undefined
  return { kind: match[4], instrumentId: match[5] }
}

function chooseLayer(names: string[], instrumentId: string, kind: string) {
  return names.find((name) => {
    const parsed = layerKind(name)
    return parsed?.instrumentId === instrumentId && parsed.kind === kind
  })
}

export function buildSiotugaResourceCatalog(
  municipalityCode: string,
  planning: PlanningApplicability,
  wfsLayerNames: string[],
  wmsLayerNames: string[]
): SiotugaResourceCatalog | undefined {
  const instrument = currentInstrument(planning)
  if (!instrument) return undefined

  const classificationLayer = chooseLayer(wfsLayerNames, instrument.id, '3CLAS')
  const detailedPlanningLayer = chooseLayer(wmsLayerNames, instrument.id, 'PORD_02CL')
  const planningTileIndex = chooseLayer(wmsLayerNames, instrument.id, 'PORD_02CL_TILEINDEX')
  const boundaryLayer = chooseLayer(wfsLayerNames, instrument.id, '1DEL')
  if (!classificationLayer && !detailedPlanningLayer && !planningTileIndex && !boundaryLayer) {
    return undefined
  }

  return {
    municipalityCode,
    instrument,
    source: 'siotuga',
    capabilities: {
      wfs: `${SIOTUGA_WFS_URL}?codine=${municipalityCode}&SERVICE=WFS&VERSION=1.1.0&REQUEST=GetCapabilities`,
      wms: `${SIOTUGA_WFS_URL}?codine=${municipalityCode}&SERVICE=WMS&VERSION=1.1.1&REQUEST=GetCapabilities`,
    },
    classificationLayer,
    detailedPlanningLayer,
    planningTileIndex,
    boundaryLayer,
  }
}

export async function discoverSiotugaResources(
  municipalityCode: string | undefined,
  planning: PlanningApplicability,
  fetcher: FetchLike = fetch,
  timeoutMs = 8_000
): Promise<SiotugaResourceDiscoveryResult> {
  if (!municipalityCode || !currentInstrument(planning)) return {}

  const wfsUrl = new URL(SIOTUGA_WFS_URL)
  wfsUrl.search = new URLSearchParams({
    codine: municipalityCode,
    SERVICE: 'WFS',
    VERSION: '1.1.0',
    REQUEST: 'GetCapabilities',
  }).toString()
  const wmsUrl = new URL(SIOTUGA_WFS_URL)
  wmsUrl.search = new URLSearchParams({
    codine: municipalityCode,
    SERVICE: 'WMS',
    VERSION: '1.1.1',
    REQUEST: 'GetCapabilities',
  }).toString()

  const [wfs, wms] = await Promise.allSettled([
    fetchOfficial(fetcher, 'SIOTUGA WFS capabilities', wfsUrl, timeoutMs),
    fetchOfficial(fetcher, 'SIOTUGA WMS capabilities', wmsUrl, timeoutMs),
  ])
  let wfsCapabilitiesXml: string | undefined
  let wmsCapabilitiesXml: string | undefined
  if (wfs.status === 'fulfilled') {
    try {
      wfsCapabilitiesXml = await wfs.value.text()
    } catch (err) {
      if (!isExternalServiceFailure(err)) throw err
    }
  }
  if (wms.status === 'fulfilled') {
    try {
      wmsCapabilitiesXml = await wms.value.text()
    } catch (err) {
      if (!isExternalServiceFailure(err)) throw err
    }
  }
  const catalog = buildSiotugaResourceCatalog(
    municipalityCode,
    planning,
    wfsCapabilitiesXml ? extractSiotugaLayerNames(wfsCapabilitiesXml, municipalityCode) : [],
    wmsCapabilitiesXml ? extractSiotugaLayerNames(wmsCapabilitiesXml, municipalityCode) : []
  )
  return { catalog, wfsCapabilitiesXml, wmsCapabilitiesXml }
}
