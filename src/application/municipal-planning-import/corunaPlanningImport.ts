import { createHash } from 'node:crypto'

import { aCorunaMunicipalities } from '@/shared/territory/provinces/a_coruna'

export const SIOTUGA_CORUNA_URL = 'https://siotuga.xunta.gal/siotuga/urb?lang=es_ES'
export const AUTO_EXCLUDED_INE = new Map([
  ['15009', 'Betanzos tiene integración específica'],
  ['15034', 'Dumbría excluida'],
  ['15050', 'Monfero excluido'],
  ['15902', 'Oza-Cesuras requiere revisión manual por ambigüedad histórica'],
  ['15026', 'Municipio histórico de Oza-Cesuras'],
  ['15063', 'Municipio histórico de Oza-Cesuras'],
])

export type OfficialPlanningRecord = { municipalityId: string; municipalityName: string; name: string; approvalDate: string; sourceUrl: string; adaptation?: string; externalId: string }
export type ImportSnapshot = { version: 1; sourceUrl: string; retrievedAt: string; sourceSha256: string; records: OfficialPlanningRecord[]; excluded: Array<{ municipalityId: string; reason: string }> }

const decode = (value: string) => value.replace(/<[^>]+>/g, ' ').replace(/&nbsp;|&#160;/gi, ' ').replace(/&amp;/gi, '&').replace(/&aacute;/gi, 'á').replace(/&eacute;/gi, 'é').replace(/&iacute;/gi, 'í').replace(/&oacute;/gi, 'ó').replace(/&uacute;/gi, 'ú').replace(/&ntilde;/gi, 'ñ').replace(/&uuml;/gi, 'ü').replace(/\s+/g, ' ').trim()
const cells = (row: string) => [...row.matchAll(/<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/gi)].map((match) => decode(match[1]))
const href = (row: string, index: number) => {
  const cell = [...row.matchAll(/<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/gi)][index]?.[1] ?? ''
  const value = /href=["']([^"']+)["']/i.exec(cell)?.[1]
  return value ? new URL(value, SIOTUGA_CORUNA_URL).toString() : undefined
}
const fingerprint = (record: Omit<OfficialPlanningRecord, 'externalId'>) => createHash('sha256').update(`${record.municipalityId}|${record.name}|${record.approvalDate}|${record.sourceUrl}`).digest('hex')

export function parseSiotugaCorunaPlanning(html: string): OfficialPlanningRecord[] {
  const records: OfficialPlanningRecord[] = []
  for (const match of html.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/gi)) {
    const row = match[1]; const values = cells(row)
    if (!/^\d{5}$/.test(values[0] ?? '') || !values[2] || !/^\d{4}-\d{2}-\d{2}$/.test(values[3] ?? '')) continue
    const municipalityId = values[0] ?? ''; const sourceUrl = href(row, 5) ?? `https://siotuga.xunta.gal/siotuga/inventario.php?inv=1&idconcello=${municipalityId}`
    const record = { municipalityId, municipalityName: values[1] ?? '', name: values[2] ?? '', approvalDate: values[3] ?? '', sourceUrl, adaptation: values[4] }
    records.push({ ...record, externalId: `siotuga-general-${municipalityId}-${fingerprint(record)}` })
  }
  return records
}

export function validateCorunaImport(records: OfficialPlanningRecord[]) {
  const expected = new Set(aCorunaMunicipalities.flatMap((municipality) => municipality.ineCode && !AUTO_EXCLUDED_INE.has(municipality.ineCode) ? [municipality.ineCode] : []))
  const selected = records.filter((record) => !AUTO_EXCLUDED_INE.has(record.municipalityId))
  const errors: string[] = []
  for (const ine of expected) if (selected.filter((record) => record.municipalityId === ine).length !== 1) errors.push(`INE ${ine} must have exactly one current general instrument`)
  for (const record of selected) {
    if (!expected.has(record.municipalityId)) errors.push(`Unexpected INE ${record.municipalityId}`)
    if (!record.name || /sin planeamiento/i.test(record.name) || !record.sourceUrl.startsWith('https://siotuga.xunta.gal/')) errors.push(`Invalid official record ${record.municipalityId}`)
  }
  if (errors.length) throw new Error(`SIOTUGA import blocked: ${errors.join('; ')}`)
  return selected.sort((a, b) => a.municipalityId.localeCompare(b.municipalityId))
}

export function createSnapshot(html: string, retrievedAt: string): ImportSnapshot {
  const records = validateCorunaImport(parseSiotugaCorunaPlanning(html))
  return { version: 1, sourceUrl: SIOTUGA_CORUNA_URL, retrievedAt, sourceSha256: createHash('sha256').update(html).digest('hex'), records, excluded: [...AUTO_EXCLUDED_INE].map(([municipalityId, reason]) => ({ municipalityId, reason })) }
}

export function diffSnapshots(previous: ImportSnapshot | undefined, next: ImportSnapshot) {
  const old = new Map(previous?.records.map((record) => [record.municipalityId, record]) ?? [])
  return next.records.map((record) => ({ municipalityId: record.municipalityId, change: !old.has(record.municipalityId) ? 'new' : old.get(record.municipalityId)?.externalId === record.externalId ? 'unchanged' : 'changed' }))
}
