#!/usr/bin/env bash
# =============================================================================
# HSG one-command local runner (native path: Postgres, Redis and Foundry anvil
# installed on the host). Docker users: see docker-compose.yml instead.
#
#   ./dev.sh              start api (:4000), worker and web (:3000) against the
#                         existing database and chain
#   ./dev.sh --fresh      wipe and rebuild everything first:
#                           1. drop + recreate the database, apply role grants
#                           2. prisma migrate deploy (all migrations, incl. ledger guards)
#                           3. flush the Redis DB (queues, nonce counters, fault switches)
#                           4. restart anvil (a fresh DB needs a fresh chain so that
#                              ledger account 1100 == treasury tokens on chain)
#                           5. npm run chain:deploy  (mock token + funded wallets)
#                           6. npm run db:seed
#   ./dev.sh --fresh --yes   same, without the confirmation prompt
#   ./dev.sh --no-web        backend only (api + worker)
#   ./dev.sh --setup-only    with --fresh: rebuild, then exit without starting processes
#
# Every setting can be overridden from the environment; anything not set falls
# back to hsg-backend/.env. Useful overrides:
#   DB_NAME=hsg_scratch   use another database (URLs are rebuilt with that name)
#   ANVIL_PORT=8555       run/expect anvil on another port (RPC_URL is rebuilt)
#   API_PORT=4000  WEB_PORT=3000  REDIS_URL=redis://localhost:6379/0
#   CHAIN_CONFIG_PATH=./chain.local.json   (relative to hsg-backend/)
#
# Ctrl-C stops api, worker and web. Anvil started by --fresh keeps running in
# the background (its state must outlive the processes); its log is in .devlogs/.
#
# Written for bash 3.2 (macOS default) as well as bash 5.
# =============================================================================
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BACKEND="$ROOT/hsg-backend"
FRONTEND="$ROOT/hsg-frontend"
LOGDIR="$ROOT/.devlogs"
MNEMONIC="test test test test test test test test test test test junk"

# ---- colours ---------------------------------------------------------------
if [ -t 1 ]; then
  C_RESET=$'\033[0m'; C_BOLD=$'\033[1m'; C_RED=$'\033[31m'; C_GREEN=$'\033[32m'
  C_YELLOW=$'\033[33m'; C_BLUE=$'\033[34m'; C_MAGENTA=$'\033[35m'; C_CYAN=$'\033[36m'
else
  C_RESET=""; C_BOLD=""; C_RED=""; C_GREEN=""; C_YELLOW=""; C_BLUE=""; C_MAGENTA=""; C_CYAN=""
fi
say()  { printf '%s[dev]%s %s\n' "$C_BOLD" "$C_RESET" "$*"; }
ok()   { printf '%s[dev] ✓%s %s\n' "$C_GREEN" "$C_RESET" "$*"; }
warn() { printf '%s[dev] !%s %s\n' "$C_YELLOW" "$C_RESET" "$*"; }
die()  { printf '%s[dev] ✗ %s%s\n' "$C_RED" "$*" "$C_RESET" >&2; exit 1; }

# ---- flags -----------------------------------------------------------------
FRESH=0; YES=0; NO_WEB=0; SETUP_ONLY=0
for arg in "$@"; do
  case "$arg" in
    --fresh) FRESH=1 ;;
    --yes|-y) YES=1 ;;
    --no-web) NO_WEB=1 ;;
    --setup-only) SETUP_ONLY=1 ;;
    -h|--help) sed -n '2,32p' "$0"; exit 0 ;;
    *) die "unknown flag: $arg (try --help)" ;;
  esac
done

# ---- configuration -----------------------------------------------------------
# Load hsg-backend/.env without overriding anything already in the environment.
if [ -f "$BACKEND/.env" ]; then
  while IFS= read -r line || [ -n "$line" ]; do
    case "$line" in ''|'#'*) continue ;; esac
    key="${line%%=*}"; val="${line#*=}"
    case "$key" in *[!A-Za-z0-9_]*|'') continue ;; esac
    if [ -z "${!key+x}" ]; then export "$key=$val"; fi
  done < "$BACKEND/.env"
else
  warn "hsg-backend/.env not found; using built-in defaults (copy .env.example to .env)"
fi

: "${DATABASE_URL:=postgresql://hsg_app:hsg_app@localhost:5432/hsg}"
: "${MIGRATE_DATABASE_URL:=postgresql://hsg_owner:hsg_owner@localhost:5432/hsg}"
: "${REDIS_URL:=redis://localhost:6379/0}"
: "${RPC_URL:=http://127.0.0.1:8545}"
: "${CHAIN_CONFIG_PATH:=./chain.local.json}"
: "${API_PORT:=4000}"
: "${WEB_PORT:=3000}"

# DB_NAME override: swap the database name in both connection strings.
set_db_name() { printf '%s' "$1" | sed -E "s#/[^/?]+(\\?|\$)#/$2\\1#"; }
if [ -n "${DB_NAME:-}" ]; then
  DATABASE_URL="$(set_db_name "$DATABASE_URL" "$DB_NAME")"
  MIGRATE_DATABASE_URL="$(set_db_name "$MIGRATE_DATABASE_URL" "$DB_NAME")"
fi
DB_NAME="$(printf '%s' "$MIGRATE_DATABASE_URL" | sed -E 's#.*/([^/?]+)(\?.*)?$#\1#')"
ADMIN_URL="$(set_db_name "$MIGRATE_DATABASE_URL" postgres)"
OWNER_ROLE="$(printf '%s' "$MIGRATE_DATABASE_URL" | sed -E 's#^[a-z]+://([^:@/]+).*#\1#')"
APP_ROLE="$(printf '%s' "$DATABASE_URL" | sed -E 's#^[a-z]+://([^:@/]+).*#\1#')"

# ANVIL_PORT override rebuilds RPC_URL; otherwise read the port from RPC_URL.
if [ -n "${ANVIL_PORT:-}" ]; then
  RPC_URL="http://127.0.0.1:$ANVIL_PORT"
else
  ANVIL_PORT="$(printf '%s' "$RPC_URL" | sed -nE 's#^https?://[^/:]+:([0-9]+).*#\1#p')"
fi
RPC_IS_LOCAL=0
case "$RPC_URL" in http://127.0.0.1:*|http://localhost:*) RPC_IS_LOCAL=1 ;; esac

export DATABASE_URL MIGRATE_DATABASE_URL REDIS_URL RPC_URL CHAIN_CONFIG_PATH API_PORT
export WEB_ORIGIN="http://localhost:$WEB_PORT"
export API_INTERNAL_URL="http://localhost:$API_PORT"   # read by hsg-frontend/next.config.ts

# Resolve CHAIN_CONFIG_PATH relative to hsg-backend (where every backend process runs).
case "$CHAIN_CONFIG_PATH" in /*) CHAIN_CONFIG_ABS="$CHAIN_CONFIG_PATH" ;; *) CHAIN_CONFIG_ABS="$BACKEND/$CHAIN_CONFIG_PATH" ;; esac

PSQL="$(command -v psql || true)"
[ -z "$PSQL" ] && [ -x /opt/homebrew/opt/postgresql@15/bin/psql ] && PSQL=/opt/homebrew/opt/postgresql@15/bin/psql
[ -z "$PSQL" ] && [ -x /opt/homebrew/opt/postgresql@16/bin/psql ] && PSQL=/opt/homebrew/opt/postgresql@16/bin/psql

redact() { printf '%s' "$1" | sed -E 's#://([^:@/]+):[^@]*@#://\1:***@#'; }

say "database  $(redact "$MIGRATE_DATABASE_URL")  (app role: $APP_ROLE)"
say "redis     $REDIS_URL"
say "chain     $RPC_URL  config: $CHAIN_CONFIG_PATH"
say "ports     api :$API_PORT  web :$WEB_PORT"

# ---- prerequisites ------------------------------------------------------------
need() { command -v "$1" >/dev/null 2>&1 || die "missing '$1' on PATH. $2"; }
need node "Install Node.js 22."
need npm  "Install Node.js 22."
need curl "Install curl."
need redis-cli "Install Redis (brew install redis)."
[ -n "$PSQL" ] || die "missing 'psql'. Install PostgreSQL 15/16 (brew install postgresql@16)."
[ -d "$BACKEND/node_modules" ] || die "hsg-backend/node_modules missing: run 'cd hsg-backend && npm ci' once."
[ "$NO_WEB" = 1 ] || [ -d "$FRONTEND/node_modules" ] || die "hsg-frontend/node_modules missing: run 'cd hsg-frontend && npm ci' once."

if command -v pg_isready >/dev/null 2>&1; then
  pg_isready -d "$ADMIN_URL" -q || die "Postgres is not accepting connections ($(redact "$ADMIN_URL")). Start it: brew services start postgresql@16"
fi
"$PSQL" "$ADMIN_URL" -Atqc 'select 1' >/dev/null 2>&1 \
  || die "cannot connect to Postgres as '$OWNER_ROLE'. Create roles first: psql -d postgres -f docker/postgres-init.sql"
ok "postgres reachable"

[ "$(redis-cli -u "$REDIS_URL" ping 2>/dev/null)" = "PONG" ] || die "Redis is not answering at $REDIS_URL. Start it: brew services start redis"
ok "redis reachable"

rpc_alive() {
  curl -s -m 2 -X POST -H 'content-type: application/json' \
    --data '{"jsonrpc":"2.0","id":1,"method":"eth_chainId","params":[]}' "$RPC_URL" 2>/dev/null | grep -q '"result"'
}

port_in_use() { lsof -nP -iTCP:"$1" -sTCP:LISTEN -t >/dev/null 2>&1; }

# ---- --fresh: rebuild database, redis, chain, seed -------------------------------
mkdir -p "$LOGDIR"

if [ "$FRESH" = 1 ]; then
  if [ "$YES" != 1 ]; then
    if [ -t 0 ]; then
      printf '%s[dev] --fresh will DROP database "%s", FLUSH %s and restart anvil on :%s. Continue? [y/N] %s' \
        "$C_YELLOW" "$DB_NAME" "$REDIS_URL" "$ANVIL_PORT" "$C_RESET"
      read -r answer
      case "$answer" in y|Y|yes|YES) ;; *) die "aborted" ;; esac
    else
      die "--fresh needs confirmation; re-run with --yes in non-interactive shells"
    fi
  fi

  # 1. Database: drop + recreate as the owner role, then grant the app role.
  #    (We drop the whole database rather than 'prisma migrate reset' so the default
  #    privileges below are guaranteed to exist BEFORE the migrations create tables.)
  say "recreating database $DB_NAME"
  "$PSQL" "$ADMIN_URL" -v ON_ERROR_STOP=1 -q \
    -c "DROP DATABASE IF EXISTS \"$DB_NAME\" WITH (FORCE)" \
    -c "CREATE DATABASE \"$DB_NAME\" OWNER \"$OWNER_ROLE\""
  # Same grants as docker/postgres-init.sql: app role gets DML on tables the owner
  # creates; the ledger-guards migration then revokes UPDATE/DELETE on journal tables.
  "$PSQL" "$MIGRATE_DATABASE_URL" -v ON_ERROR_STOP=1 -q \
    -c "GRANT USAGE ON SCHEMA public TO \"$APP_ROLE\"" \
    -c "ALTER DEFAULT PRIVILEGES FOR ROLE \"$OWNER_ROLE\" IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO \"$APP_ROLE\"" \
    -c "ALTER DEFAULT PRIVILEGES FOR ROLE \"$OWNER_ROLE\" IN SCHEMA public GRANT USAGE, SELECT ON SEQUENCES TO \"$APP_ROLE\"" \
    -c "ALTER DEFAULT PRIVILEGES FOR ROLE \"$OWNER_ROLE\" IN SCHEMA public GRANT EXECUTE ON FUNCTIONS TO \"$APP_ROLE\""
  ok "database $DB_NAME created"

  # 2. Migrations (runs as the owner through MIGRATE_DATABASE_URL = prisma directUrl).
  say "applying migrations"
  (cd "$BACKEND" && npx prisma migrate deploy) || die "prisma migrate deploy failed"
  ok "migrations applied"

  # 3. Redis: queues, nonce counters and fault switches belong to the old chain/DB.
  redis-cli -u "$REDIS_URL" FLUSHDB >/dev/null
  ok "redis $REDIS_URL flushed"

  # 4. Fresh anvil. Only here do we ever kill an existing anvil.
  if [ "$RPC_IS_LOCAL" = 1 ]; then
    command -v anvil >/dev/null 2>&1 || die "missing 'anvil'. Install Foundry: curl -L https://foundry.paradigm.xyz | bash && foundryup"
    if port_in_use "$ANVIL_PORT"; then
      warn "stopping the process listening on :$ANVIL_PORT (old chain)"
      lsof -nP -iTCP:"$ANVIL_PORT" -sTCP:LISTEN -t | xargs kill 2>/dev/null || true
      for _ in 1 2 3 4 5 6 7 8 9 10; do port_in_use "$ANVIL_PORT" || break; sleep 0.5; done
      port_in_use "$ANVIL_PORT" && die "port $ANVIL_PORT still busy"
    fi
    say "starting anvil on :$ANVIL_PORT (2 s blocks, chainId 31337) -> .devlogs/anvil-$ANVIL_PORT.log"
    nohup anvil --port "$ANVIL_PORT" --block-time 2 --chain-id 31337 --mnemonic "$MNEMONIC" \
      > "$LOGDIR/anvil-$ANVIL_PORT.log" 2>&1 < /dev/null &
    disown 2>/dev/null || true
    for _ in $(seq 1 30); do rpc_alive && break; sleep 0.5; done
    rpc_alive || die "anvil did not come up; see .devlogs/anvil-$ANVIL_PORT.log"
    ok "anvil up"
  else
    warn "RPC_URL is not local ($RPC_URL); not touching the chain. Make sure it is reachable and funded."
    rpc_alive || die "RPC $RPC_URL not answering"
  fi

  # 5. Deploy mock token + fund treasury wallets -> chain config file.
  say "deploying mock token (npm run chain:deploy)"
  (cd "$BACKEND" && npm run --silent chain:deploy) || die "chain:deploy failed"
  [ -f "$CHAIN_CONFIG_ABS" ] || die "chain:deploy did not write $CHAIN_CONFIG_PATH"
  ok "chain config written: $CHAIN_CONFIG_PATH"

  # 6. Seed (operator, 100 SMEs, providers, wallets, watchlist, treasury funding entries).
  say "seeding (npm run db:seed)"
  (cd "$BACKEND" && npm run --silent db:seed) || die "db:seed failed"
  ok "seed complete"

  if [ "$SETUP_ONLY" = 1 ]; then ok "setup finished (--setup-only)"; exit 0; fi
else
  rpc_alive || die "no chain at $RPC_URL. Run './dev.sh --fresh' to start anvil and rebuild a matching database."
  ok "chain reachable"
  [ -f "$CHAIN_CONFIG_ABS" ] || die "$CHAIN_CONFIG_PATH missing in hsg-backend/. Run './dev.sh --fresh'."
  [ "$SETUP_ONLY" = 1 ] && die "--setup-only only makes sense with --fresh"
fi

# ---- start processes ----------------------------------------------------------
port_in_use "$API_PORT" && die "port $API_PORT already in use (another API running?)"
if [ "$NO_WEB" != 1 ]; then port_in_use "$WEB_PORT" && die "port $WEB_PORT already in use"; fi

# Job control: each background pipeline gets its own process group, so cleanup can
# kill npm *and* the node processes it spawned with one signal per group.
set -m
PIDS=""
NAMES=""

# start <name> <colour> <dir> <command...>
start() {
  local name="$1" colour="$2" dir="$3"; shift 3
  local tag
  tag="$(printf '%s%-6s|%s ' "$colour" "$name" "$C_RESET")"
  ( cd "$dir" && exec "$@" ) 2>&1 | sed -u "s/^/$tag/" &
  # With set -m the job's process-group id is the pid of the pipeline's first process.
  PIDS="$PIDS $(jobs -p | tail -n 1)"
  NAMES="$NAMES $name"
}

CLEANED=0
cleanup() {
  [ "$CLEANED" = 1 ] && return; CLEANED=1
  echo
  say "stopping api, worker, web"
  for pid in $PIDS; do kill -TERM -- "-$pid" 2>/dev/null || true; done
  sleep 1
  for pid in $PIDS; do kill -KILL -- "-$pid" 2>/dev/null || true; done
  if [ "$FRESH" = 1 ] && [ "$RPC_IS_LOCAL" = 1 ]; then
    say "anvil is still running on :$ANVIL_PORT (keeps the chain in step with the database)"
  fi
}
trap cleanup EXIT
trap 'exit 130' INT TERM

# api first; the worker starts once the API answers, because both 'nest start --watch'
# processes compile into the same dist/ folder (deleteOutDir) and would race otherwise.
start api    "$C_CYAN"    "$BACKEND"  npm run --silent dev:api
if [ "$NO_WEB" != 1 ]; then
  start web  "$C_BLUE"    "$FRONTEND" npm run --silent dev -- -p "$WEB_PORT"
fi

# ---- wait for the API ------------------------------------------------------------
# No health endpoint needed: an empty login body must answer 400 (validation) or 401.
say "waiting for the API on http://localhost:$API_PORT/api ..."
API_UP=0
for _ in $(seq 1 120); do
  code="$(curl -s -o /dev/null -w '%{http_code}' -m 2 -X POST -H 'content-type: application/json' \
          --data '{}' "http://localhost:$API_PORT/api/auth/login" 2>/dev/null || true)"
  case "$code" in 400|401|422) API_UP=1; break ;; esac
  sleep 1
done
[ "$API_UP" = 1 ] || die "API did not answer within 120 s (see the api| lines above)"
ok "API answering"
start worker "$C_MAGENTA" "$BACKEND"  npm run --silent dev:worker

cat <<EOF

${C_GREEN}${C_BOLD}HSG is up${C_RESET}
  SME app        http://localhost:$WEB_PORT/login   (then /app)
  Ops console    http://localhost:$WEB_PORT/ops
  API            http://localhost:$API_PORT/api
  Chain RPC      $RPC_URL

  Logins (password for all: Passw0rd!)
    SME (demo)       funmi@adebayoimports.ng
    Operator         ops@hsg.test
    Load-test SMEs   sme001@hsg.test ... sme100@hsg.test

  Demo script: docs/DEMO-RUNBOOK.md      Ctrl-C stops everything.

EOF

# ---- supervise -------------------------------------------------------------------
# bash 3.2 has no 'wait -n', so poll: if any process exits, stop the rest.
while :; do
  i=0
  for pid in $PIDS; do
    i=$((i + 1))
    if ! kill -0 "$pid" 2>/dev/null; then
      name="$(echo $NAMES | cut -d' ' -f"$i")"
      warn "$name exited; shutting down"
      exit 1
    fi
  done
  sleep 2
done
