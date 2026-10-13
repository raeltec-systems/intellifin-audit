set -eu
# One-off role bootstrap (zobba/deploy/RUNBOOK.md). Runs as the RDS master user
# from the RDS-managed secret. Idempotent: rerun it after rotating passwords
# (database_password_version). Prints no secret values.
#
# The role passwords come from the two URL secrets, so the database and the
# secrets always agree. Generated passwords are alphanumeric, so they appear
# in the URLs without percent-encoding.

migrator_rest="${ZOBBA_MIGRATION_DATABASE_URL#postgres://zobba_migrator:}"
runtime_rest="${ZOBBA_RUNTIME_DATABASE_URL#postgres://zobba_app:}"
if [ "$migrator_rest" = "$ZOBBA_MIGRATION_DATABASE_URL" ] || [ "$runtime_rest" = "$ZOBBA_RUNTIME_DATABASE_URL" ]; then
  echo "bootstrap: unexpected database URL form" >&2
  exit 2
fi
ZOBBA_MIGRATOR_PASSWORD="${migrator_rest%%@*}"
ZOBBA_RUNTIME_PASSWORD="${runtime_rest%%@*}"
export ZOBBA_MIGRATOR_PASSWORD ZOBBA_RUNTIME_PASSWORD
unset ZOBBA_MIGRATION_DATABASE_URL ZOBBA_RUNTIME_DATABASE_URL migrator_rest runtime_rest

psql --no-psqlrc --quiet -v ON_ERROR_STOP=1 <<'SQL'
\getenv migrator_password ZOBBA_MIGRATOR_PASSWORD
\getenv runtime_password ZOBBA_RUNTIME_PASSWORD
\getenv database_name ZOBBA_DATABASE_NAME

SELECT 'CREATE ROLE zobba_migrator' WHERE NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'zobba_migrator') \gexec
SELECT 'CREATE ROLE zobba_app' WHERE NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'zobba_app') \gexec
SELECT format('ALTER ROLE zobba_migrator WITH LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS PASSWORD %L', :'migrator_password') \gexec
SELECT format('ALTER ROLE zobba_app WITH LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS PASSWORD %L', :'runtime_password') \gexec

-- Creating a database owned by another role requires SET on that role. Grant
-- it only for this statement, then remove it again.
GRANT zobba_migrator TO CURRENT_USER WITH SET TRUE, INHERIT FALSE;
SELECT format('CREATE DATABASE %I OWNER zobba_migrator', :'database_name')
  WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname = :'database_name') \gexec
REVOKE zobba_migrator FROM CURRENT_USER;
SELECT format('REVOKE ALL ON DATABASE %I FROM PUBLIC', :'database_name') \gexec
SELECT format('GRANT CONNECT ON DATABASE %I TO zobba_app', :'database_name') \gexec

-- Refuse to finish unless both roles have exactly the required attributes,
-- belong to no role (in particular not rds_superuser) and the migrator owns
-- the database.
SELECT count(*) = 2 AS roles_safe
  FROM pg_roles
 WHERE rolname IN ('zobba_migrator', 'zobba_app')
   AND rolcanlogin AND NOT rolsuper AND NOT rolcreatedb AND NOT rolcreaterole
   AND NOT rolinherit AND NOT rolbypassrls AND NOT rolreplication
   AND NOT EXISTS (SELECT FROM pg_auth_members m WHERE m.member = pg_roles.oid) \gset
\if :roles_safe
\else
  DO $$ BEGIN RAISE EXCEPTION 'bootstrap: role attributes or memberships are unsafe'; END $$;
\endif
SELECT pg_get_userbyid(datdba) = 'zobba_migrator' AS owner_ok FROM pg_database WHERE datname = :'database_name' \gset
\if :owner_ok
\else
  DO $$ BEGIN RAISE EXCEPTION 'bootstrap: database is not owned by zobba_migrator'; END $$;
\endif
SQL
echo "bootstrap: roles_ready"
