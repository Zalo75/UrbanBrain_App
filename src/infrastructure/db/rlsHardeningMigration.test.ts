import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

const migrationPath = resolve(
  process.cwd(),
  'supabase/migrations/20260714130000_harden_territorial_beta_rls.sql'
);
const rollbackPath = resolve(
  process.cwd(),
  'supabase/rollbacks/20260714130000_harden_territorial_beta_rls_fail_closed.sql'
);
const sql = readFileSync(migrationPath, 'utf8').toLowerCase();
const rollbackSql = readFileSync(rollbackPath, 'utf8').toLowerCase();

const protectedTables = [
  'chat_messages',
  'context_detections',
  'expediente_afecciones',
  'municipal_planning',
  'afeccion_types',
  'organizations',
  'profiles',
  'organization_members',
  'expedientes',
  'normativa_documents',
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

const optionalRagTables = [
  'normativa_documents',
  'normativa_chunks',
  'normative_documents_v2',
  'normative_chunks_v2',
];

describe('territorial beta RLS hardening migration', () => {
  it('fails closed unless the helper owner and server role bypass RLS', () => {
    expect(sql).toContain("rolname = 'postgres'");
    expect(sql).toContain("rolname = 'service_role'");
    expect(sql.match(/and rolbypassrls/g)).toHaveLength(2);
  });

  it.each(authorizationRoots)('requires the authorization root %s', (table) => {
    expect(sql).toContain(`'${table}'`);
    expect(sql).toContain("if to_regclass('public.' || required_table) is null");
  });

  it.each(protectedTables)('lists %s for conditional hardening', (table) => {
    expect(sql).toContain(`'${table}'`);
    expect(rollbackSql).toContain(`'${table}'`);
  });

  it('hardens and grants only relations that actually exist', () => {
    for (const source of [sql, rollbackSql]) {
      expect(source).toContain(
        "if to_regclass('public.' || protected_table) is not null"
      );
      expect(source).toContain(
        "'alter table public.%i enable row level security'"
      );
      expect(source).toContain(
        "'alter table public.%i force row level security'"
      );
      expect(source).toContain(
        "'revoke all privileges on table public.%i from public, anon, authenticated'"
      );
      expect(source).toContain(
        "'grant select, insert, update, delete on table public.%i to service_role'"
      );
    }
  });

  it.each(optionalRagTables)('never references optional table %s with static DDL', (table) => {
    for (const source of [sql, rollbackSql]) {
      expect(source).not.toMatch(
        new RegExp(`(?:alter|revoke|grant)[^;]*public\\.${table}`)
      );
    }
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

  it('creates tenant and catalogue policies only when their tables exist', () => {
    for (const table of [
      'chat_messages',
      'context_detections',
      'expediente_afecciones',
      'municipal_planning',
      'afeccion_types',
    ]) {
      expect(sql).toContain(`if to_regclass('public.${table}') is not null`);
    }
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
  });

  it('treats explicit catalogues as authenticated read-only when present', () => {
    expect(sql).toContain('urbanbrain_municipal_planning_select_authenticated');
    expect(sql).toContain('grant select on table public.municipal_planning to authenticated');
    expect(sql).toContain('urbanbrain_afeccion_types_select_authenticated');
    expect(sql).toContain('grant select on table public.afeccion_types to authenticated');
    expect(sql).not.toMatch(/grant\s+[^;]+municipal_planning\s+to\s+anon/);
  });

  it('restricts the RAG RPC to service_role and preserves invoker semantics', () => {
    for (const source of [sql, rollbackSql]) {
      expect(source).toContain("p.proname = 'match_normativa_chunks'");
      expect(source).toContain('alter function %s security invoker');
      expect(source).toContain('set search_path to pg_catalog, public, extensions');
      expect(source).toMatch(
        /revoke all privileges on function %s from [^']*public/
      );
      expect(source).toMatch(
        /revoke all privileges on function %s from [^']*anon, authenticated/
      );
      expect(source).toContain('grant execute on function %s to service_role');
    }
  });

  it('keeps the rollback fail-closed and conditional for drifted schemas', () => {
    expect(rollbackSql).toContain('drop function if exists public.urbanbrain_can_access_expediente');
    expect(rollbackSql).toContain(
      "if to_regclass('public.' || policy_target.table_name) is not null"
    );
    expect(rollbackSql).not.toMatch(/grant\s+[^;]+to\s+(?:public|anon|authenticated)/);
  });
});
