# Hybrid Settlement Gateway — One-Day Build PRD

Nov 23, 2026 · @Emmanuel Onyo

## What we are building today

A working vertical slice of the gateway: an SME funds a naira virtual account, pays a foreign beneficiary, and gets a fiat confirmation, while a ledger hold, a testnet stablecoin transfer and a simulated provider payout settle it underneath. One corridor (NGN to USD), one web app with two roles, and every external party simulated except the blockchain test network.

**The demo story** is the acceptance test for the whole build:

1. The SME signs in and sees a naira balance and a virtual account number.
2. The operator simulates an NIP inflow of NGN 5,000,000; the SME balance updates.
3. The SME adds a beneficiary, requests a quote for USD 1,000, and confirms within the quote window.
4. The transfer moves through its states on screen and ends Completed, with no address, hash, token or gas fee visible to the SME.
5. The operator opens the same transfer and shows the compliance checks, the journal entries, the testnet transaction hash and the provider payout.
6. The operator switches on a fault (provider out of capacity), the SME sends again, and the transfer ends Reversed with the naira back in the balance.
7. The operator opens the ledger page: trial balance is zero and the hash chain verifies.

**Done tonight** means steps 1 to 7 run end to end on your machine from a clean database with one command, and a script can push 500 transfers through the same path.

## Scope

Everything the proposal's five modules promise is present, but each is built at its thinnest honest version. The blockchain leg is real (test network); every bank, provider and identity service is a simulator you own.

| Area | Built today | How | Left out |
| --- | --- | --- | --- |
| Fiat interface | Virtual account per SME, simulated NIP inflow, FX quote with expiry, transfer creation, status webhook | Simulator endpoints inside the same app | Real bank or NIBSS integration, cards, inbound payments |
| Ledger core | Double-entry journal, append-only, hash-chained, trial balance, chain verification | PostgreSQL tables plus triggers that reject UPDATE and DELETE | Multi-currency revaluation, statements, interest |
| Compliance | KYB status on the SME, sanctions screening of beneficiaries, Travel Rule fields on every transfer, velocity and threshold rules, review queue | Rule functions plus a seeded watchlist table | Real KYC vendor, document upload, case management |
| Settlement engine | Signs and broadcasts a test-token transfer, waits for confirmation, stores the hash | viem against an EVM test network, a mock ERC-20 you deploy | Mainnet, real stablecoins, HD wallet derivation per customer |
| Liquidity | Three seeded providers, best-provider selection by rate, capacity and reliability, simulated payout | Scoring function plus a simulator with configurable failure | Real providers, treasury, rebalancing |
| Orchestration | Saga with ordered steps, retries, idempotency keys and compensating reversal | BullMQ on Redis, one job per step | Distributed tracing, multi-region |
| Interface | SME app (5 screens) and operator console (5 screens) in one web app | Next.js, role switch at login | Mobile app, public marketing site, self-service onboarding |
| Evaluation | Load script for 500 transfers, fault switches, CSV export of timings | k6 or a Node script hitting the API | Automated OWASP scan (do the ASVS checklist by hand later) |

**Two choices to make before you start, because Chapter 4 must report them truthfully:**

- **Key custody.** The proposal names AWS KMS. Put signing behind a `Signer` interface with a local-key adapter first. Add the KMS adapter only if you have an AWS account ready; otherwise record local signing as a limitation.
- **Test token.** Deploy your own mock ERC-20 (6 decimals, mintable) rather than depending on a faucet. A 500-transfer run will exhaust any public faucet allowance.

## Settlement partner: Bridge

The payout leg runs on Bridge's transfer API in sandbox, which opens six payout currencies instead of one. The simulated providers stay in the build as fallbacks for the fault tests (TC08, TC14).

| Currency | Payout rail per Bridge docs | Example beneficiary in the prototype |
| --- | --- | --- |
| USD | ACH, Wire | Shenzhen Ruiqi Machinery Co. (see open question 3) |
| EUR | SEPA | Rotterdam Agri Supplies B.V. |
| GBP | Faster Payments | Midlands Tooling Ltd |
| MXN | SPEI | Aceros del Norte S.A. de C.V. |
| BRL | Pix | Café Serra Verde Ltda |
| COP | Bre-B and Bank Transfer | none yet (shows the empty state) |

Source stablecoins include USDC on Base, among many chain and token pairs listed on the same page. One restriction applies: for users in the EEA, Bridge supports only USDC and EURC ([Bridge, payment routes](https://apidocs.bridge.xyz/get-started/introduction/what-we-support/payment-routes)).

**How it plugs into the saga**

1. **MATCH** creates a Bridge transfer: `POST /v0/transfers` with `on_behalf_of`, `source {payment_rail: "base", currency: "usdc", from_address}` and `destination {payment_rail, currency, external_account_id, amount}`. The gateway's transfer id goes in the `Idempotency-Key` header ([Bridge, stablecoin to fiat](https://apidocs.bridge.xyz/docs/stablecoin-to-fiat-crypto-off-ramp)).
2. Setting `destination.amount` makes it a **fixed output**: Bridge works out the USDC needed, so the beneficiary receives exactly the quoted amount ([Bridge, fixed outputs](https://apidocs.bridge.xyz/get-started/guides/move-money/fixed_outputs_integration_guide)).
3. **CHAIN\_SEND** pays the `source_deposit_instructions.to_address` returned by step 1.
4. **PAYOUT** waits on `GET /v0/transfers/{id}` or webhooks, through `awaiting_funds`, `payment_submitted` and `payment_processed` ([Bridge, offramp guide](https://apidocs.bridge.xyz/get-started/guides/wallets/offramp)).
5. **Quotes** take a reference rate from `GET /v0/exchange_rates`. The guide warns that if the rate moves past the buffer, the transfer goes `underfunded` and needs topping up, so the 60-second NGN quote must carry a margin.

**Build changes**

- The liquidity module becomes a `PayoutPartner` interface with a `BridgeAdapter` and a `SimulatedAdapter`.
- Beneficiaries become Bridge external accounts, with fields that depend on the rail: IBAN, sort code, CLABE, Pix key.
- Quotes and the threshold rule work per currency, with the USD 10,000 review threshold applied to the USD equivalent.
- The SME never sees Bridge's name. It appears only in the operator console and the documentation.

**Open questions to settle before building against it**

1. **Sandbox access.** The pages read here did not state a sandbox base URL or how sandbox treats deposits. Confirm both in the Bridge dashboard, and check whether a deposit from a public test network is accepted or simulated.
2. **Who the customer is.** `on_behalf_of` is a Bridge customer that Bridge itself verifies. Confirm whether Bridge onboards Nigerian businesses. If it does not, the gateway becomes the customer and pays third parties, which is a different compliance model to describe in Chapter 3.
3. **USD wire reach.** The docs list USD wire but these pages do not say whether it reaches non-US banks. If it is domestic only, the China supplier examples cannot be paid, and the Nigerian importer corridor the proposal is built on would not be served.
4. **No naira rail.** Bridge lists no NGN route, so the naira side stays on NIP with the gateway's own stablecoin liquidity, as already designed.
5. **Scope.** The approved proposal names a single NGN to USD corridor and simulated providers. Moving to a real partner and six currencies changes Chapter 1 scope, Chapter 3 design and the evaluation, so it needs your supervisor's sign-off.

**Reference entries (APA)**

- Bridge. (2026). *Payment routes*. Bridge API documentation. https://apidocs.bridge.xyz/get-started/introduction/what-we-support/payment-routes
- Bridge. (2026). *Stablecoin to fiat (crypto off-ramp)*. Bridge API documentation. https://apidocs.bridge.xyz/docs/stablecoin-to-fiat-crypto-off-ramp
- Bridge. (2026). *Fixed outputs integration guide*. Bridge API documentation. https://apidocs.bridge.xyz/get-started/guides/move-money/fixed\_outputs\_integration\_guide
- Bridge. (2026). *Offramp*. Bridge API documentation. https://apidocs.bridge.xyz/get-started/guides/wallets/offramp

## Users and the core flow

Two roles share one web app. The SME user never sees anything below the fiat line; the operator sees everything.

| Role | Who it is | Can do | Must never see |
| --- | --- | --- | --- |
| SME user | Finance officer at an importing business | View balance and virtual account, add beneficiaries, get a quote, send a transfer, track status | Wallet addresses, transaction hashes, token names, gas, provider names |
| Operator | Gateway staff (compliance and operations) | Simulate inflows, review held transfers, inspect ledger, chain and payout records, toggle faults | Nothing is hidden |

&#91;embedded content: transfer state machine · 10 states, 3 terminal\]

The saga drives a transfer left to right. A sanctions hit declines it before any money moves, a rule breach parks it for the operator, and any failure after the ledger hold runs compensation until the naira is back.

The SME sees four words only, mapped from the internal state:

| Internal state | SME sees |
| --- | --- |
| CREATED, SCREENING, RESERVED, ONCHAIN\_PENDING, ONCHAIN\_CONFIRMED, PAYOUT\_PENDING, REVERSING | Processing |
| HELD | Under review |
| COMPLETED | Completed |
| REVERSED | Reversed (funds returned) |
| DECLINED | Declined |

## Screens

Ten screens, five per role, one shared layout: left navigation, page title, content. Design the five SME screens first; they are what the panel sees as the product. The operator console can be plain tables.

**Design rules for the SME side**

- Banking vocabulary only: account, balance, beneficiary, rate, fee, transfer, reference. No crypto terms anywhere in copy, tooltips or URLs.
- Amounts are right-aligned, currency code before the figure, two decimals. Naira and dollar amounts never share a line without their codes.
- Every transfer shows one status chip from the four SME words, coloured: Processing (neutral), Under review (amber), Completed (green), Reversed and Declined (red outline).
- Every screen needs its empty, loading and error state. Listed per screen below.

### SME app

| # | Screen | Route | Shows | Actions | States to design |
| --- | --- | --- | --- | --- | --- |
| S1 | Sign in | /login | Email, password, role is inferred from the account | Sign in | Wrong credentials; account not yet verified (KYB pending) |
| S2 | Dashboard | /app | Available balance and held balance in NGN; virtual account number with bank name and copy button; last 5 transfers | Send payment; copy account number | No funds yet (prompt to fund the virtual account); no transfers yet |
| S3 | Beneficiaries | /app/beneficiaries | Table: name, country, bank, account number (masked), screening status | Add beneficiary (name, country, bank name, account number or IBAN, SWIFT/BIC, address) | Empty list; beneficiary blocked by screening (cannot be selected for payment) |
| S4 | Send payment | /app/send | Step 1: pick beneficiary, enter USD amount, purpose of payment. Step 2: quote card with rate, fee, total NGN debit, countdown to expiry. Step 3: confirm | Get quote; refresh quote; confirm | Insufficient balance; quote expired (button swaps to Refresh quote); beneficiary not cleared; submit in flight (button disabled) |
| S5 | Transfer detail | /app/transfers/:id | Reference, beneficiary, USD amount, NGN debited, rate, fee, status chip, timeline of 4 steps (Received, Checks passed, Sent, Delivered) with timestamps | Download receipt (print view is enough) | Processing (polls every 3 s); Under review; Reversed (shows NGN returned and a plain reason); Declined |

The transfers list reuses the dashboard table at /app/transfers with a status filter; it does not need its own design.

### Operator console

| # | Screen | Route | Shows | Actions |
| --- | --- | --- | --- | --- |
| O1 | Overview | /ops | Counts by state today, p95 settlement time, total reversed, treasury wallet token balance against ledger account 1100 | None |
| O2 | Transfers | /ops/transfers and /ops/transfers/:id | Table of all transfers with internal state. Detail has five tabs: Saga steps (step, attempt, started, ended, outcome), Compliance checks, Journal entries, Chain transaction (hash linking to the block explorer, block, confirmations), Payout order (provider, rate, state) | Retry a stuck step |
| O3 | Review queue | /ops/review | Held transfers with the rule that fired and the Travel Rule data; a second tab lists SMEs with KYB pending | Approve; reject with reason |
| O4 | Ledger | /ops/ledger | Account balances, trial balance total, hash chain status, last 50 journal entries with debit and credit lines | Verify chain; run reconciliation |
| O5 | Simulator | /ops/simulator | Fund form (SME, amount); provider table (rate, capacity, reliability); fault switches | Simulate NIP inflow; edit provider capacity; toggle faults: provider out of capacity, payout hard fail, chain delay of N seconds |

O4 and O5 are the two screens the defence demo depends on. Build them before O1.

## API

Twenty-two endpoints, JSON over REST, all under `/api`. Session cookie or bearer JWT; the role in the token decides which group is reachable. Money travels as strings in minor units (`"500000000"` kobo), never floats.

### SME endpoints

| Method and path | Purpose | Notes |
| --- | --- | --- |
| POST /auth/login | Sign in | Returns token and role |
| GET /me | SME profile, KYB status, virtual account |  |
| GET /balance | Available and held NGN | Derived from the ledger, never stored |
| GET /beneficiaries | List |  |
| POST /beneficiaries | Create and screen | Screening runs synchronously; response carries `screening_status` |
| POST /quotes | Quote for a USD amount | Returns `rate`, `fee`, `total_ngn`, `expires_at` (60 s) |
| POST /transfers | Create a transfer from a quote | Requires `Idempotency-Key` header; returns 202 with the transfer |
| GET /transfers | List, filter by status | SME status words only |
| GET /transfers/:id | Detail with timeline | No chain or provider fields in this response shape |

### Operator endpoints

| Method and path | Purpose |
| --- | --- |
| GET /ops/overview | Counts by state, p95 latency, on-chain reserve against ledger |
| GET /ops/transfers and /ops/transfers/:id | Full internal view: saga steps, checks, journal entries, chain transaction, payout order |
| POST /ops/transfers/:id/retry | Re-enqueue the current saga step |
| GET /ops/review and POST /ops/review/:id/decision | Review queue for held transfers and pending KYB; body `{decision: "approve" or "reject", reason}` |
| GET /ops/ledger | Account balances, trial balance, recent entries |
| POST /ops/ledger/verify | Recompute the hash chain; returns `{ok, broken_at}` |
| POST /ops/reconcile | Compare ledger account 1100 with the treasury wallets' on-chain token balance; returns variance |
| POST /sim/nip-inflow | Credit a virtual account `{account_number, amount, sender_name, session_id}` |
| GET and PUT /sim/providers, PUT /sim/faults | Edit provider capacity and reliability; set fault switches |

### The two shapes that matter

```json
POST /api/transfers
Idempotency-Key: 6f1c0c1e-...
{
  "quote_id": "qt_01J...",
  "beneficiary_id": "bn_01J...",
  "purpose": "Payment for goods, invoice INV-2291"
}

202 Accepted
{
  "id": "tr_01J...",
  "reference": "HSG-20261123-000142",
  "status": "Processing",
  "usd_amount": "100000",
  "ngn_debited": "158750000",
  "rate": "1580.00",
  "fee_ngn": "750000",
  "created_at": "2026-11-23T09:14:02Z"
}
```

Errors use one envelope: `{"error": {"code": "QUOTE_EXPIRED", "message": "..."}}`. Codes to implement: `QUOTE_EXPIRED`, `INSUFFICIENT_FUNDS`, `BENEFICIARY_NOT_CLEARED`, `KYB_NOT_VERIFIED`, `IDEMPOTENCY_CONFLICT`, `NOT_FOUND`, `FORBIDDEN`.

The outbound status webhook is one POST to a URL stored on the SME record, body `{event: "transfer.completed" or "transfer.reversed", transfer}`, signed with an HMAC header. For the demo, point it at a request-bin page or a `/sim/webhook-sink` route that logs to the operator console.

## Data model

Keep the 14 tables from your Figure 3.4 ERD and add four. The additions exist because the ERD describes the domain and the build also needs to run a saga and a login.

| Table | Status | Columns to add beyond the ERD |
| --- | --- | --- |
| sme\_accounts, virtual\_accounts, beneficiaries, quotes, wallets | As drawn | `quotes.sme_id`, `quotes.usd_amount`, `quotes.fee_ngn`; beneficiary bank fields and address |
| transfers | As drawn | `reference`, `purpose`, `travel_rule` (JSON: originator and beneficiary name, account, address), `idempotency_key`, `failure_reason`, one timestamp per state |
| journal\_entries, journal\_lines, ledger\_accounts | As drawn | `journal_entries.seq` (gapless), `transfer_id`, `created_at`; `journal_lines.currency`; `ledger_accounts.owner_sme_id` (null for house accounts) |
| compliance\_checks, audit\_log | As drawn | `compliance_checks.detail` (rule name, matched entry), `created_at` |
| chain\_transactions, payout\_orders, liquidity\_providers | As drawn | `chain_transactions.block_number`, `confirmed_at`; `liquidity_providers.rate`, `wallet_address` |
| users | New | email, password\_hash, role (SME or OPERATOR), sme\_id |
| saga\_steps | New | transfer\_id, step, attempt, status, started\_at, ended\_at, error |
| watchlist | New | name, country; seed about 20 invented entries for screening |
| ledger\_head | New | single row: last\_seq, last\_hash; locked for every append |

### Chart of accounts

| Code | Account | Type | Currency |
| --- | --- | --- | --- |
| 1000 | Settlement bank | Asset | NGN |
| 1100 | Stablecoin reserve (treasury wallet) | Asset | USD |
| 1200 | Provider receivable | Asset | USD |
| 2000-{sme} | SME available | Liability | NGN |
| 2100-{sme} | SME held | Liability | NGN |
| 3000 | FX position NGN | Clearing | NGN |
| 3100 | FX position USD | Clearing | USD |
| 4000 | Fee income | Income | NGN |

### Posting rules

Every journal entry balances within one currency. The conversion is carried by the two FX position accounts, so the trial balance is checked per currency and each must be zero.

| Event | Debit | Credit | Currency |
| --- | --- | --- | --- |
| NIP inflow received | 1000 Settlement bank | 2000 SME available | NGN |
| Funds reserved | 2000 SME available | 2100 SME held | NGN |
| On-chain leg confirmed | 1200 Provider receivable | 1100 Stablecoin reserve | USD |
| Payout confirmed (naira side) | 2100 SME held | 3000 FX position NGN (principal) and 4000 Fee income (fee) | NGN |
| Payout confirmed (dollar side) | 3100 FX position USD | 1200 Provider receivable | USD |
| Reversal before chain leg | 2100 SME held | 2000 SME available | NGN |
| Reversal after chain leg | 1100 Stablecoin reserve, then 2100 SME held | 1200 Provider receivable, then 2000 SME available | USD, then NGN |

A reversal after the chain leg needs the tokens back. The provider wallet is one you control, so the compensation step sends a real return transaction on the test network before posting the entry.

## Rules the build must hold

These are the parts the panel will probe. Everything else can be rough; these cannot.

### Ledger

- **Append-only.** A trigger on `journal_entries` and `journal_lines` raises on UPDATE and DELETE. The application database role has INSERT and SELECT only on both tables.
- **Balanced.** One function, `postEntry(reference, lines[])`, is the only write path. It rejects an entry unless debits equal credits within its currency and every amount is a positive integer in minor units.
- **Hash-chained.** `entry_hash = SHA-256(prev_hash + canonical JSON of {seq, reference, created_at, lines sorted by account code})`. The function locks the `ledger_head` row, reads `last_hash`, inserts, then updates the head, all in one transaction.
- **Unique reference.** `reference` is `{transfer_id}:{event}` with a unique index, so a retried step cannot post twice.
- **No overdraft.** The reserve step reads the SME available balance inside the same locked transaction and fails with `INSUFFICIENT_FUNDS` if short.
- **Verifiable.** `verifyChain()` walks entries by `seq` and recomputes every hash. `trialBalance()` returns debits minus credits per currency.

### Saga

One BullMQ job per step. A step first checks `saga_steps` for its own completed row and exits if found, then does its work, then enqueues the next step. Transient errors retry with exponential backoff, 5 attempts. A hard failure enqueues compensation for every completed step, in reverse order.

| # | Step | Does | Compensation |
| --- | --- | --- | --- |
| 1 | SCREEN | Runs the compliance gates below | None; nothing has moved |
| 2 | RESERVE | Posts the hold entry | Post the release entry |
| 3 | MATCH | Picks a provider with enough capacity, by weighted score of rate, reliability and headroom; decrements capacity; creates the payout order | Restore capacity; cancel the order |
| 4 | CHAIN\_SEND | Signs and broadcasts the token transfer from a treasury wallet to the provider wallet; saves `tx_hash` before returning | Send the return transfer from the provider wallet |
| 5 | CHAIN\_CONFIRM | Polls for the receipt with backoff; posts the USD entry | Post the reversing USD entry once the return confirms |
| 6 | PAYOUT | Calls the provider simulator; on success marks the order paid | None; a paid order is final |
| 7 | FINALISE | Posts the two payout entries, sets COMPLETED, fires the webhook | Not applicable |

Two details prevent the classic failures. CHAIN\_SEND on retry looks up the saved hash and never broadcasts a second time. Each treasury wallet has its own queue with concurrency 1 and a nonce counter in Redis, so parallel transfers cannot collide on a nonce; seed five wallets to keep throughput up.

### Compliance gates

SCREEN runs these in order and writes one `compliance_checks` row per gate, pass or fail.

| Gate | Rule | On failure |
| --- | --- | --- |
| KYB | `sme_accounts.kyb_status` is VERIFIED | DECLINED |
| Sanctions | Beneficiary name and country against `watchlist`, case-insensitive, exact or token-set match | DECLINED |
| Travel Rule | Originator and beneficiary name, account and address all present | DECLINED |
| Threshold | Single transfer above USD 10,000 | HELD |
| Velocity | More than 5 transfers from one SME in 10 minutes | HELD |

The threshold and velocity limits are illustrative values; make them config constants. The load test must spread its 500 transfers across about 100 seeded SMEs, or the velocity gate will hold most of them.

### Idempotency and the fiat boundary

- `POST /transfers` stores the `Idempotency-Key` per SME. Same key and same body returns the original response; same key and a different body returns `IDEMPOTENCY_CONFLICT`.
- SME responses are built by a serializer that whitelists fields. Write one test that fails if `tx_hash`, `wallet`, `provider` or `token` appears in any `/api` response outside `/api/ops`.

## Stack, layout and simulators

The stack is the one your proposal names, so Chapter 3 and the code agree. The only addition is the web framework.

| Layer | Choice | Note |
| --- | --- | --- |
| API and workers | TypeScript, Node.js, NestJS | One app, two entry points: `api` and `worker` |
| Database | PostgreSQL 16 with Prisma | Triggers and role grants go in a raw SQL migration; Prisma cannot express them |
| Queue | Redis with BullMQ | Also holds nonce counters and fault switches |
| Chain | viem on an EVM test network | Your mock ERC-20; `Signer` interface with local and KMS adapters |
| Web | Next.js with Tailwind | One app, `/app` and `/ops` route groups |
| Tests and load | Jest, k6 | Jest for the ledger and saga; k6 for the 500-transfer run |
| Run | Docker Compose, GitHub Actions | `docker compose up` starts Postgres, Redis, api, worker, web |

```
hsg/
  apps/
    api/src/
      auth/           login, JWT, role guard
      fiat/           virtual accounts, quotes, transfers, webhooks
      ledger/         postEntry, balances, verifyChain, trialBalance
      compliance/     gates, watchlist, review queue
      settlement/     Signer, wallets, send, confirm
      liquidity/      provider scoring, payout orders
      saga/           step processors, compensation
      sim/            NIP inflow, provider simulator, fault switches
      ops/            operator read models
    web/app/
      (sme)/app/...   S2 to S5
      (ops)/ops/...   O1 to O5
  contracts/          MockUSD.sol and deploy script
  prisma/             schema, migrations, seed.ts
  load/               k6 script, results export
  docker-compose.yml
```

### Simulators

Three simulators stand in for the outside world. Each lives in `sim/` behind the same interface a real integration would implement, which is the point you make when the panel asks about production.

| Simulator | Interface it implements | Behaviour | Fault switches |
| --- | --- | --- | --- |
| NIP bank | `FiatRail.onInflow`, `FiatRail.payout` | Operator form or API call credits a virtual account with a session ID | None needed today |
| Liquidity provider | `Provider.quote`, `Provider.payout` | Three seeded providers with different rate, capacity and reliability; payout succeeds after a configurable delay | Capacity to zero; payout hard fail; random failure by reliability score |
| Chain delay | Wraps the confirm poller | Adds N seconds before the receipt is accepted | Delay in seconds |

**Seed data:** 1 operator, 100 SMEs with users and virtual accounts (2 of them KYB pending, one with a legal name that matches the watchlist), 3 providers, 5 treasury wallets funded with test gas and mock tokens, 20 watchlist names, 1 beneficiary per SME plus 2 that match the watchlist.

## Build order for today

Twelve hours of build in ten blocks, backend first, so that a working system exists by the cut line even if the interface runs late. Interface design is extra: allow about 90 minutes for S2, S4 and S5 before block 8.

- [ ] **1. Foundation (45 min).** Repo, Docker Compose, Prisma schema, raw SQL migration with the append-only triggers and role grants, seed script.
- [ ] **2. Ledger (90 min).** `postEntry`, balances, `verifyChain`, `trialBalance`. Jest: balanced entry accepted, unbalanced rejected, UPDATE rejected, tampered row detected.
- [ ] **3. Fiat edge (60 min).** Login, `/me`, `/balance`, NIP inflow simulator, beneficiaries with screening, quotes with expiry.
- [ ] **4. Chain (30 min).** Deploy the mock token, fund five wallets, `Signer`, send and confirm proven by a script.
- [ ] **5. Saga happy path (120 min).** `POST /transfers` with idempotency, steps 1 to 7 through the queue, transfer reaches COMPLETED.
- [ ] **6. Failure paths (60 min).** Compensation, fault switches, both reversals (before and after the chain leg).
- [ ] **7. Compliance (60 min).** The five gates, HELD and DECLINED, review decisions, KYB approval.

**Cut line.** After block 7 the whole demo story runs through the API. Everything below makes it visible.

- [ ] **8. SME screens (120 min).** S1 to S5 against the live API.
- [ ] **9. Operator console (90 min).** O5, then O4, then O2, then O3.
- [ ] **10. Evaluation run (45 min).** 500 transfers with k6, faults on for part of the run, export timings, take screenshots.

**If you fall behind, drop in this order:** O1 overview, KMS adapter, outbound webhook, reconciliation endpoint, then move block 10 to tomorrow. Do not cut blocks 2, 5 or 6; they are the thesis.

## Acceptance checklist

The build is accepted when all 14 test cases from Session Four of your project document pass in this build. Each row says how to trigger the case here and what to save as evidence.

| Case | How to run it in this build | Pass when | Evidence |
| --- | --- | --- | --- |
| TC01 Valid KYB | Operator approves the clean pending SME in the review queue | SME becomes VERIFIED; a PASS row in `compliance_checks` | Screenshot of O3 and the check row |
| TC02 KYB fails screening | Operator approves the pending SME whose name matches the watchlist | SME stays blocked; a FAIL row; cannot sign in to send | Same |
| TC03 NIP inflow | Operator funds a virtual account in O5 | SME balance updates within 5 s; one balanced entry | Screenshot of S2 before and after; the journal entry |
| TC04 Quote then transfer | SME confirms inside the 60 s window | 202 returned; hold entry posted | S4 and S5 screenshots |
| TC05 Expired quote | Wait past expiry, then confirm | `QUOTE_EXPIRED`; no new journal entry | API response; entry count unchanged |
| TC06 Beneficiary fails screening | Send to a watchlist beneficiary through the API | DECLINED at SCREEN; no `chain_transactions` row | O2 detail, Compliance tab |
| TC07 Happy path | Demo story steps 1 to 5 | COMPLETED; webhook logged; reconciliation variance zero | O2 all five tabs; explorer page for the hash |
| TC08 Provider out of capacity | Set one provider's capacity to zero, then all three | First run routes to the next provider; second run ends REVERSED | Payout order showing the chosen provider; S5 Reversed |
| TC09 Chain congestion | Set chain delay to 120 s | Step retries with backoff; exactly one `chain_transactions` row; completes | Saga steps tab showing attempts |
| TC10 Duplicate submission | Send the same request twice with one key | One transfer; second response identical | Both responses; transfer count |
| TC11 Ledger tamper | Run UPDATE on a journal line as the app role; then alter a row as superuser on a copy of the database | First is rejected by the trigger; second makes `verifyChain` return `broken_at` | Terminal output of both |
| TC12 Velocity breach | Send 6 transfers from one SME inside 10 minutes | Sixth is HELD and appears in the review queue | O3 screenshot |
| TC13 Reconciliation variance | Move tokens out of a treasury wallet with a script, then run reconcile | Variance reported with the amount | Reconcile response |
| TC14 Payout fails after chain leg | Switch on payout hard fail, send a transfer | Return transaction confirms; reversing entries posted; balance restored; REVERSED | O2 chain tab with two hashes; journal entries |

### Evaluation targets

| Target from the proposal | How this build measures it | What to state alongside the number |
| --- | --- | --- |
| Settlement latency at or under 15 minutes, 95th percentile | `completed_at` minus `created_at` over completed transfers in the 500 run | Fiat legs are simulated; give the configured payout delay and the test network's block time |
| Throughput of at least 10 transactions per second | k6 constant arrival rate on `POST /transfers`; report intake rate and completions per second separately | Completions are bounded by test-network confirmation, intake by the API and ledger lock |
| 100% of transactions resolved | Count of transfers not in COMPLETED, REVERSED or DECLINED after the run, with faults on for part of it | Decide every HELD transfer before counting |
| OWASP ASVS Level 2 | Not today; a manual checklist pass on the finished build | Which controls were checked and which were not |
| Cost per USD 1,000 against the correspondent baseline | Fee plus quote spread from the system; gas units used from receipts | Test-network gas has no real price; any mainnet cost is an estimate under a stated gas price |

### What to save for Chapters 4 and 5

- Screenshots of S2, S4, S5, each O2 tab, O4 and O5, taken from the running system.
- The k6 summary and the exported CSV of per-transfer timings, kept unedited in the repository.
- Jest output for the ledger and saga suites.
- The commit history, as the record of how the build actually proceeded.

Report the numbers the run produces, including any target it misses, and describe the build process as it happened. If the proposal's two build cycles collapsed into a shorter schedule, say so in Chapter 4 rather than writing sprint narratives to match the plan. The panel may ask you to open `postEntry` and the saga processors and explain them line by line, so write those two parts yourself and know them cold.
