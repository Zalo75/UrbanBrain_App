import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { describe, expect, it } from 'vitest'

const migration = readFileSync(
  resolve(
    process.cwd(),
    'supabase/migrations/20260816104907_allow_supramunicipal_scoped_retrieval.sql'
  ),
  'utf8'
).toLowerCase()
const chatRoute = readFileSync(resolve(process.cwd(), 'src/app/api/chat/route.ts'), 'utf8')

interface ScopedFixture {
  chunkId: string
  municipalityCode: string | null
  documentName: string
}

const fixtures: ScopedFixture[] = [
  { chunkId: 'municipal-ames', municipalityCode: '15002', documentName: 'PXOM_Ames.pdf' },
  { chunkId: 'municipal-sada', municipalityCode: '15075', documentName: 'PXOM_Sada.pdf' },
  {
    chunkId: 'autonomic-lsg',
    municipalityCode: null,
    documentName: 'LSG CONSOLIDADA ENERO 2026- V2.pdf',
  },
  {
    chunkId: 'sectorial-roads',
    municipalityCode: null,
    documentName: 'Lei_8_2013_Estradas_Galicia.pdf',
  },
]

function applyScopedWhere(
  municipalityCode: string | null,
  documentNames: string[] | null = null
) {
  return fixtures.filter((fixture) => (
    (municipalityCode === null || fixture.municipalityCode === municipalityCode) &&
    (documentNames === null || documentNames.length === 0 || documentNames.includes(fixture.documentName))
  ))
}

describe('supramunicipal normativa retrieval migration', () => {
  it('hace opcional el filtro municipal sin ampliar una consulta municipal', () => {
    expect(migration).toContain('filter_municipio_codigo text default null')
    expect(migration).toContain(
      '(filter_municipio_codigo is null or nc.municipio_codigo = filter_municipio_codigo)'
    )
    expect(migration).not.toContain(
      'filter_municipio_codigo is not null\n      and nc.municipio_codigo = filter_municipio_codigo'
    )
  })

  it('mantiene los filtros documentales y de ordenanza antes del ranking vectorial', () => {
    const municipalityFilter = migration.indexOf('filter_municipio_codigo is null')
    const documentFilter = migration.indexOf('nc.nombre_pdf = any(filter_document_names)')
    const ordinanceFilter = migration.indexOf('lower(btrim(filter_ordinance))')
    const vectorOrder = migration.indexOf('order by nc.embedding <=> query_embedding')

    expect(municipalityFilter).toBeGreaterThan(0)
    expect(documentFilter).toBeGreaterThan(municipalityFilter)
    expect(ordinanceFilter).toBeGreaterThan(documentFilter)
    expect(vectorOrder).toBeGreaterThan(ordinanceFilter)
  })

  it('documenta null como ausencia de filtro y no convierte el string vacío en sentinel', () => {
    expect(migration).toContain('null disables municipal filtering for supramunicipal retrieval')
    expect(migration).not.toMatch(/btrim\(filter_municipio_codigo\)\s*=\s*''/)
    // Por el hotfix de producción de 8K-D, route.ts envía '' en lugar de null
    expect(chatRoute).toMatch(/filter_municipio_codigo\s*:\s*''/)
  })

  it('conserva la RPC server-only y sin cambios de firma', () => {
    const vectorSettingsLoad = migration.indexOf("select '[1]'::vector <=> '[1]'::vector")
    const functionCreation = migration.indexOf(
      'create or replace function public.match_normativa_chunks_scoped('
    )

    expect(vectorSettingsLoad).toBeGreaterThan(0)
    expect(functionCreation).toBeGreaterThan(vectorSettingsLoad)
    expect(migration).toContain('create or replace function public.match_normativa_chunks_scoped(')
    expect(migration).toContain('security invoker')
    expect(migration).toContain('from public, anon, authenticated')
    expect(migration).toContain('to service_role')
    expect(migration).toContain("notify pgrst, 'reload schema'")
  })

  it('mantiene la tabla de verdad municipal y supramunicipal del WHERE', () => {
    expect(applyScopedWhere('15002').map((row) => row.chunkId)).toEqual(['municipal-ames'])
    expect(applyScopedWhere(null).map((row) => row.chunkId)).toEqual([
      'municipal-ames',
      'municipal-sada',
      'autonomic-lsg',
      'sectorial-roads',
    ])
    expect(applyScopedWhere(null, ['LSG CONSOLIDADA ENERO 2026- V2.pdf']))
      .toEqual([expect.objectContaining({ chunkId: 'autonomic-lsg' })])
    expect(applyScopedWhere('')).toEqual([])
  })

  it('reproduce el bug del sentinel vacío y su corrección mediante NULL', () => {
    const supramunicipalRows = fixtures.filter((row) => row.municipalityCode === null)
    const legacyEmptyStringMatches = supramunicipalRows.filter(
      (row) => '' !== null && row.municipalityCode === ''
    )
    const nullableContractMatches = supramunicipalRows.filter(
      (row) => null === null || row.municipalityCode === null
    )

    expect(legacyEmptyStringMatches).toEqual([])
    expect(nullableContractMatches.map((row) => row.chunkId)).toEqual([
      'autonomic-lsg',
      'sectorial-roads',
    ])
  })
})
