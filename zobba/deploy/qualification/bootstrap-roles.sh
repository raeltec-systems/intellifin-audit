set -eu
# One-off role bootstrap (zobba/deploy/RUNBOOK.md). Runs as the RDS master user
# from the RDS-managed secret. Idempotent: rerun it after rotating passwords
# (database_password_version). Prints no secret values.
#
# The role passwords come from the two URL secrets, so the database and the
# secrets always agree. Generated passwords are alphanumeric, so they appear
# in the URLs without percent-encoding.

# Refuse anything but postgres://<role>:<alphanumeric password>@<host...>.
url_password() {
  case "$2" in
    "postgres://$1:"*@*) ;;
    *) echo "bootstrap: $1 URL secret is malformed" >&2; exit 2 ;;
  esac
  rest="${2#"postgres://$1:"}"
  password="${rest%%@*}"
  host="${rest#*@}"
  case "$password" in
    "" | *[!A-Za-z0-9]*) echo "bootstrap: $1 URL secret is malformed" >&2; exit 2 ;;
  esac
  case "$host" in
    "" | /* | @*) echo "bootstrap: $1 URL secret is malformed" >&2; exit 2 ;;
  esac
  printf '%s' "$password"
}

ZOBBA_MIGRATOR_PASSWORD="$(url_password zobba_migrator "${ZOBBA_MIGRATION_DATABASE_URL:-}")"
ZOBBA_RUNTIME_PASSWORD="$(url_password zobba_app "${ZOBBA_RUNTIME_DATABASE_URL:-}")"
export ZOBBA_MIGRATOR_PASSWORD ZOBBA_RUNTIME_PASSWORD
unset ZOBBA_MIGRATION_DATABASE_URL ZOBBA_RUNTIME_DATABASE_URL

psql --no-psqlrc --quiet -v ON_ERROR_STOP=1 <<'SQL'
\getenv migrator_password ZOBBA_MIGRATOR_PASSWORD
\getenv runtime_password ZOBBA_RUNTIME_PASSWORD
\getenv database_name ZOBBA_DATABASE_NAME

-- Create with every required attribute. On a rerun, ALTER only what a
-- CREATEROLE (non-superuser) master may set; SUPERUSER, BYPASSRLS and
-- REPLICATION can only differ if a superuser changed them, which the final
-- check refuses.
SELECT 'CREATE ROLE zobba_migrator LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS NOREPLICATION'
  WHERE NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'zobba_migrator') \gexec
SELECT 'CREATE ROLE zobba_app LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS NOREPLICATION'
  WHERE NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'zobba_app') \gexec
SELECT format('ALTER ROLE zobba_migrator WITH LOGIN NOCREATEDB NOCREATEROLE NOINHERIT PASSWORD %L', :'migrator_password') \gexec
SELECT format('ALTER ROLE zobba_app WITH LOGIN NOCREATEDB NOCREATEROLE NOINHERIT PASSWORD %L', :'runtime_password') \gexec

-- Creating a database owned by another role, and changing that database's
-- privileges, require SET on the owner. Hold it only for these statements.
GRANT zobba_migrator TO CURRENT_USER WITH SET TRUE, INHERIT FALSE;
SELECT format('CREATE DATABASE %I OWNER zobba_migrator', :'database_name')
  WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname = :'database_name') \gexec
SET ROLE zobba_migrator;
SELECT format('REVOKE ALL ON DATABASE %I FROM PUBLIC', :'database_name') \gexec
SELECT format('GRANT CONNECT ON DATABASE %I TO zobba_app', :'database_name') \gexec
RESET ROLE;
REVOKE zobba_migrator FROM CURRENT_USER;

-- Refuse to finish unless both roles have exactly the required attributes,
-- belong to no role (in particular not rds_superuser), and have no members
-- except the one PostgreSQL 16+ creates for a CREATEROLE (non-superuser)
-- master: the creator itself with ADMIN only (no INHERIT, no SET). Any other
-- member, or a leftover SET/INHERIT grant to the master, is refused.
SELECT count(*) = 2 AS roles_safe
  FROM pg_roles
 WHERE rolname IN ('zobba_migrator', 'zobba_app')
   AND rolcanlogin AND NOT rolsuper AND NOT rolcreatedb AND NOT rolcreaterole
   AND NOT rolinherit AND NOT rolbypassrls AND NOT rolreplication
   AND NOT EXISTS (SELECT FROM pg_auth_members m WHERE m.member = pg_roles.oid)
   AND NOT EXISTS (
     SELECT FROM pg_auth_members m
      WHERE m.roleid = pg_roles.oid
        AND NOT (m.member = (SELECT oid FROM pg_roles WHERE rolname = current_user)
                 AND m.admin_option AND NOT m.inherit_option AND NOT m.set_option)) \gset
\if :roles_safe
\else
  DO $$ BEGIN RAISE EXCEPTION 'bootstrap: role attributes or memberships are unsafe'; END $$;
\endif
SELECT pg_get_userbyid(datdba) = 'zobba_migrator'
       AND NOT has_database_privilege('public', datname, 'CONNECT')
       AND has_database_privilege('zobba_app', datname, 'CONNECT')
       AND NOT has_database_privilege('zobba_app', datname, 'CREATE') AS owner_ok
  FROM pg_database WHERE datname = :'database_name' \gset
\if :owner_ok
\else
  DO $$ BEGIN RAISE EXCEPTION 'bootstrap: database owner or CONNECT privileges are wrong'; END $$;
\endif
SQL
echo "bootstrap: roles_ready"
