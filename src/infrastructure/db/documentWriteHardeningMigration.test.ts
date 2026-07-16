import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const migration = readFileSync(
  resolve(process.cwd(), 'supabase/migrations/20260716131500_restrict_document_writes_to_server.sql'),
  'utf8'
)
const rollback = readFileSync(
  resolve(process.cwd(), 'supabase/rollbacks/20260716131500_restrict_document_writes_to_server_fail_closed.sql'),
  'utf8'
)

describe('document write hardening migration', () => {
  it.each(['documents', 'document_chunks'])('blocks direct writes to public.%s and preserves service_role', (table) => {
    expect(migration).toMatch(new RegExp(`revoke insert, update, delete on table public\\.${table}\\s+from public, anon, authenticated`, 'i'))
    expect(migration).toMatch(new RegExp(`grant select, insert, update, delete on table public\\.${table} to service_role`, 'i'))
  })

  it('requires the real document relations and private expediente bucket', () => {
    for (const relation of ['public.documents', 'public.document_chunks', 'storage.buckets', 'storage.objects']) {
      expect(migration).toContain(`'${relation}'`)
    }
    expect(migration).toMatch(/storage\.buckets where id = 'expedientes' and public is false/i)
    expect(migration).toMatch(/storage\.objects must have RLS enabled/i)
    expect(migration).toMatch(/service_role must have BYPASSRLS/i)
  })

  it.each(['insert', 'update', 'delete'])('adds a restrictive storage %s policy scoped to other buckets', (operation) => {
    expect(migration).toMatch(new RegExp(`as restrictive\\s+for ${operation}\\s+to anon, authenticated`, 'i'))
    expect(migration).toMatch(/bucket_id <> 'expedientes'/i)
  })

  it('blocks all direct expediente bucket mutations without changing ACLs for unrelated buckets', () => {
    expect(migration.match(/bucket_id <> 'expedientes'/gi)).toHaveLength(4)
    expect(migration).not.toMatch(/revoke insert, update, delete on table storage\.objects/i)
  })

  it('is transactional, repeatable and independent of historical policy names', () => {
    expect(migration.trim()).toMatch(/^--[\s\S]*begin;[\s\S]*commit;$/i)
    expect(migration.match(/drop policy if exists urbanbrain_exp442_/gi)).toHaveLength(3)
    expect(migration).not.toMatch(/drop policy if exists "Users can/i)
  })

  it('contains no business-data mutation or destructive storage operation', () => {
    expect(migration).not.toMatch(/\b(insert into|update\s+public\.|delete from|truncate|drop table|storage\.emptyBucket|storage\.deleteBucket)\b/i)
  })

  it('provides a fail-closed rollback that keeps browser writes blocked', () => {
    for (const table of ['documents', 'document_chunks']) {
      expect(rollback).toMatch(new RegExp(`revoke insert, update, delete on table public\\.${table}\\s+from public, anon, authenticated`, 'i'))
      expect(rollback).toMatch(new RegExp(`grant select, insert, update, delete on table public\\.${table} to service_role`, 'i'))
    }
    expect(rollback).not.toMatch(/grant (insert|update|delete)[\s\S]*to (anon|authenticated)/i)
    expect(rollback.match(/create policy urbanbrain_exp442_/gi)).toHaveLength(3)
    expect(rollback.match(/drop policy if exists urbanbrain_exp442_/gi)).toHaveLength(3)
    expect(rollback.match(/bucket_id <> 'expedientes'/gi)).toHaveLength(4)
    expect(rollback).toMatch(/storage\.objects must have RLS enabled/i)
  })
})
