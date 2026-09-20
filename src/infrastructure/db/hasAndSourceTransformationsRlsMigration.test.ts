import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

const migration = readFileSync(
  resolve(
    process.cwd(),
    'supabase/migrations/20260920120000_harden_has_source_transformations_owner_rls.sql'
  ),
  'utf8'
).toLowerCase();

const protectedTables = ['has_alignments', 'source_transformations'];

describe('HAS and source-transformation owner RLS migration', () => {
  it('is transactional and requires the canonical owner helper and relations', () => {
    expect(migration.trim()).toMatch(/^--[\s\S]*begin;[\s\S]*commit;$/i);
    expect(migration).toContain(
      "to_regprocedure('public.urbanbrain_can_access_expediente(uuid)')"
    );
    expect(migration).toContain("'public.has_alignments'");
    expect(migration).toContain("'public.source_transformations'");
  });

  it.each(protectedTables)('enables and forces RLS on public.%s', (table) => {
    expect(migration).toContain(
      `alter table public.${table} enable row level security;`
    );
    expect(migration).toContain(
      `alter table public.${table} force row level security;`
    );
  });

  it.each(protectedTables)(
    'removes browser DML and preserves the intended service privileges on public.%s',
    (table) => {
      expect(migration).toContain(
        `revoke all privileges on table public.${table} from public, anon, authenticated;`
      );
      expect(migration).toContain(
        `grant select on table public.${table} to authenticated;`
      );
      expect(migration).toContain(
        `grant select, insert, update, delete on table public.${table} to service_role;`
      );
    }
  );

  it.each(protectedTables)(
    'gates authenticated reads and every operation on public.%s through expediente ownership',
    (table) => {
      expect(migration).toContain(
        `create policy urbanbrain_${table}_owner_select\n  on public.${table}\n  for select to authenticated\n  using (public.urbanbrain_can_access_expediente(expediente_id));`
      );
      expect(migration).toContain(
        `create policy urbanbrain_${table}_owner_isolation\n  on public.${table}\n  as restrictive for all to authenticated\n  using (public.urbanbrain_can_access_expediente(expediente_id))\n  with check (public.urbanbrain_can_access_expediente(expediente_id));`
      );
    }
  );

  it('removes the organization-wide source-transformations policy', () => {
    expect(migration).toContain(
      'drop policy if exists source_transformations_authenticated_access on public.source_transformations;'
    );
    expect(migration).not.toContain('organization_members');
    expect(migration).not.toMatch(/\borg_id\b/);
  });

  it('fails closed unless service_role has the canonical RLS bypass', () => {
    expect(migration).toContain("rolname = 'service_role'");
    expect(migration).toContain('and rolbypassrls');
  });

  it('does not mutate business rows or alter unrelated tables', () => {
    expect(migration).not.toMatch(
      /\b(insert\s+into|update\s+public\.|delete\s+from|truncate|drop\s+table)\b/i
    );

    const alteredTables = [...migration.matchAll(/alter table public\.([a-z_]+)/g)].map(
      ([, table]) => table
    );
    expect(new Set(alteredTables)).toEqual(
      new Set(['has_alignments', 'source_transformations'])
    );
  });
});
