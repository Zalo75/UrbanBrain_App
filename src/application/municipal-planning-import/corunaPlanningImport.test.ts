import { describe, expect, it, vi } from 'vitest'
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { aCorunaMunicipalities } from '@/shared/territory/provinces/a_coruna'
import { AUTO_EXCLUDED_INE, createSnapshot, diffSnapshots, fetchSiotugaPlanningHtml, validateCorunaImport } from './corunaPlanningImport'

const valid = aCorunaMunicipalities.filter((m) => m.ineCode && !AUTO_EXCLUDED_INE.has(m.ineCode)).map((m) => `<tr><td>${m.ineCode}</td><td>${m.name}</td><td>Plan general de ordenación municipal</td><td>2000-01-01</td><td>Adaptado</td><td><a href="/inventario.php?inv=1&idconcello=${m.ineCode}">Inventario</a></td></tr>`).join('')
describe('A Coruña SIOTUGA planning import', () => {
  it('acquires the complete official HTML contract without browser pagination', async () => {
    const fetcher = vi.fn(async () => new Response(`<table id="inventoryTableSortable"><tbody>${valid}</tbody></table>`, { status: 200 })) as unknown as typeof fetch
    await expect(fetchSiotugaPlanningHtml(fetcher)).resolves.toContain('inventoryTableSortable')
    expect(fetcher).toHaveBeenCalledOnce()
  })
  it('keeps script awaits inside its CommonJS-compatible entry point', async () => {
    const script = await readFile(resolve(process.cwd(), 'scripts/importMunicipalPlanningCoruna.ts'), 'utf8')
    expect(script).toContain('async function main()')
    expect(script).toContain('main().catch((error) =>')
    expect(script).not.toMatch(/^await\s/m)
  })
  it('accepts exactly the 89 automatic municipalities and excludes ambiguous records', () => {
    const otherProvinces = '<tr><td>27001</td><td>Abadín</td><td>Plan general</td><td>2001-01-01</td></tr><tr><td>32001</td><td>Allariz</td><td>Plan general</td><td>2001-01-01</td></tr><tr><td>36001</td><td>Arbo</td><td>Plan general</td><td>2001-01-01</td></tr>'
    const snapshot = createSnapshot(`<table>${valid}${otherProvinces}<tr><td>15902</td><td>Oza-Cesuras</td><td>Plan A</td><td>2001-01-01</td></tr><tr><td>15902</td><td>Oza-Cesuras</td><td>Plan B</td><td>2002-01-01</td></tr></table>`, '2026-07-20T00:00:00.000Z')
    expect(snapshot.records).toHaveLength(89); expect(snapshot.records.some((record) => record.municipalityId === '15031')).toBe(true); expect(snapshot.records.some((record) => record.municipalityId === '15902')).toBe(false)
  })
  it('fails closed for an unknown A Coruña INE while ignoring other provinces', () => {
    expect(() => createSnapshot(`<table>${valid}<tr><td>15999</td><td>Desconocido</td><td>Plan general</td><td>2001-01-01</td></tr><tr><td>27001</td><td>Abadín</td><td>Plan general</td><td>2001-01-01</td></tr></table>`, '2026-07-20T00:00:00.000Z')).toThrow('15999')
  })
  it('fails closed on a missing or duplicate municipality', () => {
    expect(() => createSnapshot(`<table>${valid.replace(/<tr><td>15031[\s\S]*?<\/tr>/, '')}</table>`, '2026-07-20T00:00:00.000Z')).toThrow('15031')
    const records = createSnapshot(`<table>${valid}</table>`, '2026-07-20T00:00:00.000Z').records
    expect(() => validateCorunaImport([...records, records[0]])).toThrow('exactly one')
  })
  it('reports deterministic source changes', () => {
    const first = createSnapshot(`<table>${valid}</table>`, '2026-07-20T00:00:00.000Z'); const changed = structuredClone(first); changed.records[0].name = 'Nuevo plan'; changed.records[0].externalId = 'changed'
    expect(diffSnapshots(first, changed).filter((item) => item.change === 'changed')).toHaveLength(1)
  })
})
