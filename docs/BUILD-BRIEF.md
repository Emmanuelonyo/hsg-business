# Build-night brief: read this first (every agent)

We are building the Hybrid Settlement Gateway tonight for a project defence tomorrow. Product spec: `docs/Hybrid Settlement Gateway — One-Day Build PRD.md` (read the sections relevant to you; "Rules the build must hold" is the part the panel will probe). API shapes: `docs/API-CONTRACT.md` (source of truth: if it disagrees with the PRD, follow the contract). Frontend design: `docs/design/project/*.dc.html` (HTML mockups with inline styles; `Main.dc.html` is the visual system).

Several agents work **in parallel in the same tree**. Collisions are the main risk. Follow these rules exactly.

## Layout
```
HSG-Business/
  docs/                      PRD, API contract, design mockups, this brief
  hsg-backend/               NestJS API + BullMQ worker + Prisma + contracts + load test
    prisma/schema.prisma     FROZEN (foundation). Do not edit. Need a change? Say so in your final report.
    src/common/*             FROZEN shared utils: config (CONFIG, ENV), accounts (ACCT), ids (newId), money, errors (ApiError, DomainError), json (canonicalJson), prisma/redis/faults/audit services, saga-queue (SagaQueue, SAGA_STEPS, chainQueueName), status-map (toSmeStatus)
    src/modules/auth/auth.guard.ts   FROZEN: global AuthGuard, @Roles('SME'|'OPERATOR'), @Public(), @CurrentUser()
    src/*/**.module.ts       Module wiring exists already. You may edit ONLY the module file(s) of modules you own (to add providers/controllers).
    src/app.module.ts, src/worker.module.ts, src/main.ts   FROZEN
  hsg-frontend/              Next.js 15 (app router) + Tailwind v4
    app/globals.css          FROZEN design tokens (bg-teal, text-lime, bg-ground, border-line, bg-amber-bg, text-critical, font-mono …)
    lib/api.ts, lib/money.ts, lib/types.ts, components/ui/*   FROZEN shared (you may ADD new files in components/ui, never edit existing ones)
```

## Ownership (edit only what you own)
| Agent | Owns |
|---|---|
| A Ledger | `src/modules/ledger/**`, `prisma/migrations/*_ledger_guards/` (new raw SQL migration), `test/ledger*.spec.ts`, `scripts/tamper-*.ts` |
| B Fiat+Compliance | `src/modules/auth/auth.controller.ts`, `src/modules/auth/auth.service.ts`, `src/modules/fiat/**`, `src/modules/compliance/**`, `src/modules/sim/nip.controller.ts`, `src/modules/sim/webhook*.ts`, `test/fiat*.spec.ts`, `test/compliance*.spec.ts` |
| C Chain | `contracts/**`, `src/modules/settlement/**`, `scripts/chain-*.ts`, `test/settlement*.spec.ts`, produces `hsg-backend/chain.local.json` |
| D Saga+Liquidity | `src/modules/saga/**`, `src/modules/liquidity/**`, `src/modules/sim/providers.controller.ts`, `test/saga*.spec.ts`, `test/liquidity*.spec.ts` |
| E Ops+Seed+Load | `src/modules/ops/**`, `prisma/seed.ts`, `load/**` |
| F SME web | `hsg-frontend/app/login/**`, `hsg-frontend/app/(sme)/**`, `hsg-frontend/app/page.tsx`, `hsg-frontend/components/sme/**` |
| G Ops web | `hsg-frontend/app/(ops)/**`, `hsg-frontend/components/ops/**` |
| H DevOps | `docker-compose.yml`, `hsg-backend/Dockerfile`, `hsg-frontend/Dockerfile`, `dev.sh`, `.github/**`, `README.md`, `docs/DEMO-RUNBOOK.md` (all at repo root unless noted) |

## Cross-module contracts (already stubbed, signatures FIXED)
- `LedgerService`, `PostingsService` (`src/modules/ledger/`) — implemented by A, called by B/D/E.
- `ComplianceService.screenName/runTransferGates` (`src/modules/compliance/compliance.service.ts`) — B; called by D's SCREEN step.
- `SettlementService` (`src/modules/settlement/settlement.service.ts`) + `Signer` (`signer.ts`) — C; called by D.
- `LiquidityService` + `PayoutPartner` (`src/modules/liquidity/`) — D; `bestRate` called by B's quotes.
- `WebhookService.notifyTransfer` (`src/modules/sim/webhook.service.ts`) — B; called by D's FINALISE / reversal.
- `SagaQueue.enqueueStep(transferId, step)` (`src/common/saga-queue.ts`) — the only way to start/resume a saga. Saga runner provider must be registered under token `'SagaRunner'` with `start()`/`stop()` (worker.ts resolves it).
You may add methods to the services you own; never change an existing signature. If you depend on a service that is still a stub, code against its signature and test with a hand-written fake.

## Money & state rules
- bigint minor units everywhere (NGN kobo, USD cents). Token units = cents × 10,000 (6 decimals). Strings on the wire. `installBigIntJson()` is called at boot so bigint serialises as string.
- Transfer states: CREATED → SCREENING → (HELD) → RESERVED → ONCHAIN_PENDING → ONCHAIN_CONFIRMED → PAYOUT_PENDING → COMPLETED; failure path REVERSING → REVERSED; compliance fail → DECLINED. Set the matching `*_at` timestamp on every transition.
- Ledger references: `{transferId}:{EVENT}` (EVENT ∈ RESERVE, RELEASE, CHAIN_CONFIRMED, CHAIN_RETURNED, PAYOUT_NGN, PAYOUT_USD), `inflow:{sessionId}`, `treasury:{label}`.

## Shared local services (already running; do not stop or restart them)
- Postgres 15 on :5432. Dev DB `hsg`, test DB `hsg_test`. Runtime role `hsg_app/hsg_app`, owner role `hsg_owner/hsg_owner` (superuser; migrations). Base schema already migrated in both. `psql` binary: `/opt/homebrew/opt/postgresql@15/bin/psql`.
- Redis on :6379. **Use your own Redis DB index** for experiments so queues/faults don't collide: A=2, B=3, C=4, D=5, E=6 (e.g. `REDIS_URL=redis://localhost:6379/5`). Jest uses DB 1.
- Anvil (local EVM, chainId 31337, 2 s blocks) on :8545, mnemonic `test test test test test test test test test test test junk`. Account index → role: 0 deployer, 1–5 treasury wallets, 6–8 provider wallets (one per seeded provider).
- If you start the API to test, use your own port: A 4101, B 4102, C 4103, D 4104, E 4105 (`API_PORT=...`). Kill it when done. Never use 4000/3000 (reserved for integration).
- `hsg-backend/.env` has all connection strings.

## chain.local.json (written by C's `npm run chain:deploy`, read by settlement, seed and scripts)
```json
{ "rpcUrl":"http://127.0.0.1:8545", "chainId":31337,
  "token":{"address":"0x…","decimals":6,"symbol":"mUSD"},
  "deployer":{"address":"0x…","privateKey":"0x…"},
  "treasury":[{"label":"treasury-1","address":"0x…","privateKey":"0x…"} /* ×5 */],
  "providers":[{"label":"provider-1","address":"0x…","privateKey":"0x…"} /* ×3 */] }
```
Each treasury wallet is minted USD 200,000.00 of mock tokens. Seed (E) creates `wallets` rows (TREASURY keyIndex 1–5, PROVIDER keyIndex 6–8), sets `liquidity_providers.wallet_address`, and posts `PostingsService.treasuryFunding(label, cents)` per treasury wallet so ledger 1100 == on-chain.

## Startup order (H scripts this)
`prisma migrate reset/deploy` (includes A's guards migration) → anvil → `npm run chain:deploy` → `npm run db:seed` → api (`npm run dev:api`) + worker (`npm run dev:worker`) + web (`npm run dev` in hsg-frontend).

## Working rules
- **Never run `npm install`** (deps are installed; concurrent installs corrupt node_modules). If a package is truly missing, write it in your final report and work around it.
- Never run `prisma migrate dev/reset` on `hsg` except agent A applying its own migration (A: apply it to both `hsg` and `hsg_test`). Never `prisma generate` with a modified schema.
- Typecheck with `cd hsg-backend && npx tsc --noEmit -p tsconfig.json`. Others are mid-edit: **only fix errors in files you own**; ignore theirs.
- Frontend: do NOT run `next dev`/`next build` (two agents share `.next`). Verify with `cd hsg-frontend && npx tsc --noEmit`.
- No git commits (the user signs commits themselves).
- Code clarity matters: the student must explain `postEntry` and the saga processors line by line to a panel. Prefer plain, commented, linear code over clever abstractions.
- SME-facing copy: banking vocabulary only — never wallet, token, chain, hash, gas, provider, Bridge, USDC, crypto.
- Final report (your last message): what you built (files), what you verified and how (commands + results), anything stubbed/unfinished, any request for a frozen-file change. Keep it under 300 words.
