import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const migration = readFileSync(resolve(
  process.cwd(),
  'supabase/migrations/20260724170000_enforce_expediente_owner_isolation.sql'
), 'utf8')
const rollback = readFileSync(resolve(
  process.cwd(),
  'supabase/rollbacks/20260724170000_enforce_expediente_owner_isolation_fail_closed.sql'
), 'utf8')
const pgTap = readFileSync(resolve(
  process.cwd(),
  'supabase/tests/expediente_owner_isolation.test.sql'
), 'utf8')

describe('expediente owner isolation migration', () => {
  it('adds server-owned identity and backfills only unambiguous single-member organizations', () => {
    expect(migration).toMatch(/add column if not exists owner_id uuid/i)
    expect(migration).toMatch(/having count\(distinct profile_id\) = 1/i)
    expect(migration).toMatch(/check \(owner_id is not null\) not valid/i)
    expect(migration).not.toMatch(/coalesce\([^)]*owner_id/i)
  })

  it('replaces organization membership authorization with auth.uid ownership', () => {
    const helper = migration.match(/create or replace function public\.urbanbrain_can_access_expediente[\s\S]+?\$function\$;/i)?.[0] ?? ''
    expect(helper).toContain('e.owner_id = (select auth.uid())')
    expect(helper).not.toContain('organization_members')
    expect(migration).toMatch(/urbanbrain_expedientes_owner_delete[\s\S]+owner_id = \(select auth\.uid\(\)\)/i)
    expect(migration).toMatch(/urbanbrain_expedientes_owner_isolation[\s\S]+as restrictive for all/i)
  })

  it.each([
    'chat_messages',
    'context_detections',
    'expediente_afecciones',
    'documents',
    'document_chunks',
    'conversations',
    'expediente_normative_context',
  ])('protects %s through the owner helper', (table) => {
    expect(migration).toContain(`'${table}'`)
  })

  it('scopes private Storage reads through document and expediente ownership', () => {
    expect(migration).toMatch(/d\.storage_path = name[\s\S]+e\.owner_id = \(select auth\.uid\(\)\)/i)
  })

  it('revokes residual browser grants and makes child ownership a restrictive gate', () => {
    expect(migration).toMatch(/revoke all privileges on table public\.%I from public, anon, authenticated/i)
    expect(migration).toMatch(/owner_isolation[\s\S]+as restrictive for all to authenticated/i)
    expect(migration).toMatch(/grant select, insert, update, delete on table public\.%I to service_role/i)
  })

  it('keeps rollback fail-closed and preserves the owner column', () => {
    expect(rollback).toMatch(/revoke all privileges[\s\S]+authenticated/i)
    expect(rollback).toMatch(/bucket_id <> 'expedientes'/i)
    expect(rollback).not.toMatch(/drop column[\s\S]+owner_id/i)
  })

  it('defines a real same-organization A/B pgTAP scenario for parent and child data', () => {
    expect(pgTap).toContain("'member'")
    expect(pgTap).toContain("'admin'")
    expect(pgTap).toMatch(/Owned by A[\s\S]+Owned by B/)
    expect(pgTap).toMatch(/A reads only own chat/)
    expect(pgTap).toMatch(/A reads only own documents/)
    expect(pgTap).toMatch(/A reads only own chunks/)
    expect(pgTap).toMatch(/A cannot archive B expediente/)
    expect(pgTap).toMatch(/A cannot delete B expediente/)
    expect(pgTap).toMatch(/A cannot forge B as expediente owner/)
  })
})
