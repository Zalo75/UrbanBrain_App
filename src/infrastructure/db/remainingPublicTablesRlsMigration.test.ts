import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

const migration = readFileSync(
  resolve(
    process.cwd(),
    'supabase/migrations/20260723120000_harden_remaining_public_tables_rls.sql'
  ),
  'utf8'
).toLowerCase();
const rollback = readFileSync(
  resolve(
    process.cwd(),
    'supabase/rollbacks/20260723120000_harden_remaining_public_tables_rls_fail_closed.sql'
  ),
  'utf8'
).toLowerCase();
const schema = readFileSync(
  resolve(process.cwd(), 'src/infrastructure/db/schema/index.ts'),
  'utf8'
);

const newlyProtectedTables = [
  'conversations',
  'messages',
  'message_sources',
  'document_chunks',
  'planning_zones',
  'normative_families',
  'expediente_normative_context',
  'legal_updates',
];

const tablesProtectedByEarlierMigrations = [
  'organizations',
  'profiles',
  'organization_members',
  'platform_admins',
  'admin_audit_events',
  'expedientes',
  'documents',
  'normativa_documents',
  'normativa_chunks',
  'chat_messages',
  'municipal_planning',
  'afeccion_types',
  'expediente_afecciones',
  'context_detections',
  'normative_documents_v2',
  'normative_chunks_v2',
];

describe('remaining public-table RLS hardening migration', () => {
  it('closes every table omitted by the earlier versioned RLS migrations', () => {
    const schemaTables = [...schema.matchAll(/pgTable\(\s*['"]([^'"]+)['"]/g)].map(
      ([, table]) => table
    );
    const coveredTables = new Set([
      ...tablesProtectedByEarlierMigrations,
      ...newlyProtectedTables,
    ]);

    expect(schemaTables).toHaveLength(24);
    expect(schemaTables.filter((table) => !coveredTables.has(table))).toEqual([]);
  });

  it.each(newlyProtectedTables)('hardens public.%s when it exists', (table) => {
    expect(migration).toContain(`'${table}'`);
    expect(rollback).toContain(`'${table}'`);
  });

  it('is conditional, transactional and safe to reapply', () => {
    expect(migration.trim()).toMatch(/^--[\s\S]*begin;[\s\S]*commit;$/i);
    expect(migration).toContain("if to_regclass('public.' || protected_table) is not null");
    expect(migration).toContain("'alter table public.%i enable row level security'");
    expect(migration).toContain("'alter table public.%i force row level security'");
  });

  it('blocks every direct Data API role and preserves service_role DML', () => {
    for (const source of [migration, rollback]) {
      expect(source).toContain(
        "'revoke all privileges on table public.%i from public, anon, authenticated'"
      );
      expect(source).toContain(
        "'grant select, insert, update, delete on table public.%i to service_role'"
      );
      expect(source).not.toMatch(/grant\s+[^;]+\s+to\s+(?:public|anon|authenticated)/i);
    }
  });

  it('requires the authorized server role to bypass RLS', () => {
    for (const source of [migration, rollback]) {
      expect(source).toContain("rolname = 'service_role'");
      expect(source).toContain('and rolbypassrls');
    }
  });

  it('does not create permissive policies or mutate business data', () => {
    expect(migration).not.toMatch(/create\s+policy/i);
    expect(migration).not.toMatch(
      /\b(insert\s+into|update\s+public\.|delete\s+from|truncate|drop\s+table)\b/i
    );
  });

  it('provides a fail-closed rollback', () => {
    expect(rollback).toContain("'alter table public.%i enable row level security'");
    expect(rollback).toContain("'alter table public.%i no force row level security'");
    expect(rollback).not.toContain('disable row level security');
  });
});
