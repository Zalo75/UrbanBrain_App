-- Reproduces the known operational schema drift and the exact controlled order
-- for the secure territorial beta plus CC-01. Run only against an ephemeral
-- disposable Supabase/PostgreSQL instance: it intentionally creates fixtures.

\set ON_ERROR_STOP on

-- Builds the minimal drifted schema, applies RLS twice, verifies it, and then
-- exercises the fail-closed rollback.
\ir territorial_beta_rls_optional_v1.test.sql

-- pgTAP keeps its plan in session state. Production also applies these as
-- separate controlled steps, so reconnect before starting the CC-01 suite.
\connect postgres

-- Restore the hardened state that production must retain before CC-01.
\ir ../migrations/20260714130000_harden_territorial_beta_rls.sql

-- CC-01 is intentionally non-idempotent: it refuses to overwrite any existing
-- administrative tables. It is applied exactly once after RLS verification.
\ir ../migrations/20260715130000_control_center_foundation.sql

-- Verifies browser denial, tenant/platform separation, the trusted server
-- channel, append-only audit behavior, and absence of self-promotion.
\ir control_center_foundation.test.sql
