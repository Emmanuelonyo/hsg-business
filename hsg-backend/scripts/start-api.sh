#!/bin/sh
# API container entrypoint (hosted deploys, e.g. Railway).
#  1. RESOLVE_ROLLED_BACK=<migration> marks a failed migration as rolled back (one-off recovery).
#  2. APP_DB_PASSWORD set: make sure the restricted role hsg_app exists BEFORE migrating, so the
#     migrations' conditional grants/revokes apply to it.
#  3. Apply migrations as the owner (MIGRATE_DATABASE_URL).
#  4. Re-apply hsg_app grants (idempotent): DML on tables, SELECT/INSERT only on the journal.
#  5. Serve the API.
set -e
if [ -n "$RESOLVE_ROLLED_BACK" ]; then
  npx prisma migrate resolve --rolled-back "$RESOLVE_ROLLED_BACK" || true
fi
if [ -n "$APP_DB_PASSWORD" ]; then
  printf "DO \$\$BEGIN IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='hsg_app') THEN CREATE ROLE hsg_app LOGIN PASSWORD '%s'; END IF; END\$\$;" "$APP_DB_PASSWORD" \
    | npx prisma db execute --stdin --url "$MIGRATE_DATABASE_URL"
fi
npx prisma migrate deploy
if [ -n "$APP_DB_PASSWORD" ]; then
  sed "s/:APP_PASSWORD/$APP_DB_PASSWORD/g" scripts/create-app-role.sql | npx prisma db execute --stdin --url "$MIGRATE_DATABASE_URL"
fi
exec node dist/main.js
