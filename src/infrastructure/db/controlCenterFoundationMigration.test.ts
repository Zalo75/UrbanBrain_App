import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { describe, expect, it } from 'vitest'

const migrationPath = resolve(
  process.cwd(),
  'supabase/migrations/20260715130000_control_center_foundation.sql'
)
const sql = readFileSync(migrationPath, 'utf8').toLowerCase()

describe('Control Center foundation migration', () => {
  it('fails closed unless both trusted server roles bypass RLS', () => {
    expect(sql).toContain("rolname = 'service_role' and rolbypassrls")
    expect(sql).toContain("rolname = 'postgres' and rolbypassrls")
  })

  it.each(['platform_admins', 'admin_audit_events'])(
    'forces RLS and revokes browser privileges on %s',
    (table) => {
      expect(sql).toContain(`alter table public.${table} enable row level security`)
      expect(sql).toContain(`alter table public.${table} force row level security`)
      expect(sql).toMatch(
        new RegExp(`revoke all privileges on table public\\.${table}[\\s\\S]+?authenticated`)
      )
    }
  )

  it('creates no permissive policy for either administrative table', () => {
    expect(sql).not.toMatch(/create\s+policy/)
    expect(sql).not.toMatch(/to\s+anon/)
    expect(sql).not.toMatch(/to\s+authenticated/)
  })

  it('preserves the minimum trusted server channel', () => {
    expect(sql).toContain(
      'grant select, insert, update on table public.platform_admins to service_role'
    )
    expect(sql).toContain(
      'grant select, insert on table public.admin_audit_events to service_role'
    )
    expect(sql).not.toMatch(/grant\s+delete[\s\S]+service_role/)
  })

  it('makes revocation state explicit and audit history append-only', () => {
    expect(sql).toContain('platform_admins_revocation_state_check')
    expect(sql).toContain('(active and revoked_at is null)')
    expect(sql).toContain('(not active and revoked_at is not null)')
    expect(sql).not.toMatch(/grant\s+update[\s\S]+admin_audit_events/)
    expect(sql).not.toMatch(/grant\s+delete[\s\S]+admin_audit_events/)
  })

  it('contains no identity-based auto-promotion or hardcoded email', () => {
    expect(sql).not.toContain('auth.users')
    expect(sql).not.toMatch(/[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/)
    expect(sql).not.toMatch(/insert\s+into\s+public\.platform_admins/)
  })

  it('refuses to overwrite pre-existing Control Center tables', () => {
    expect(sql).toContain("to_regclass('public.platform_admins') is not null")
    expect(sql).toContain("to_regclass('public.admin_audit_events') is not null")
    expect(sql).toContain('refusing to overwrite an unknown definition')
  })
})
