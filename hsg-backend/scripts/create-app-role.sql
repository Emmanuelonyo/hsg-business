-- Run ONCE as the database owner on a hosted Postgres (e.g. Railway), after migrations.
-- Creates the restricted runtime role and applies the same grants as a local setup:
-- full DML on ordinary tables, but only SELECT/INSERT on the append-only journal.
-- Replace :APP_PASSWORD before running, e.g. sed "s/:APP_PASSWORD/$PW/g" | npx prisma db execute --stdin.
DO $$BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'hsg_app') THEN
    CREATE ROLE hsg_app LOGIN PASSWORD ':APP_PASSWORD';
  ELSE
    ALTER ROLE hsg_app LOGIN PASSWORD ':APP_PASSWORD';
  END IF;
END$$;
GRANT USAGE ON SCHEMA public TO hsg_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO hsg_app;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO hsg_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO hsg_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT USAGE, SELECT ON SEQUENCES TO hsg_app;
REVOKE UPDATE, DELETE, TRUNCATE ON journal_entries, journal_lines FROM hsg_app;
