# Hybrid Settlement Gateway (HSG)

HSG is a cross-border payment gateway for Nigerian importers. A business funds a naira virtual account and pays a foreign supplier in dollars. It sees only banking concepts: a balance, a beneficiary, a rate, a fee and a transfer status. Underneath, the naira is held on a double-entry ledger, a dollar stablecoin moves on an EVM test network from a gateway treasury wallet to a liquidity provider, and the provider pays the beneficiary in local currency. This is the "hybrid" part: fiat at both edges, a blockchain leg in the middle.

This repository is the one-day vertical slice described in `docs/Hybrid Settlement Gateway — One-Day Build PRD.md`. It covers one corridor (NGN to USD) and one web app with two roles: the SME user and the gateway operator. It includes an append-only, hash-chained ledger; compliance gates (KYB, sanctions, Travel Rule, threshold, velocity) with a review queue; a BullMQ saga with retries, idempotency and compensating reversal; a mock ERC-20 on a local chain; and simulators for the bank (NIP), the liquidity providers and faults. The API contract is `docs/API-CONTRACT.md`, and the demo script is `docs/DEMO-RUNBOOK.md`.

## Architecture

```
                 browser
                    |
                    v
   +-------------------------------------+
   |  web  (Next.js, :3000)              |   /login, /app/* (SME), /ops/* (operator)
   |  /api/*  --rewrite-->  api:4000     |   same-origin proxy, JWT in cookie/header
   +-------------------------------------+
                    |
                    v
   +-------------------------------------+        +------------------------------+
   |  api  (NestJS, :4000/api)           |        |  PostgreSQL 16               |
   |  auth . fiat (quotes, transfers)    |------->|  journal_entries/lines:      |
   |  compliance . ops read models       |        |   append-only (triggers +    |
   |  sim: NIP inflow, providers, faults |        |   INSERT/SELECT grants),     |
   |  POST /transfers -> enqueue SCREEN  |        |   SHA-256 hash chain         |
   +-------------------------------------+        |  transfers, saga_steps,      |
                    |                             |  compliance_checks, ...      |
                    v                             +------------------------------+
   +-------------------------------------+                  ^
   |  Redis 7: BullMQ queues, nonce      |                  |
   |  counters, fault switches           |                  |
   +-------------------------------------+                  |
                    |                                       |
                    v                                       |
   +-----------------------------------------------------------------------+
   |  worker  (NestJS, BullMQ: one job per saga step)                      |
   |                                                                       |
   |  SCREEN -> RESERVE -> MATCH -> CHAIN_SEND -> CHAIN_CONFIRM -> PAYOUT -> FINALISE
   |    |         |          |          |             |            |          |
   |  gates    ledger     provider   Signer +      receipt +    provider   ledger +
   |  (decline  hold      scoring,   viem: token   USD entry    simulator  webhook
   |   / hold)  entry     capacity   transfer                  (payout)
   |                                                                       |
   |  hard failure -> compensation in reverse order -> REVERSED            |
   +-----------------------------------------------------------------------+
                    |                              |
                    v                              v
   +-------------------------------+   +-------------------------------+
   |  EVM test network (anvil,     |   |  Simulated provider payout    |
   |  chainId 31337, 2 s blocks)   |   |  (SimulatedAdapter; Bridge    |
   |  MockUSD ERC-20, 5 treasury   |   |   adapter is a stub)          |
   |  + 3 provider wallets         |   +-------------------------------+
   +-------------------------------+
```

## Quick start

### Option A: native (Postgres, Redis and Foundry installed on the host)

Prerequisites: Node 22, PostgreSQL 15 or 16, Redis, Foundry (`anvil`), and `npm ci` run once in `hsg-backend/` and `hsg-frontend/`. Copy `hsg-backend/.env.example` to `hsg-backend/.env`. On a new Postgres server, create the roles and databases once:

```bash
psql -d postgres -f docker/postgres-init.sql
```

Then:

```bash
./dev.sh --fresh     # clean database + fresh chain + token deploy + seed, then api, worker and web
./dev.sh             # later runs: just start api (:4000), worker and web (:3000)
```

`--fresh` drops and recreates the `hsg` database, flushes the Redis DB, restarts anvil on :8545, deploys the mock token, and seeds. It asks for confirmation first; pass `--yes` to skip the prompt. Ctrl-C stops api, worker and web. Anvil keeps running so the chain stays in step with the database. Logs are prefixed `api|`, `worker|` and `web|`, and anvil writes to `.devlogs/`. See `./dev.sh --help` for the overrides (`DB_NAME`, `ANVIL_PORT`, `API_PORT`, `WEB_PORT`, `REDIS_URL`, `--no-web`).

### Option B: Docker Compose

```bash
docker compose up --build              # first run: migrate, deploy token, seed, start everything
docker compose down -v && docker compose up --build    # clean-database run
```

Compose starts `postgres` (16), `redis` (7) and `anvil` (Foundry image). Next, a one-shot `migrate-seed` job runs `prisma migrate deploy`, then `chain:deploy` and `db:seed`, but those two only on the first run. Then `api`, `worker` and `web` start. The ports are the same: web :3000, api :4000, RPC :8545. The database, chain and Redis state live in named volumes, so `down -v` wipes them together. That keeps the ledger and the chain consistent.

## Logins

All accounts use the password `Passw0rd!`.

| Email | Role | Use |
|---|---|---|
| `funmi@adebayoimports.ng` | SME, Adebayo Imports Ltd (verified) | the demo account (balance 0 until funded) |
| `ops@hsg.test` | Operator | console at `/ops` |
| `admin@kanoagroexports.ng` | SME, Kano Agro Exports Ltd (KYB pending, clean) | TC01 |
| `info@obsidiancrest.ng` | SME, Obsidian Crest Holdings Ltd (KYB pending, watchlist match) | TC02 |
| `sme001@hsg.test` ... `sme100@hsg.test` | SMEs (verified, NGN 50,000,000.00 each) | load test, TC12 |

URLs: SME app at http://localhost:3000/login, operator console at http://localhost:3000/ops, API at http://localhost:4000/api.

## Tests

```bash
cd hsg-backend
npm run typecheck
npm test                         # Jest against hsg_test (ledger, compliance, settlement, fiat boundary, saga)
npm test -- test/ledger.spec.ts  # one suite
npx ts-node scripts/tamper-demo.ts     # TC11: trigger rejects UPDATE; superuser tamper -> verifyChain broken_at (on hsg_test)
npx ts-node scripts/chain-smoke.ts     # send + confirm through SettlementService

cd ../hsg-frontend
npx tsc --noEmit && npm run lint
```

The settlement suite needs anvil on :8545 and `chain.local.json`. CI (`.github/workflows/ci.yml`) runs the same steps on every push: Postgres 16 and Redis 7 services, roles from `docker/postgres-init.sql`, `migrate deploy`, anvil through `foundry-toolchain`, `chain:deploy`, typecheck and Jest for the backend, and typecheck, lint and build for the frontend.

## Load test (500 transfers)

With the stack running:

```bash
cd hsg-backend
npm run load -- --transfers 500 --rate 10 --api http://localhost:4000/api            # clean run
npm run load -- --transfers 500 --rate 10 --api http://localhost:4000/api --faults   # payout hard fail for 45-55% of submissions
# intake-only equivalent with k6:
k6 run -e API=http://localhost:4000/api -e TRANSFERS=500 -e RATE=10 load/k6-transfers.js
```

The load script spreads transfers round-robin across `sme001` to `sme100`, so the velocity gate does not fire. It then polls until every transfer is COMPLETED, REVERSED or DECLINED.

## Evidence

| What | Where |
|---|---|
| Per-transfer timings CSV and run summary | `hsg-backend/load/results/run-<ts>.csv`, `summary-<ts>.json` (commit unedited) |
| k6 summary | redirect `k6 run ... > hsg-backend/load/results/k6-<ts>.txt` |
| Jest output for the ledger and saga suites | `npm test 2>&1 \| tee hsg-backend/load/results/jest-<ts>.txt` |
| Screenshots (S2, S4, S5, each O2 tab, O4, O5) | `docs/evidence/` (one file per test case, named `TCxx-*.png`) |
| Per-test-case triggers and expected results | `docs/DEMO-RUNBOOK.md` |

## Limitations (stated honestly)

- **Local test network by default.** The chain leg runs on a local anvil node (chainId 31337, 2 s blocks), not a public testnet. Switching to Base Sepolia only takes `RPC_URL`, `CHAIN_ID` and funded keys in the chain config, but that path was not exercised in the evaluation runs. There is no block explorer, so `EXPLORER_TX_URL` is empty and hashes are shown without links.
- **Local key signer, not KMS.** Signing goes through a `Signer` interface. Only `LocalSigner` is implemented, with keys from anvil's public test mnemonic held in `chain.local.json`. `KmsSigner` only documents the AWS KMS design and throws if used.
- **Simulated bank and providers.** NIP inflows, the three liquidity providers and their payouts are simulators inside the app. No bank, NIBSS or real provider is connected. Payout delays and failure rates are configured values.
- **Bridge adapter is a stub.** `PayoutPartner` has a `SimulatedAdapter` (used everywhere) and a `BridgeAdapter` stub. The Bridge sandbox was not called, and the PRD's open questions about it remain open.
- **Mock token.** The token is `MockUSD` (6 decimals, mintable), deployed by the build. It is not USDC.
- **Illustrative rules.** The compliance thresholds (USD 10,000, 5 transfers in 10 minutes), the fee and the quote margin are config constants. They are not regulatory values. The watchlist is 20 fictional names.
- **Security not assessed.** OWASP ASVS Level 2 was not assessed. A manual checklist pass is future work. Secrets in `.env.example` and `docker-compose.yml` are for development only.
- **Single corridor.** The slice covers NGN to USD only. Multi-currency revaluation, statements and self-service onboarding are out of scope.
