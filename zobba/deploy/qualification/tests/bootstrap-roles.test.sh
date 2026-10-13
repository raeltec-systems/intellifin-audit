#!/usr/bin/env bash
# Exercises ../bootstrap-roles.sh against a disposable PostgreSQL 16+ server as
# a CREATEROLE/CREATEDB (non-superuser) master, as RDS provides. Needs psql and
# superuser access to a throwaway server:
#   PGHOST PGPORT and SUPERUSER_PASSWORD (user postgres) in the environment.
# Never point this at a real database.
set -euo pipefail

here="$(cd "$(dirname "$0")" && pwd)"
script="$here/../bootstrap-roles.sh"
: "${PGHOST:?}" "${PGPORT:?}" "${SUPERUSER_PASSWORD:?}"
export PGDATABASE=postgres

as_super() { PGUSER=postgres PGPASSWORD="$SUPERUSER_PASSWORD" psql -v ON_ERROR_STOP=1 -qAt "$@"; }
case "$(as_super -c 'select current_database()')" in postgres) ;; *) exit 1 ;; esac

as_super -c "DROP DATABASE IF EXISTS zobba" -c "DROP ROLE IF EXISTS zobba_app" -c "DROP ROLE IF EXISTS zobba_migrator" \
  -c "DROP ROLE IF EXISTS ci_master" -c "DROP ROLE IF EXISTS ci_intruder"
as_super -c "CREATE ROLE ci_master LOGIN CREATEROLE CREATEDB PASSWORD 'disposable-ci-master'" -c "CREATE ROLE ci_intruder NOLOGIN"

migrator_url="postgres://zobba_migrator:ciMigratorPassword1@${PGHOST}:${PGPORT}/zobba?sslmode=prefer"
runtime_url="postgres://zobba_app:ciRuntimePassword1@${PGHOST}:${PGPORT}/zobba?sslmode=prefer"

bootstrap() { # migrator_url runtime_url; prints the script's output
  PGUSER=ci_master PGPASSWORD=disposable-ci-master ZOBBA_DATABASE_NAME=zobba \
    ZOBBA_MIGRATION_DATABASE_URL="$1" ZOBBA_RUNTIME_DATABASE_URL="$2" sh "$script" 2>&1
}
expect_success() {
  local out; out="$(bootstrap "$migrator_url" "$runtime_url")" || { echo "FAIL: $1: bootstrap failed: $out"; exit 1; }
  grep -qx 'bootstrap: roles_ready' <<<"$out" || { echo "FAIL: $1: no roles_ready"; exit 1; }
  echo "ok: $1"
}
expect_refusal() { # name migrator_url runtime_url
  local out status=0; out="$(bootstrap "$2" "$3")" || status=$?
  if [ "$status" -eq 0 ] || grep -q 'roles_ready' <<<"$out"; then echo "FAIL: $1 was not refused"; exit 1; fi
  if grep -q 'ciMigratorPassword1\|ciRuntimePassword1' <<<"$out"; then echo "FAIL: $1 printed a password"; exit 1; fi
  echo "ok: $1 refused (exit $status)"
}

expect_refusal "URL without @" "postgres://zobba_migrator:ciMigratorPassword1" "$runtime_url"
expect_refusal "URL for another role" "postgres://postgres:ciMigratorPassword1@${PGHOST}/zobba" "$runtime_url"
expect_refusal "empty password" "postgres://zobba_migrator:@${PGHOST}/zobba" "$runtime_url"
expect_refusal "non-alphanumeric password" "$migrator_url" "postgres://zobba_app:bad'pw@${PGHOST}/zobba"
expect_refusal "missing URL" "" "$runtime_url"

expect_success "first bootstrap"
expect_success "idempotent rerun"

# PostgreSQL 16+: the CREATEROLE master keeps exactly ADMIN (no INHERIT, no SET)
# on each role it created, and nothing else is a member.
members="$(as_super -c "SELECT r.rolname||':'||m.rolname||':'||a.admin_option||a.inherit_option||a.set_option
  FROM pg_auth_members a JOIN pg_roles r ON r.oid=a.roleid JOIN pg_roles m ON m.oid=a.member
  WHERE r.rolname IN ('zobba_migrator','zobba_app') OR m.rolname IN ('zobba_migrator','zobba_app') ORDER BY 1")"
expected="$(printf 'zobba_app:ci_master:truefalsefalse\nzobba_migrator:ci_master:truefalsefalse')"
[ "$members" = "$expected" ] || { echo "FAIL: unexpected memberships: $members"; exit 1; }
echo "ok: master holds ADMIN only"

as_super -c "ALTER ROLE zobba_app BYPASSRLS"
expect_refusal "BYPASSRLS runtime role" "$migrator_url" "$runtime_url"
as_super -c "ALTER ROLE zobba_app NOBYPASSRLS"
expect_success "after undoing BYPASSRLS"

as_super -c "GRANT zobba_app TO ci_intruder"
expect_refusal "extra member of zobba_app" "$migrator_url" "$runtime_url"
as_super -c "REVOKE zobba_app FROM ci_intruder"
expect_success "after removing the extra member"

as_super -c "GRANT ci_intruder TO zobba_app"
expect_refusal "zobba_app member of another role" "$migrator_url" "$runtime_url"
as_super -c "REVOKE ci_intruder FROM zobba_app"
expect_success "after removing that membership"

# A leftover SET option on the master's own (creator) membership is not removed
# by the script's REVOKE (which only removes the grant it made) and must be refused.
as_super -c "GRANT zobba_migrator TO ci_master WITH SET TRUE GRANTED BY postgres"
expect_refusal "leftover master SET membership" "$migrator_url" "$runtime_url"
as_super -c "REVOKE SET OPTION FOR zobba_migrator FROM ci_master GRANTED BY postgres"
expect_success "after removing the leftover membership"
echo "bootstrap-roles tests passed"
