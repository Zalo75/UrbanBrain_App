import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { describe, expect, it } from 'vitest'

const migration = readFileSync(
  resolve(
    process.cwd(),
    'supabase/migrations/20260724190000_optimize_normativa_chunks_matching.sql'
  ),
  'utf8'
).toLowerCase()
const rollback = readFileSync(
  resolve(
    process.cwd(),
    'supabase/rollbacks/20260724190000_optimize_normativa_chunks_matching.sql'
  ),
  'utf8'
).toLowerCase()

describe('normativa_chunks municipal matching performance migration', () => {
  it('requires an applicable B-tree and filters by the exact municipal INE code', () => {
    expect(migration).toContain("access_method.amname = 'btree'")
    expect(migration).toContain(
      "pg_catalog.pg_get_indexdef(index_entry.indexrelid, 1, true) = 'municipio_codigo'"
    )
    expect(migration).toContain('filter_municipio_codigo text default null')
    expect(migration).toContain('nc.municipio_codigo = filter_municipio_codigo')
    expect(migration).toContain('filter_municipio_codigo is not null')
    expect(migration).not.toContain('municipio_nombre ilike')
  })

  it('uses cosine HNSW with iterative filtered scanning and final-row projection', () => {
    expect(migration).toContain('using hnsw (embedding vector_cosine_ops)')
    expect(migration).toContain(
      "to_regclass('public.normativa_chunks_embedding_hnsw_cosine_idx')"
    )
    expect(migration).toContain('index_entry.indisvalid')
    expect(migration).toContain('index_entry.indisready')
    expect(migration).toContain('set hnsw.iterative_scan = strict_order')
    expect(migration).toContain('set hnsw.ef_search = 100')
    expect(migration).toContain('set hnsw.max_scan_tuples = 50000')
    expect(migration).toContain('set hnsw.scan_mem_multiplier = 2')
    expect(migration).toContain('with candidates as materialized')
    expect(migration).toContain('limit greatest(match_count * 8, 64)')
    expect(migration).toContain('ranked as materialized')
    expect(migration).toContain('inner join public.normativa_chunks as nc')
    expect(migration).toContain('nc.embedding <=> query_embedding')
    expect(migration).toContain('order by nc.embedding <=> query_embedding')
  })

  it('keeps the RPC server-only with invoker semantics and a safe search path', () => {
    expect(migration).toContain('security invoker')
    expect(migration).toContain('set search_path = pg_catalog, public, extensions')
    expect(migration).toContain('from public, anon, authenticated')
    expect(migration).toContain('to service_role')
    expect(migration).not.toMatch(/grant\s+execute[\s\S]*to\s+(?:public|anon|authenticated)/)
  })

  it('is transactional, reapplicable and validates its required schema', () => {
    expect(migration.trim()).toMatch(/^--[\s\S]*begin;[\s\S]*commit;$/)
    expect(migration).toContain("to_regclass('public.normativa_chunks')")
    expect(migration).toContain("extname = 'vector'")
    expect(migration).toContain("pgvector 0.8.0 or newer is required")
    expect(migration).toContain("attribute.attname = 'municipio_codigo'")
    expect(migration).toContain("attribute.attname = 'embedding'")
    expect(migration).toContain(
      'drop function if exists public.match_normativa_chunks(vector, integer, text)'
    )
    expect(migration).toContain("notify pgrst, 'reload schema'")
  })

  it('provides a server-only rollback to the previous contract', () => {
    expect(rollback).toContain('filter_municipio text default null')
    expect(rollback).toContain("municipio_nombre ilike '%' || filter_municipio || '%'")
    expect(rollback).toContain('security invoker')
    expect(rollback).toContain('from public, anon, authenticated')
    expect(rollback).toContain('to service_role')
    expect(rollback).toContain(
      'drop index if exists public.normativa_chunks_embedding_hnsw_cosine_idx'
    )
  })
})
