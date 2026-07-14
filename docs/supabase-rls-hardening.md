# Supabase RLS hardening for the territorial beta

## Scope and authorization model

The tenant boundary is:

`auth.users.id -> profiles.id -> organization_members.profile_id -> organizations.id -> expedientes.org_id`

`chat_messages`, `context_detections`, and `expediente_afecciones` inherit the tenant from their `expediente_id`. `municipal_planning` and `afeccion_types` are global catalogues and have no tenant key. Physical V1/V2 RAG tables are server-only implementation details.

The application performs authenticated server actions through `DATABASE_URL`. The audited server database role has `BYPASSRLS`. `/api/chat` invokes `match_normativa_chunks` with `SUPABASE_SERVICE_ROLE_KEY`; the browser does not need direct RPC execution.

## Direct Data API matrix

| Object | anon | authenticated | service_role/server |
| --- | --- | --- | --- |
| `chat_messages` | none | tenant `SELECT` | DML |
| `context_detections` | none | tenant `SELECT` | DML |
| `expediente_afecciones` | none | tenant `SELECT` | DML |
| `municipal_planning` | none | global `SELECT` | DML |
| `afeccion_types` | none | global `SELECT` | DML |
| authorization roots | none | none | DML |
| physical RAG tables and V1 document metadata | none | none | DML/read |
| `match_normativa_chunks` | no execute | no execute | execute |

All messages, detections, constraints, catalogue maintenance, updates, and deletes remain server-only. This avoids allowing a client to bypass `/api/chat`, forge generated evidence, or move a row by changing `expediente_id`.

## Adversarial design notes

- The membership helper is `SECURITY DEFINER` to avoid recursive RLS through `organization_members`.
- It is owned by `postgres`, has an empty `search_path`, uses fully qualified relations, and is not executable by `anon`.
- The migration aborts unless both `postgres` and `service_role` retain `BYPASSRLS`, preventing a silent server outage.
- It returns only whether `auth.uid()` can access a supplied expediente; it cannot query on behalf of another user.
- Authenticated roles receive no `INSERT`, `UPDATE`, or `DELETE`; all mutations pass through server authorization.
- `match_normativa_chunks` remains `SECURITY INVOKER`, receives a fixed safe `search_path`, and is executable only by `service_role`.
- The migration revokes grants from both `PUBLIC` and the explicit Data API roles before granting the minimum permissions.
- Authorization roots cannot be mutated through the Data API, preventing fabricated memberships or expedientes.
- V1/V2 chunks and document metadata cannot be read directly; the server role retains the V1 metadata access required by `match_normativa_chunks`, and RAG remains behind the server channel.

## Validation before any production application

Do not run the historical migration chain against the current remote database. Validate this single migration first on an isolated clone whose schema matches the audited remote:

```bash
psql "$STAGING_DATABASE_URL" -v ON_ERROR_STOP=1 \
  -f supabase/migrations/20260714130000_harden_territorial_beta_rls.sql
supabase test db --db-url "$STAGING_DATABASE_URL"
```

Then run the application typecheck, tests, build, and an authenticated smoke test covering users from two organizations and the server-side chat RPC.

Before production, capture a database backup and a catalogue-only snapshot of policies, grants, function ACLs, and the exact RPC definition. Apply only the reviewed migration file in a maintenance window:

```bash
psql "$PRODUCTION_DATABASE_URL" -v ON_ERROR_STOP=1 \
  -f supabase/migrations/20260714130000_harden_territorial_beta_rls.sql
```

The migration is transactional. Any error before `commit` rolls back automatically.

## Verification after application

- Anonymous `HEAD` requests to the four tables must fail.
- Authenticated A must see only A rows; authenticated B only B rows.
- Own-tenant, cross-tenant, and forged-author direct chat inserts must all fail.
- Direct authenticated RPC execution must fail.
- The server-side chat route must still retrieve normative chunks with `service_role`.

## Rollback

The application can be rolled back independently because the server route already uses the authorized server channel. Do not restore the previous anonymous grants.

If the policy layer itself must be disabled urgently, apply the versioned fail-closed rollback:

```bash
psql "$PRODUCTION_DATABASE_URL" -v ON_ERROR_STOP=1 \
  -f supabase/rollbacks/20260714130000_harden_territorial_beta_rls_fail_closed.sql
```

This removes the new authenticated policies and helper but leaves all sensitive tables closed to `anon` and `authenticated`; `service_role` and the server database role continue operating. Restoring the insecure grants is intentionally not provided.
