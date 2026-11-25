# Saga walkthrough (for the defence)

Code: `hsg-backend/src/modules/saga/` (runner, steps, compensation) and `hsg-backend/src/modules/liquidity/` (provider matching, payout adapters). Tests: `test/saga.spec.ts`, `test/liquidity.spec.ts`.

## The shape of every step

A transfer moves through seven steps. Each step is one BullMQ job, and each processor does the same five things in the same order:

0. **Stop check.** If the transfer is HELD, DECLINED, REVERSING, REVERSED or COMPLETED, do nothing. RESERVE is the one exception: it accepts HELD, because approving a review enqueues RESERVE.
1. **Already done?** Look in `saga_steps` for a COMPLETED row for this step. If there is one, enqueue the next step and return. A job delivered twice (a redelivery, a duplicate enqueue or an operator retry) therefore never repeats work.
2. **Record the attempt.** Insert a RUNNING row whose `attempt` is the number of earlier tries plus one, and set `transfers.current_step`.
3. **Do the work.** Each call is idempotent in its own right: ledger references are unique (`{transferId}:{EVENT}`), there is at most one payout order per transfer, and there is at most one chain transaction per (transfer, kind).
4. **Mark it done.** Set the row to COMPLETED and move the transfer's state and `*_at` timestamp in one database transaction.
5. **Enqueue the next step.**

The retry policy is in one place, `runWithPolicy` in `saga-runner.ts`:

- **Transient error** (a `DomainError` with `transient=true`, or any unexpected error such as a network failure): the row is marked FAILED with the error, and the error is rethrown. BullMQ then retries with exponential backoff, up to 5 attempts.
- **Hard error** (a `DomainError` with `transient=false`): the row is marked FAILED and compensation starts. There is no retry, because retrying cannot help.
- **Attempts exhausted**: the worker's `failed` event sees `attemptsMade >= attempts` and starts compensation.

## The seven steps

| Step | What it does | Transfer state |
|---|---|---|
| SCREEN | `ComplianceService.runTransferGates` runs KYB, sanctions, travel rule, threshold and velocity, and writes one `compliance_checks` row per gate. On PASS it enqueues RESERVE. On HELD it records `held_rule` and stops until an operator decides. On DECLINED it sets a plain-English `failure_reason` and stops. Nothing has moved, so nothing needs compensating. | SCREENING, then HELD or DECLINED where the gates say so |
| RESERVE | Posts the hold entry (Dr 2000-sme / Cr 2100-sme). The ledger checks the available balance inside its lock. `INSUFFICIENT_FUNDS` means DECLINED, with nothing to undo. | RESERVED |
| MATCH | `LiquidityService.match`: ranks the active providers that can cover the whole amount by score = 0.5·rate + 0.3·reliability + 0.2·headroom, locks the chosen provider's row (`SELECT … FOR UPDATE`), re-checks its capacity, decrements it and creates the payout order, all in one transaction. If no provider qualifies it throws `NO_PROVIDER_CAPACITY`, a hard error that triggers compensation. | stays RESERVED |
| CHAIN_SEND | Picks the treasury wallet and stores it on the transfer, then forwards the job to **that wallet's own queue** (`chain-<address>`, concurrency 1). That job calls `SettlementService.sendTokens`, which saves the tx hash before returning. On a retry it finds the saved hash and does not broadcast again. | ONCHAIN_PENDING |
| CHAIN_CONFIRM | Reads the receipt. If it is pending, the step closes this check and re-queues itself in 5 s, for up to 5 minutes, so TC09's 120 s delay does not use up the 5 retries; each check shows as one attempt row. When the receipt confirms, it posts Dr 1200 / Cr 1100 USD. A reverted transaction is a hard error. | ONCHAIN_CONFIRMED |
| PAYOUT | Calls the provider's `PayoutPartner` (the simulated adapter by default). A temporary failure (rolled from the provider's reliability) is retried. A hard failure (the `payoutHardFail` switch) marks the order FAILED and starts compensation. On success the order is PAID. A PAID order is never paid again. | PAYOUT_PENDING |
| FINALISE | Posts PAYOUT_NGN (Dr 2100 / Cr 3000 principal, Cr 4000 fee) and PAYOUT_USD (Dr 3100 / Cr 1200), sets COMPLETED and sends the `transfer.completed` webhook. | COMPLETED |

### Why each wallet has its own queue

An EVM account's transactions must use nonces strictly in order. If two sends from one wallet ran at the same time, they could take the same nonce, and one of them would be dropped. Each wallet therefore gets its own queue with concurrency 1, so only one send per wallet is ever in flight. Five treasury wallets give five sends in parallel. Returns run on the provider wallet's queue for the same reason.

## Compensation (`compensation.ts`)

A hard failure or exhausted retries calls `beginCompensation`. It sets the state to REVERSING, stores the plain-English reason, and queues a `COMPENSATE` job. The one exception: if the payout order is already PAID, the beneficiary has the money, so nothing is reversed and the operator retries FINALISE instead.

`COMPENSATE` undoes completed work in reverse order. Each undo is recorded as a `COMP_<STEP>` row and skipped once that row is COMPLETED, so running compensation again never undoes anything twice.

1. **Chain leg (steps 4 and 5).** This depends on what is actually on chain, not only on the step log.
   - If the original send is still pending, wait for it to settle (re-queue in 5 s).
   - If the send reverted, there is nothing to return.
   - If it confirmed, the tokens are in the provider's wallet. Make sure Dr 1200 / Cr 1100 is posted (this is a no-op if CHAIN_CONFIRM already posted it). Then **COMP_CHAIN_SEND**: the provider wallet's queue sends a RETURN transaction back to the same treasury wallet, and the hash is saved first. Then **COMP_CHAIN_CONFIRM**: wait for its receipt and post Dr 1100 / Cr 1200 (CHAIN_RETURNED).
2. **COMP_MATCH**: `LiquidityService.unmatch` cancels the order and gives the capacity back exactly once.
3. **COMP_RESERVE**: posts the release entry (Dr 2100 / Cr 2000), only if RESERVE completed.
4. Sets REVERSED and `reversed_at`, and sends the `transfer.reversed` webhook.

Reasons the SME sees:

- payout rejected: "The receiving bank could not accept this payment. Your naira has been returned."
- anything else (no capacity, chain failure, retries exhausted): "We could not complete this payment right now. Your naira has been returned."

## Mapping to the test cases

- **TC06**: SCREEN returns DECLINED. No `chain_transactions` row is ever created.
- **TC07**: the full path. The test checks every posting, the step rows and the order PAID.
- **TC08**: a provider at capacity 0 is not eligible, so the next-best provider is chosen. With all providers at 0 (or `providersOutOfCapacity` on), MATCH throws a hard error, the hold is released and the transfer ends REVERSED.
- **TC09**: CHAIN_CONFIRM polls with a delay and one row per check, and exactly one chain transaction exists.
- **TC10**: replaying every step of a completed transfer changes nothing.
- **TC12**: SCREEN returns HELD for the VELOCITY rule. Approval enqueues RESERVE and the saga resumes.
- **TC14**: payout hard fail leads to: return sent, return confirmed, CHAIN_RETURNED posted, order cancelled, hold released, REVERSED. There are two hashes in the chain tab.

## Operator controls

- `POST /api/ops/transfers/:id/retry` re-queues `current_step` with a fresh job id. It is safe because of rule (1). For a transfer that is REVERSING, it resumes COMPENSATE.
- `GET/PUT /api/sim/providers[/:id]` edits rate, capacity, reliability, payout delay and active.
- `GET/PUT /api/sim/faults` controls `payoutHardFail`, `chainDelaySeconds` and `providersOutOfCapacity`.

## Bridge (future work)

`BridgeAdapter` builds the exact `POST /v0/transfers` request from the PRD: `on_behalf_of`; `source {payment_rail: base, currency: usdc, from_address}`; `destination {payment_rail, currency, external_account_id, amount}` (a fixed output); and `Idempotency-Key` set to the transfer id. A test checks this request. Unless `BRIDGE_API_URL` and `BRIDGE_API_KEY` are set it throws "Bridge sandbox not configured", because no sandbox credentials exist for this build. Providers use it only when `liquidity_providers.adapter = 'BRIDGE'`.
