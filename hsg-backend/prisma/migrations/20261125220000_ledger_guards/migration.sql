-- Ledger guards: things Prisma's schema language cannot express.
-- 1. Append-only journal: a trigger raises on UPDATE / DELETE / TRUNCATE.
-- 2. The application role (hsg_app) may only INSERT and SELECT journal rows.
-- 3. Seed the single ledger_head row (the lock every posting takes).
-- 4. Seed the six house accounts of the chart of accounts.

-- 1. Trigger function: any attempt to change or remove journal history fails.
CREATE OR REPLACE FUNCTION journal_append_only() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'journal is append-only: % on % is not allowed', TG_OP, TG_TABLE_NAME
    USING ERRCODE = 'insufficient_privilege';
END;
$$ LANGUAGE plpgsql;

-- Row-level: fires for every UPDATE or DELETE.
CREATE TRIGGER journal_entries_append_only
  BEFORE UPDATE OR DELETE ON "journal_entries"
  FOR EACH ROW EXECUTE FUNCTION journal_append_only();

CREATE TRIGGER journal_lines_append_only
  BEFORE UPDATE OR DELETE ON "journal_lines"
  FOR EACH ROW EXECUTE FUNCTION journal_append_only();

-- Statement-level: TRUNCATE skips row triggers, so it needs its own.
CREATE TRIGGER journal_entries_no_truncate
  BEFORE TRUNCATE ON "journal_entries"
  FOR EACH STATEMENT EXECUTE FUNCTION journal_append_only();

CREATE TRIGGER journal_lines_no_truncate
  BEFORE TRUNCATE ON "journal_lines"
  FOR EACH STATEMENT EXECUTE FUNCTION journal_append_only();

-- 2. Privileges: the app role keeps SELECT and INSERT on the journal, nothing else.
--    (Belt and braces: even without the trigger, hsg_app cannot UPDATE/DELETE.)
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'hsg_app') THEN
    REVOKE UPDATE, DELETE, TRUNCATE ON "journal_entries" FROM hsg_app;
    REVOKE UPDATE, DELETE, TRUNCATE ON "journal_lines" FROM hsg_app;
    GRANT SELECT, INSERT ON "journal_entries", "journal_lines" TO hsg_app;
    -- ledger_head is updated on every posting, so the app needs UPDATE there.
    GRANT SELECT, INSERT, UPDATE ON "ledger_head" TO hsg_app;
  END IF;
END
$$;

-- 3. The chain starts from a genesis hash of 64 zeros at seq 0.
INSERT INTO "ledger_head" ("id", "last_seq", "last_hash")
VALUES (1, 0, '0000000000000000000000000000000000000000000000000000000000000000')
ON CONFLICT ("id") DO NOTHING;

-- 4. House accounts (SME accounts 2000-{sme} / 2100-{sme} are created on demand).
INSERT INTO "ledger_accounts" ("id", "code", "name", "type", "currency") VALUES
  ('la_1000', '1000', 'Settlement bank', 'ASSET', 'NGN'),
  ('la_1100', '1100', 'Stablecoin reserve (treasury wallet)', 'ASSET', 'USD'),
  ('la_1200', '1200', 'Provider receivable', 'ASSET', 'USD'),
  ('la_3000', '3000', 'FX position NGN', 'CLEARING', 'NGN'),
  ('la_3100', '3100', 'FX position USD', 'CLEARING', 'USD'),
  ('la_4000', '4000', 'Fee income', 'INCOME', 'NGN')
ON CONFLICT DO NOTHING;
