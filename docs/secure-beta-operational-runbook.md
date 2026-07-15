# Runbook operativo: beta territorial segura + CC-01

Este procedimiento se ejecuta sólo durante una ventana autorizada. No ejecuta la cadena histórica
de migraciones. El orden obligatorio es: **RLS corregido, verificaciones, CC-01, bootstrap manual,
despliegue de aplicación**. Cada bloque usa `set -euo pipefail`: cualquier error es un punto STOP.

## Artefactos aprobados

| Artefacto | SHA-256 del contenido Git |
| --- | --- |
| `20260714130000_harden_territorial_beta_rls.sql` | `88d78cd7c183a6065b7cb11b39d2b98dd6829baf95f4cefbb66f158318d54881` |
| `20260715130000_control_center_foundation.sql` | `7ff1d30099dff0ef66126d3ac6d46b8405439269e858ed19c478a49ec06b1d16` |
| `20260714130000_harden_territorial_beta_rls_fail_closed.sql` | `066c8dc01e273316225f180b9e1e96426405a7c294f2c198b2ce20fce674af74` |

`TARGET_COMMIT` debe sustituirse por el hash completo publicado en el informe final de la rama
`agent/urbanbrain-secure-beta-final`. No use un hash corto ni un commit anterior.

## A. Preflight del VPS y preservación

Ejecutar en el VPS. Este bloque no cambia la base de datos ni reinicia la aplicación.

```bash
set -euo pipefail
cd /opt/urbanbrain

export PREVIOUS_COMMIT=3703cb062a2630873a94dba7109aac2c3f370808
export TARGET_COMMIT='<FULL_COMMIT_FROM_FINAL_REPORT>'
export RELEASE_BRANCH=agent/urbanbrain-secure-beta-final
export RUN_ID="$(date -u +%Y%m%dT%H%M%SZ)"
export BACKUP_ROOT="/opt/urbanbrain-backups/$RUN_ID"
read -r -p 'Expected operational Supabase project ref: ' EXPECTED_SUPABASE_REF

test "$(pwd)" = /opt/urbanbrain
test "$(git rev-parse HEAD)" = "$PREVIOUS_COMMIT"
test "$(git remote get-url origin)" = https://github.com/Zalo75/UrbanBrain_App.git
test "$(git branch --show-current)" = main

ACTUAL_REF="$(sed -n 's#.*https://\([a-z0-9]*\)\.supabase\.co.*#\1#p' .env | sort -u)"
test "$ACTUAL_REF" = "$EXPECTED_SUPABASE_REF"
unset ACTUAL_REF

test "$(git status --porcelain=v1 | sort)" = "$(printf '%s\n' \
  ' M package-lock.json' \
  ' M public/sw.js' | sort)"

pm2 describe urbanbrain
pm2 jlist | node -e '
let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{
 const p=JSON.parse(s).find(x=>x.name==="urbanbrain");
 process.exit(p?.pm2_env?.status==="online"?0:1)
})'

install -d -m 700 "$BACKUP_ROOT"
cp -a package-lock.json "$BACKUP_ROOT/package-lock.json.before"
cp -a public/sw.js "$BACKUP_ROOT/sw.js.before"
git diff --binary -- package-lock.json > "$BACKUP_ROOT/package-lock.before.patch"
git diff --binary -- public/sw.js > "$BACKUP_ROOT/sw.before.patch"
sha256sum package-lock.json public/sw.js > "$BACKUP_ROOT/vps-files-before.sha256"

if test -d .next; then
  tar -czf "$BACKUP_ROOT/next-before.tar.gz" .next
  sha256sum "$BACKUP_ROOT/next-before.tar.gz" > "$BACKUP_ROOT/next-before.sha256"
fi

git fetch origin \
  "refs/heads/$RELEASE_BRANCH:refs/remotes/origin/$RELEASE_BRANCH"
test "$(git rev-parse "origin/$RELEASE_BRANCH")" = "$TARGET_COMMIT"
test "$(git merge-base origin/main "$TARGET_COMMIT")" = "$PREVIOUS_COMMIT"
```

**STOP A:** detenerse si falla cualquier `test`, si aparecen más archivos modificados o si PM2 no
muestra exactamente el proceso `urbanbrain` online.

## B. Extraer y verificar los SQL exactos

```bash
set -euo pipefail
cd /opt/urbanbrain
: "${TARGET_COMMIT:?}" "${BACKUP_ROOT:?}"

git show "$TARGET_COMMIT:supabase/migrations/20260714130000_harden_territorial_beta_rls.sql" \
  > "$BACKUP_ROOT/rls-migration.sql"
git show "$TARGET_COMMIT:supabase/migrations/20260715130000_control_center_foundation.sql" \
  > "$BACKUP_ROOT/cc01-migration.sql"
git show "$TARGET_COMMIT:supabase/rollbacks/20260714130000_harden_territorial_beta_rls_fail_closed.sql" \
  > "$BACKUP_ROOT/rls-rollback.sql"

printf '%s  %s\n' \
  88d78cd7c183a6065b7cb11b39d2b98dd6829baf95f4cefbb66f158318d54881 \
  "$BACKUP_ROOT/rls-migration.sql" \
  7ff1d30099dff0ef66126d3ac6d46b8405439269e858ed19c478a49ec06b1d16 \
  "$BACKUP_ROOT/cc01-migration.sql" \
  066c8dc01e273316225f180b9e1e96426405a7c294f2c198b2ce20fce674af74 \
  "$BACKUP_ROOT/rls-rollback.sql" \
  | sha256sum -c -
```

**STOP B:** no continuar si cualquiera de los tres hashes difiere.

## C. Conexión y snapshot previo de Supabase

No pegar la contraseña en argumentos ni guardarla en el historial.

```bash
set -euo pipefail
read -r -p 'DB host: ' PGHOST
read -r -p 'DB port [5432]: ' PGPORT
PGPORT="${PGPORT:-5432}"
read -r -p 'DB user: ' PGUSER
read -rsp 'DB password: ' PGPASSWORD
echo
export PGHOST PGPORT PGUSER PGPASSWORD PGDATABASE=postgres
trap 'unset PGPASSWORD' EXIT

psql -X -v ON_ERROR_STOP=1 -Atc \
  "select current_database(), current_user, inet_server_addr() is not null;"

pg_dump --schema-only --schema=public --no-owner \
  --file="$BACKUP_ROOT/public-schema-before.sql"

psql -X -v ON_ERROR_STOP=1 -A -F $'\t' -P pager=off \
  > "$BACKUP_ROOT/security-catalog-before.tsv" <<'SQL'
select c.relname, c.relrowsecurity, c.relforcerowsecurity, c.relowner::regrole, c.relacl
from pg_catalog.pg_class c
where c.relnamespace = 'public'::regnamespace
  and c.relname in (
    'organizations','profiles','organization_members','expedientes',
    'chat_messages','context_detections','expediente_afecciones',
    'municipal_planning','afeccion_types','normativa_documents','normativa_chunks',
    'normative_documents_v2','normative_chunks_v2','platform_admins','admin_audit_events'
  )
order by c.relname;

select schemaname, tablename, policyname, permissive, roles, cmd, qual, with_check
from pg_catalog.pg_policies
where schemaname = 'public'
order by tablename, policyname;

select p.oid::regprocedure, p.prosecdef, p.proconfig, p.proacl, p.proowner::regrole,
       pg_catalog.pg_get_functiondef(p.oid)
from pg_catalog.pg_proc p
join pg_catalog.pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public'
  and p.proname in ('match_normativa_chunks','urbanbrain_can_access_expediente')
order by p.oid::regprocedure::text;

select rolname, rolbypassrls
from pg_catalog.pg_roles
where rolname in ('postgres','service_role','anon','authenticated')
order by rolname;
SQL

test -s "$BACKUP_ROOT/public-schema-before.sql"
test -s "$BACKUP_ROOT/security-catalog-before.tsv"
sha256sum "$BACKUP_ROOT/public-schema-before.sql" \
  "$BACKUP_ROOT/security-catalog-before.tsv" \
  > "$BACKUP_ROOT/database-before.sha256"
sha256sum -c "$BACKUP_ROOT/database-before.sha256"
```

**STOP C:** comprobar que `normativa_documents` está ausente, `normativa_chunks` y ambas V2 están
presentes, y que `postgres` y `service_role` tienen `BYPASSRLS`. No continuar ante cualquier otra
discrepancia estructural.

## D. Aplicar únicamente el RLS corregido

Este es el primer bloque que escribe en Supabase y requiere autorización explícita inmediatamente
antes de ejecutarlo.

```bash
set -euo pipefail
psql -X -v ON_ERROR_STOP=1 -f "$BACKUP_ROOT/rls-migration.sql"

psql -X -v ON_ERROR_STOP=1 <<'SQL'
do $verify$
declare
  table_name text;
  relation_oid regclass;
begin
  foreach table_name in array array[
    'chat_messages','context_detections','expediente_afecciones','municipal_planning',
    'afeccion_types','organizations','profiles','organization_members','expedientes',
    'normativa_documents','normativa_chunks','normative_documents_v2','normative_chunks_v2'
  ] loop
    relation_oid := to_regclass('public.' || table_name);
    if relation_oid is not null then
      if not (select relrowsecurity and relforcerowsecurity
              from pg_catalog.pg_class where oid = relation_oid) then
        raise exception '% is not protected by forced RLS', table_name;
      end if;
      if has_table_privilege('anon', relation_oid, 'SELECT,INSERT,UPDATE,DELETE') then
        raise exception 'anon retains privileges on %', table_name;
      end if;
      if table_name like 'normativa%' or table_name like 'normative%' then
        if has_table_privilege('authenticated', relation_oid, 'SELECT,INSERT,UPDATE,DELETE') then
          raise exception 'authenticated retains direct RAG privileges on %', table_name;
        end if;
      end if;
      if not has_table_privilege('service_role', relation_oid, 'SELECT,INSERT,UPDATE,DELETE') then
        raise exception 'service_role lost DML on %', table_name;
      end if;
    end if;
  end loop;

  if has_function_privilege(
       'anon', 'public.match_normativa_chunks(vector,integer,text)', 'EXECUTE'
     ) or has_function_privilege(
       'authenticated', 'public.match_normativa_chunks(vector,integer,text)', 'EXECUTE'
     ) or not has_function_privilege(
       'service_role', 'public.match_normativa_chunks(vector,integer,text)', 'EXECUTE'
     ) then
    raise exception 'Unexpected match_normativa_chunks privilege matrix';
  end if;
end;
$verify$;

begin;
set local role service_role;
select count(*) from public.match_normativa_chunks(null, 0, '__security_probe__');
rollback;
SQL
```

Verificar aislamiento con dos perfiles reales ya existentes de organizaciones distintas. Sólo se
usan identificadores; no se leen contenidos:

```bash
read -r -p 'Profile UUID user A: ' USER_A_PROFILE_ID
read -r -p 'Expediente UUID owned by A: ' EXPEDIENTE_A_ID
read -r -p 'Profile UUID user B: ' USER_B_PROFILE_ID
read -r -p 'Expediente UUID owned by B: ' EXPEDIENTE_B_ID

check_isolation() {
  local uid="$1" own="$2" foreign="$3" result
  result="$(psql -X -Atq -v ON_ERROR_STOP=1 \
    -v uid="$uid" -v own="$own" -v foreign="$foreign" <<'SQL'
begin;
set local role authenticated;
with claims as materialized (
  select
    set_config('request.jwt.claim.sub', :'uid', true),
    set_config(
      'request.jwt.claims',
      json_build_object('sub', :'uid', 'role', 'authenticated')::text,
      true
    )
)
select public.urbanbrain_can_access_expediente(:'own'::uuid)
   and not public.urbanbrain_can_access_expediente(:'foreign'::uuid)
   and not exists (
     select 1 from public.chat_messages where expediente_id = :'foreign'::uuid
   )
from claims;
rollback;
SQL
)"
  test "$result" = t
}

check_isolation "$USER_A_PROFILE_ID" "$EXPEDIENTE_A_ID" "$EXPEDIENTE_B_ID"
check_isolation "$USER_B_PROFILE_ID" "$EXPEDIENTE_B_ID" "$EXPEDIENTE_A_ID"
unset USER_A_PROFILE_ID EXPEDIENTE_A_ID USER_B_PROFILE_ID EXPEDIENTE_B_ID
```

**STOP D:** ejecutar el rollback fail-closed de la sección K si `anon` conserva acceso, la RPC
falla por `service_role`, la matriz de grants difiere o el aislamiento A/B no devuelve `t`.

## E. Aplicar CC-01

CC-01 se aplica exactamente una vez. No es idempotente deliberadamente: rechaza sobrescribir
tablas administrativas preexistentes.

```bash
set -euo pipefail
test "$(psql -X -Atq -v ON_ERROR_STOP=1 -c \
  "select to_regclass('public.platform_admins') is null
      and to_regclass('public.admin_audit_events') is null
      and to_regtype('public.platform_admin_role') is null
      and to_regtype('public.admin_audit_result') is null")" = t

psql -X -v ON_ERROR_STOP=1 -f "$BACKUP_ROOT/cc01-migration.sql"

psql -X -v ON_ERROR_STOP=1 <<'SQL'
do $verify$
begin
  if not (select relrowsecurity and relforcerowsecurity
          from pg_catalog.pg_class where oid = 'public.platform_admins'::regclass)
     or not (select relrowsecurity and relforcerowsecurity
             from pg_catalog.pg_class where oid = 'public.admin_audit_events'::regclass) then
    raise exception 'CC-01 tables do not have forced RLS';
  end if;
  if has_table_privilege('anon', 'public.platform_admins', 'SELECT,INSERT,UPDATE,DELETE')
     or has_table_privilege('authenticated', 'public.platform_admins', 'SELECT,INSERT,UPDATE,DELETE')
     or has_table_privilege('anon', 'public.admin_audit_events', 'SELECT,INSERT,UPDATE,DELETE')
     or has_table_privilege('authenticated', 'public.admin_audit_events', 'SELECT,INSERT,UPDATE,DELETE') then
    raise exception 'A browser role can access CC-01 tables';
  end if;
  if exists (
    select 1 from pg_catalog.pg_policy
    where polrelid in ('public.platform_admins'::regclass, 'public.admin_audit_events'::regclass)
  ) then
    raise exception 'Unexpected CC-01 policy';
  end if;
  if not has_table_privilege('service_role', 'public.platform_admins', 'SELECT,INSERT,UPDATE')
     or has_table_privilege('service_role', 'public.platform_admins', 'DELETE')
     or not has_table_privilege('service_role', 'public.admin_audit_events', 'SELECT,INSERT')
     or has_table_privilege('service_role', 'public.admin_audit_events', 'UPDATE,DELETE') then
    raise exception 'Unexpected CC-01 service_role privileges';
  end if;
end;
$verify$;
SQL
```

**STOP E:** no desplegar la ruta si falla cualquier comprobación. No eliminar las tablas para
“reintentar”; revisar primero el snapshot y la transacción.

## F. Aprovisionar manualmente el primer superadmin

Usar un perfil existente elegido conscientemente. El identificador y la referencia operativa se
introducen en tiempo de ejecución y no se guardan en Git.

```bash
read -r -p 'Existing profile UUID for first superadmin: ' SUPERADMIN_PROFILE_ID
read -r -p 'Change ticket/operator reference: ' CHANGE_REFERENCE

psql -X -v ON_ERROR_STOP=1 \
  -v target_profile_id="$SUPERADMIN_PROFILE_ID" \
  -v operator_reference="$CHANGE_REFERENCE" <<'SQL'
begin;
select set_config(
  'urbanbrain.bootstrap_profile_id',
  :'target_profile_id',
  false
) \g /dev/null
select set_config(
  'urbanbrain.bootstrap_operator_reference',
  :'operator_reference',
  false
) \g /dev/null
do $bootstrap$
declare
  target_profile_id uuid := current_setting('urbanbrain.bootstrap_profile_id')::uuid;
  operator_reference text := current_setting('urbanbrain.bootstrap_operator_reference');
begin
  if not exists (select 1 from public.profiles where id = target_profile_id) then
    raise exception 'The selected existing profile does not exist';
  end if;
  if exists (select 1 from public.platform_admins) then
    raise exception 'Bootstrap refused: a platform administrator already exists';
  end if;

  insert into public.platform_admins (profile_id, role, active, created_by)
  values (target_profile_id, 'superadmin', true, null);

  insert into public.admin_audit_events (
    actor_profile_id, actor_role, action, permission, resource_type,
    resource_id, result, reason
  ) values (
    target_profile_id, 'superadmin', 'platform_admin.bootstrap',
    'platform_admin.manage', 'platform_admin', target_profile_id::text,
    'success', operator_reference
  );
end;
$bootstrap$;
commit;
SQL

test "$(psql -X -Atq -v ON_ERROR_STOP=1 \
  -v target_profile_id="$SUPERADMIN_PROFILE_ID" -c \
  "select count(*) = 1
   from public.platform_admins pa
   where pa.profile_id = :'target_profile_id'::uuid
     and pa.role = 'superadmin' and pa.active and pa.revoked_at is null
     and exists (
       select 1 from public.admin_audit_events ae
       where ae.actor_profile_id = pa.profile_id
         and ae.action = 'platform_admin.bootstrap'
         and ae.result = 'success'
     )")" = t

unset SUPERADMIN_PROFILE_ID CHANGE_REFERENCE
```

**STOP F:** no desplegar si no existe exactamente un superadmin activo con su evento de auditoría.

## G. Desplegar el commit exacto

```bash
set -euo pipefail
cd /opt/urbanbrain
: "${TARGET_COMMIT:?}" "${PREVIOUS_COMMIT:?}" "${BACKUP_ROOT:?}"

# Los dos archivos locales ya están copiados y hasheados en BACKUP_ROOT.
git restore --source=HEAD --worktree -- package-lock.json public/sw.js
test -z "$(git status --porcelain=v1)"
git checkout --detach "$TARGET_COMMIT"
test "$(git rev-parse HEAD)" = "$TARGET_COMMIT"

npm ci
npm run typecheck
npm run test

# Evita que el proceso activo lea una carpeta .next mientras se reconstruye.
pm2 stop urbanbrain
npm run build
pm2 restart urbanbrain --update-env

test "$(git rev-parse HEAD)" = "$TARGET_COMMIT"
pm2 describe urbanbrain
pm2 jlist | node -e '
let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{
 const p=JSON.parse(s).find(x=>x.name==="urbanbrain");
 process.exit(p?.pm2_env?.status==="online"?0:1)
})'

# El build puede modificar solamente el service worker generado.
test "$(git status --porcelain=v1 | sort)" = ' M public/sw.js'
```

Si `npm run build` falla después de parar PM2, ejecutar inmediatamente la sección J.

## H. Smoke tests

```bash
read -r -p 'Public application URL (https://...): ' APP_URL
APP_URL="${APP_URL%/}"
curl --fail --silent --show-error --location "$APP_URL/login" > /dev/null
curl --fail --silent --show-error --location "$APP_URL/manifest.webmanifest" > /dev/null
curl --fail --silent --show-error --location "$APP_URL/sw.js" > /dev/null
```

En navegador privado, realizar y registrar:

1. Login del superadmin y acceso a `/control-center`.
2. Login de un `organization_members.role = admin` sin `platform_admins`: `/control-center` debe
   devolver la frontera 404, nunca el panel.
3. Usuario A: abrir su expediente, resolver coordenadas/RC/dirección y comprobar fuentes.
4. Usuario A: intentar URL e historial del expediente B; debe recibir 404 y no revelar metadata.
5. Chat: comprobar abstención de parámetros concretos ante contexto manual, conflictivo o sin
   evidencia, y respuesta con fuentes cuando el contexto oficial es suficiente.
6. Verificar escritorio y móvil, y que una caída temporal no borra el último contexto oficial.

**STOP H:** rollback de aplicación si falla autenticación, autorización, carga de expedientes,
chat server-side o Control Center. Si falla el canal RAG o el aislamiento, ejecutar además K.

## I. Cierre satisfactorio

```bash
unset PGPASSWORD PGHOST PGPORT PGUSER PGDATABASE
printf '%s\n' \
  "DEPLOYED_COMMIT=$(git rev-parse HEAD)" \
  "BACKUP_ROOT=$BACKUP_ROOT" \
  "PM2_PROCESS=urbanbrain"
```

No hacer merge automáticamente como parte de este runbook.

## J. Rollback de aplicación

Este rollback no elimina CC-01 ni revierte RLS. Las tablas administrativas permanecen cerradas y
sin uso por el commit anterior.

```bash
set -euo pipefail
cd /opt/urbanbrain
: "${PREVIOUS_COMMIT:?}" "${BACKUP_ROOT:?}"
test -f "$BACKUP_ROOT/package-lock.json.before"
test -f "$BACKUP_ROOT/sw.js.before"

pm2 stop urbanbrain

# Preservar el build fallido sin borrado recursivo.
if test -d .next; then
  mv .next "$BACKUP_ROOT/next.failed.$(date -u +%Y%m%dT%H%M%SZ)"
fi

git restore --source=HEAD --worktree -- package-lock.json public/sw.js
git checkout --detach "$PREVIOUS_COMMIT"
cp -a "$BACKUP_ROOT/package-lock.json.before" package-lock.json
cp -a "$BACKUP_ROOT/sw.js.before" public/sw.js

npm ci
if test -f "$BACKUP_ROOT/next-before.tar.gz"; then
  sha256sum -c "$BACKUP_ROOT/next-before.sha256"
  tar -xzf "$BACKUP_ROOT/next-before.tar.gz"
else
  npm run build
  cp -a "$BACKUP_ROOT/sw.js.before" public/sw.js
fi

pm2 restart urbanbrain --update-env
test "$(git rev-parse HEAD)" = "$PREVIOUS_COMMIT"
pm2 describe urbanbrain
sha256sum -c "$BACKUP_ROOT/vps-files-before.sha256"
```

## K. Rollback RLS fail-closed, sólo si es imprescindible

No restaura permisos anónimos antiguos. Mantiene las tablas cerradas y el canal `service_role`.
CC-01 queda intacto.

```bash
set -euo pipefail
: "${BACKUP_ROOT:?}" "${PGHOST:?}" "${PGUSER:?}" "${PGPASSWORD:?}"
printf '%s  %s\n' \
  066c8dc01e273316225f180b9e1e96426405a7c294f2c198b2ce20fce674af74 \
  "$BACKUP_ROOT/rls-rollback.sql" | sha256sum -c -

psql -X -v ON_ERROR_STOP=1 -f "$BACKUP_ROOT/rls-rollback.sql"

psql -X -v ON_ERROR_STOP=1 <<'SQL'
do $verify$
begin
  if has_table_privilege('anon', 'public.chat_messages', 'SELECT,INSERT,UPDATE,DELETE')
     or has_table_privilege('authenticated', 'public.chat_messages', 'SELECT,INSERT,UPDATE,DELETE')
     or has_function_privilege(
       'anon', 'public.match_normativa_chunks(vector,integer,text)', 'EXECUTE'
     ) or has_function_privilege(
       'authenticated', 'public.match_normativa_chunks(vector,integer,text)', 'EXECUTE'
     ) or not has_function_privilege(
       'service_role', 'public.match_normativa_chunks(vector,integer,text)', 'EXECUTE'
     ) then
    raise exception 'Fail-closed rollback verification failed';
  end if;
end;
$verify$;
SQL
```

Tras K, detener cualquier despliegue y realizar diagnóstico. Nunca aplicar las migraciones
históricas ni restaurar grants amplios de `anon`/`authenticated` como mecanismo de recuperación.
