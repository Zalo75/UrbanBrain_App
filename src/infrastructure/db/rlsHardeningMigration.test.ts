import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

const migrationPath = resolve(
  process.cwd(),
  'supabase/migrations/20260714130000_harden_territorial_beta_rls.sql'
);
const sql = readFileSync(migrationPath, 'utf8').toLowerCase();

const sensitiveTables = [
  'chat_messages',
  'context_detections',
  'expediente_afecciones',
  'municipal_planning',
  'afeccion_types',
  'normativa_chunks',
  'normative_documents_v2',
  'normative_chunks_v2',
];

const authorizationRoots = [
  'organizations',
  'profiles',
  'organization_members',
  'expedientes',
];

describe('territorial beta RLS hardening migration', () => {
  it('fails closed unless the helper owner and server role bypass RLS', () => {
    expect(sql).toContain("rolname = 'postgres'");
    expect(sql).toContain("rolname = 'service_role'");
    expect(sql.match(/and rolbypassrls/g)).toHaveLength(2);
  });

  it.each(sensitiveTables)('enables and forces RLS on %s', (table) => {
    expect(sql).toContain(`alter table public.${table} enable row level security`);
    expect(sql).toContain(`alter table public.${table} force row level security`);
    expect(sql).toContain(`revoke all privileges on table public.${table}`);
  });

  it('uses a non-recursive, hardened membership helper', () => {
    expect(sql).toContain('security definer');
    expect(sql).toContain("set search_path = ''");
    expect(sql).toContain('inner join public.organization_members');
    expect(sql).toContain('om.profile_id = (select auth.uid())');
    expect(sql).toContain(
      'revoke all privileges on function public.urbanbrain_can_access_expediente(uuid) from anon'
    );
  });

  it.each(authorizationRoots)('removes direct Data API access to %s', (table) => {
    expect(sql).toContain(`alter table public.${table} force row level security`);
    expect(sql).toContain(`revoke all privileges on table public.${table}`);
    expect(sql).not.toMatch(
      new RegExp(`grant\\s+[^;]+on\\s+table\\s+public\\.${table}\\s+to\\s+authenticated`)
    );
  });

  it('allows authenticated users to read only rows linked to their expedientes', () => {
    expect(sql).toContain('urbanbrain_chat_messages_select_tenant');
    expect(sql).toContain('urbanbrain_context_detections_select_tenant');
    expect(sql).toContain('urbanbrain_expediente_afecciones_select_tenant');
    expect(sql.match(/urbanbrain_can_access_expediente\(expediente_id\)/g)).toHaveLength(3);
  });

  it('keeps every sensitive mutation server-only', () => {
    expect(sql).not.toContain('create policy urbanbrain_chat_messages_insert_self');
    expect(sql).not.toMatch(/grant\s+insert[^;]*to\s+authenticated/);
    expect(sql).not.toMatch(/grant\s+update[^;]*to\s+authenticated/);
    expect(sql).not.toMatch(/grant\s+delete[^;]*to\s+authenticated/);
    expect(sql).not.toMatch(/grant\s+insert\s+on\s+table\s+public\.context_detections/);
    expect(sql).not.toMatch(/grant\s+insert\s+on\s+table\s+public\.expediente_afecciones/);
  });

  it('treats municipal planning as an explicit authenticated read-only catalogue', () => {
    expect(sql).toContain('urbanbrain_municipal_planning_select_authenticated');
    expect(sql).toContain('grant select on table public.municipal_planning to authenticated');
    expect(sql).not.toMatch(/grant\s+[^;]+municipal_planning\s+to\s+anon/);
    expect(sql).toContain('urbanbrain_afeccion_types_select_authenticated');
    expect(sql).toContain('grant select on table public.afeccion_types to authenticated');
  });

  it('keeps physical RAG storage off the browser Data API', () => {
    for (const table of [
      'normativa_chunks',
      'normative_documents_v2',
      'normative_chunks_v2',
    ]) {
      expect(sql).toContain(`revoke all privileges on table public.${table}`);
      expect(sql).not.toMatch(
        new RegExp(`grant\\s+[^;]+on\\s+table\\s+public\\.${table}\\s+to\\s+authenticated`)
      );
    }
  });

  it('restricts the RAG RPC to service_role and preserves invoker semantics', () => {
    expect(sql).toContain("p.proname = 'match_normativa_chunks'");
    expect(sql).toContain('alter function %s security invoker');
    expect(sql).toContain('set search_path to pg_catalog, public, extensions');
    expect(sql).toContain('revoke all privileges on function %s from anon, authenticated');
    expect(sql).toContain('grant execute on function %s to service_role');
  });
});
