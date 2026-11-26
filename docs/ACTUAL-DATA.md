# Actual build data (source of truth for Chapters 4 and 5)

Everything below was measured or observed on the running build on 25–26 Nov 2026. Do not round further or "improve" numbers.

## Development environment (Table 4.1)
| Item | Specification |
|---|---|
| Development machine | Apple M4, 16 GB RAM, macOS 26.5.2 |
| Runtime | Node.js 22.17.1 LTS, TypeScript 5.9.3 |
| Framework and data access | NestJS 11.2.12, Prisma 6.19.3 |
| Database | PostgreSQL 15.13 locally (Homebrew); PostgreSQL 16 in Docker Compose and CI; Railway-managed PostgreSQL for the hosted deployment |
| Queue and cache | Redis 8.8.0 with BullMQ 5.81.6 (ioredis 5.11.1) |
| Blockchain | Local EVM test chain: Anvil 1.5.1 (Foundry), chain id 31337, 2-second blocks; viem 2.58.6; MockUSD, a 6-decimal mintable ERC-20 deployed by the project as the USDC-equivalent test token. Base Sepolia (chain id 84532) deployment path built; evaluation numbers below are from Anvil. |
| Key management | Local-key `Signer` adapter (test-wallet keys from a config file / environment variable). AWS KMS adapter not implemented. |
| Web client | Next.js 15.5.29 (React 19.1.0, Tailwind CSS 4.3.5) |
| Testing and load | Jest 30.5.2 (65 tests in 6 suites, all passing); load test by a Node.js/TypeScript script (`load/run.ts`); an equivalent k6 1.3.0 script exists but was not used for the reported run |
| Containers, CI, hosting | Docker Compose, GitHub Actions workflow (written, not yet run on GitHub), hosted on Railway (API, worker, web, PostgreSQL, Redis) |

## What was built
- Two-role web app (SME and Operator). SME: sign in, self-service registration, dashboard, add funds, beneficiaries, send payment (quote → confirm), transfers list and detail. Operator: overview, transfers with five-tab detail (saga steps, compliance checks, journal entries, chain transaction, payout order), review queue (held transfers + KYB), ledger (trial balance, hash-chain verification, reconciliation; tabs for treasury wallets, balances, paginated journal), simulator (NIP inflow, provider table, fault switches, webhook log).
- Backend modules: auth, fiat, ledger, compliance, settlement, liquidity, saga, sim, ops (NestJS, `src/modules/*`). Separate worker process for the saga.
- Ledger: double-entry, append-only (database triggers reject UPDATE/DELETE/TRUNCATE; the runtime database role has only SELECT/INSERT on journal tables), hash-chained (SHA-256 of previous hash + canonical entry), gapless sequence, idempotent by reference, per-currency trial balance, chain verification.
- Saga: 7 steps (SCREEN, RESERVE, MATCH, CHAIN_SEND, CHAIN_CONFIRM, PAYOUT, FINALISE), one BullMQ job per step, 5 attempts with exponential backoff, compensation in reverse order (including an on-chain return transaction when payout fails after the chain leg). One queue per treasury wallet with concurrency 1 and Redis nonce counters; transaction hash saved before broadcast so a retry never broadcasts twice.
- Compliance gates in order: KYB, sanctions (20 fictional watchlist names; exact or token-set match), Travel Rule fields, threshold (above USD 10,000 → held), velocity (more than 5 transfers in 10 minutes → held).
- Business rules: quote validity 60 seconds; flat fee NGN 7,500.00; 0.5% margin over the best provider rate (example quote: USD 1,000.00 at 1,576.85 = NGN 1,576,850.00 + fee = NGN 1,584,350.00 debited).
- SME screens never show wallet, hash, token, gas or provider; enforced by an automated "fiat boundary" test.
- Seed data: 1 operator, 103 SMEs (1 demo SME, 100 load-test SMEs, 2 KYB-pending, one of which matches the watchlist), 3 simulated providers, 5 treasury wallets (USD 200,000.00 of test tokens each = USD 1,000,000.00) and 3 provider wallets.

## Liquidity providers (state as a LIMITATION)
The three liquidity providers are simulated, not real counterparties: "Atlas FX" (rate 1,572.50 NGN/USD, capacity USD 250,000, reliability 0.99), "Meridian Liquidity" (1,569.00, USD 100,000, 0.95), "Harbor OTC" (1,575.25, USD 500,000, 0.999), each with a 3-second simulated payout delay. Rates, capacity and reliability are seeded values, not market data. Provider selection uses a weighted score (rate 0.5, reliability 0.3, headroom 0.2). Payouts are simulated (success after the delay, failure driven by reliability or by fault switches). A Bridge.xyz adapter exists behind the same `PayoutPartner` interface but is a stub: Bridge sandbox access requires a developer account requested from Bridge, sandbox simulates blockchain deposits rather than watching a testnet, transfers require a Bridge-verified customer (`on_behalf_of`), and fixed-output USDC→USD is not among Bridge's documented fixed-output pairs. Consequences: no real FX price discovery, no real settlement risk, no real provider latency or failure behaviour, and the evaluated latency reflects configured delays.

## Other limitations (truthful)
- Bank side (NIP inflows, virtual accounts) is simulated; no NIBSS or bank integration.
- Evaluation ran on a local Anvil chain, not a public testnet; block time 2 s; test gas has no real price.
- Key custody uses local keys, not AWS KMS.
- One corridor (NGN → USD) only, although the landing page lists other currencies.
- OWASP ASVS Level 2 not assessed.
- Load generated from the same machine that hosted the system.
- Self-service registration was added beyond the approved scope (KYB still requires operator approval).

## Evaluation results (500-transfer run, 25 Nov 2026, local machine, Anvil)
Faults (payout hard fail) switched on for transfers #225–#275 (middle 10%).
| Metric | Result | Target |
|---|---|---|
| Submitted / accepted | 500 / 500 | — |
| Intake rate | 10 transfers/second (500 accepted in 49.9 s) | ≥ 10 TPS — met |
| Intake latency p50 / p95 / max | 14 ms / 32 ms / 193 ms | — |
| Completed | 475 | — |
| Reversed | 25 (all inside the fault window; naira returned in full) | — |
| Not resolved | 0 (100% resolved) | 100% — met |
| Completions per second | 5.06 | bounded by 2 s block time |
| Settlement time p50 / p95 / max | 33.6 s / 46.8 s / 50.8 s | p95 ≤ 15 min — met |
| Ledger after run | 2,116 journal entries, hash chain verified, trial balance NGN 0 / USD 0 | — |
| Reconciliation | ledger 1100 = on-chain treasury balance, variance USD 0.00 | — |
Raw files: `hsg-backend/load/results/run-2026-11-25T22-01-18-759Z.csv`, `summary-2026-11-25T22-01-18-759Z.json`.

Single-transfer observations: happy path completed in about 12 s; on-chain confirmation about 1.8 s; gas 51,508 for a token send and 29,608 for a return transfer.

## Acceptance tests (TC01–TC14) status
Executed end to end on the running system: TC03 NIP inflow, TC04 quote then transfer, TC06 beneficiary fails screening (declined at SCREEN, no chain transaction), TC07 happy path (completed; webhook logged; reconciliation variance 0), TC08 provider out of capacity (reversed, funds released), TC10 duplicate submission (identical response, one transfer), TC14 payout fails after chain leg (return transaction confirmed, reversing entries, balance restored).
Executed in development/integration tests: TC01/TC02 KYB approval (clean → VERIFIED; watchlist match → REJECTED), TC09 chain delay keeps confirmation pending (unit test), TC11 tamper (trigger rejects UPDATE; superuser alteration makes verifyChain return broken_at), TC12 velocity (unit test), TC13 reconciliation variance (unit test).
Executed end to end on 26 Nov 2026 (script `hsg-backend/scripts/acceptance-tc05-08-09.sh`, evidence in `docs/evidence/`):
- TC05 expired quote: confirming 62 s after the quote returned `QUOTE_EXPIRED` ("This quote has expired. Get a new quote to continue."); no transfer and no journal entry were created for it.
- TC08 run 1: with the normally chosen provider (Meridian Liquidity) set to zero capacity, the transfer COMPLETED and was routed to Atlas FX.
- TC08 run 2: with all three providers at zero capacity, the transfer was REVERSED; the SME saw "Reversed" with NGN 1,595,400.00 returned and an unchanged available balance.
- TC09 chain congestion: with a 120 s chain delay, CHAIN_CONFIRM polled 25 times (every 5 s) without re-broadcasting; exactly one chain transaction; the transfer COMPLETED 126 s after submission.
Not yet captured as screenshots on the final build: TC11, TC12, TC13 (covered by automated tests).

## Build process (facts only)
- The approved two build cycles collapsed into a compressed schedule: the vertical slice was built and integrated on 25–26 Nov 2026.
- Commit history in the private repository records the sequence (foundation → ledger → fiat/compliance → settlement → saga → ops/load → web → deployment).
- [STUDENT TO COMPLETE: describe tools and assistance used during the build, as your institution's academic-integrity / AI-use policy requires.]
