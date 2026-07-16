import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const migration = readFileSync(resolve(process.cwd(), 'supabase/migrations/20260716131500_restrict_document_writes_to_server.sql'), 'utf8')

describe('document write hardening migration', () => {
  it('revokes direct writes from public browser roles and preserves service_role', () => {
    expect(migration).toMatch(/revoke insert, update, delete on table public\.documents from public, anon, authenticated/i)
    expect(migration).toMatch(/revoke insert, update, delete on table storage\.objects from public, anon, authenticated/i)
    expect(migration).toMatch(/grant select, insert, update, delete on table public\.documents to service_role/i)
    expect(migration).toMatch(/grant select, insert, update, delete on table storage\.objects to service_role/i)
  })

  it('handles optional deployed objects explicitly and runs transactionally', () => {
    expect(migration).toMatch(/to_regclass\('public\.documents'\) is not null/i)
    expect(migration).toMatch(/to_regclass\('storage\.objects'\) is not null/i)
    expect(migration.trim()).toMatch(/^--[\s\S]*begin;[\s\S]*commit;$/i)
  })
})
