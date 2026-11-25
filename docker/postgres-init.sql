-- HSG database bootstrap. Run once as a Postgres superuser on an empty server:
--   * Docker: mounted into /docker-entrypoint-initdb.d (runs on first start of the volume)
--   * CI:     psql -h localhost -U postgres -f docker/postgres-init.sql
--   * Native: psql -d postgres -f docker/postgres-init.sql
--
-- Two roles, matching hsg-backend/.env:
--   hsg_owner  owns the schema and runs migrations (superuser so the raw-SQL
--              migration can create triggers and set grants)
--   hsg_app    the runtime role. Gets DML on tables through DEFAULT PRIVILEGES;
--              the ledger_guards migration then REVOKEs UPDATE/DELETE on the
--              journal tables, leaving INSERT/SELECT only (append-only ledger).

CREATE ROLE hsg_owner WITH LOGIN SUPERUSER PASSWORD 'hsg_owner';
CREATE ROLE hsg_app   WITH LOGIN PASSWORD 'hsg_app';

CREATE DATABASE hsg      OWNER hsg_owner;
CREATE DATABASE hsg_test OWNER hsg_owner;

-- Grants must exist BEFORE migrations create tables, so they live here.
\connect hsg
SET ROLE hsg_owner;
GRANT USAGE ON SCHEMA public TO hsg_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO hsg_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT USAGE, SELECT ON SEQUENCES TO hsg_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT EXECUTE ON FUNCTIONS TO hsg_app;
RESET ROLE;

\connect hsg_test
SET ROLE hsg_owner;
GRANT USAGE ON SCHEMA public TO hsg_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO hsg_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT USAGE, SELECT ON SEQUENCES TO hsg_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT EXECUTE ON FUNCTIONS TO hsg_app;
RESET ROLE;
