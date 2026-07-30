import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const migration = readFileSync(
  resolve('supabase/migrations/20260729120000_scope_normativa_chunks_matching.sql'),
  'utf8'
)
const rollback = readFileSync(
  resolve('supabase/rollbacks/20260729120000_scope_normativa_chunks_matching.sql'),
  'utf8'
)

describe('scoped normativa retrieval migration', () => {
  it('filtra el universo documental antes de ordenar por similitud vectorial', () => {
    const municipalityFilter = migration.indexOf(
      'nc.municipio_codigo = filter_municipio_codigo'
    )
    const documentFilter = migration.indexOf('nc.nombre_pdf = any(filter_document_names)')
    const ordinanceFilter = migration.indexOf('lower(btrim(filter_ordinance))')
    const vectorOrder = migration.indexOf('order by nc.embedding <=> query_embedding')

    expect(municipalityFilter).toBeGreaterThan(0)
    expect(documentFilter).toBeGreaterThan(municipalityFilter)
    expect(ordinanceFilter).toBeGreaterThan(documentFilter)
    expect(vectorOrder).toBeGreaterThan(ordinanceFilter)
  })

  it('mantiene la RPC exclusivamente en el canal servidor', () => {
    expect(migration).toContain('security invoker')
    expect(migration).toContain('from public, anon, authenticated')
    expect(migration).toContain('to service_role')
    expect(migration).not.toMatch(/using\s*\(\s*true\s*\)/i)
  })

  it('revierte únicamente la RPC nueva sin alterar datos ni la búsqueda anterior', () => {
    expect(rollback).toContain(
      'drop function if exists public.match_normativa_chunks_scoped(vector, integer, text, text[], text)'
    )
    expect(rollback).not.toMatch(/\b(?:delete|update|truncate)\b/i)
    expect(rollback).not.toContain('drop function if exists public.match_normativa_chunks(vector')
  })
})
