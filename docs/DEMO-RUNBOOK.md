# HSG demo runbook

This runbook covers the 7-step demo story from the PRD as click-paths, then one section for each acceptance test (TC01 to TC14), each with its trigger and the evidence to capture. The API shapes come from `docs/API-CONTRACT.md`.

## 0. Before the panel

```bash
./dev.sh --fresh --yes        # or: docker compose down -v && docker compose up --build
```

Wait for the `HSG is up` banner. Use two browser windows, or one normal window and one private window, so that both roles stay signed in at the same time:

| Window | Login (password `Passw0rd!`) | Lands on |
|---|---|---|
| **SME** | `funmi@adebayoimports.ng` | http://localhost:3000/app |
| **Ops** | `ops@hsg.test` | http://localhost:3000/ops |

Save screenshots to `docs/evidence/` as `TCxx-<what>.png`.

### Terminal helper (paste once per shell)

```bash
API=http://localhost:4000/api
# jget '.a.b'  : read a field from JSON on stdin (uses node, so no jq needed)
jget() { node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const o=JSON.parse(s);const v=eval("o"+process.argv[1]);console.log(typeof v==="object"?JSON.stringify(v,null,2):v)})' "$1"; }
# tok <email> : sign in and print the JWT
tok() { curl -s -X POST "$API/auth/login" -H 'content-type: application/json' \
          -d "{\"email\":\"$1\",\"password\":\"Passw0rd!\"}" | jget .token; }
# call <token> <METHOD> <path> [json-body] [extra curl args...]
call() { local t="$1" m="$2" p="$3" b="${4:-}"; shift 3; [ $# -gt 0 ] && shift
         curl -s -X "$m" "$API$p" -H "authorization: Bearer $t" -H 'content-type: application/json' \
              ${b:+-d "$b"} "$@"; echo; }

OPS=$(tok ops@hsg.test)
SME=$(tok funmi@adebayoimports.ng)
```

Amounts on the wire are strings in minor units: NGN 5,000,000.00 is `"500000000"` (kobo) and USD 1,000.00 is `"100000"` (cents).

---

## Part 1: the 7-step demo story

### Step 1: SME signs in and sees a naira balance and a virtual account

1. **SME window** → http://localhost:3000/login → `funmi@adebayoimports.ng` / `Passw0rd!` → **Sign in**.
2. You land on **/app** (Dashboard).

9500000001

**Panel sees:** Available balance NGN 0.00 with the "No funds yet" state, plus the virtual account number, bank name and account name with a copy button. No transfers yet. 📸 `TC03-S2-before.png`

### Step 2: Operator simulates an NIP inflow of NGN 5,000,000

1. **Ops window** → http://localhost:3000/login → `ops@hsg.test` → you land on **/ops**.
2. Open **/ops/simulator**. In the **NIP inflow** card:
   - **Credit virtual account**: pick *Adebayo Imports Ltd*
   - **Amount (NGN)**: `5000000`
   - **Sender name**: `Adebayo Imports Ltd - GTBank`
   - click **Credit virtual account**
3. **SME window**: refresh **/app**.

**Panel sees:** the balance reads NGN 5,000,000.00 within 5 s. The simulator shows the credited entry reference (`inflow:<session>`). 📸 `TC03-S2-after.png`, `TC03-O5-inflow.png`

### Step 3: SME adds a beneficiary, quotes USD 1,000 and confirms

1. **SME window** → **/app/beneficiaries** → **Add beneficiary**, then fill in:
   - Business name `Guangzhou Precision Tools Co.`, Country `CN`, Bank name `China Merchants Bank`
   - Account number or IBAN `6214 8301 2345 6789`, SWIFT/BIC `CMBCCNBS`
   - Business address `88 Huangpu Avenue, Guangzhou, China`
   - **Add**. The row appears with checks **Cleared**.
2. Open **/app/send** (or **Send payment** on the dashboard):
   - Beneficiary: *Guangzhou Precision Tools Co.*
   - Amount the beneficiary receives: **USD** `1000`
   - Purpose of payment: `Payment for goods, invoice INV-2291`
   - **Get quote**
3. A quote card shows the rate, the fee (NGN 7,500.00), **You pay** (total NGN debit, about NGN 1.59m at about 1,580/USD) and a 60-second countdown. Click **Confirm** before it expires.

**Panel sees:** the button disables while the request is in flight, then the app redirects to **/app/transfers/:id**. 📸 `TC04-S4-quote.png`

### Step 4: The transfer moves through its states and completes

The **/app/transfers/:id** page polls every 3 s. The chip reads **Processing** while the timeline ticks through *Received → Checks passed → Sent → Delivered*, then switches to **Completed**. That takes about 10 to 30 s, depending on the 2 s block time and the provider payout delay.

**Panel sees:** reference `HSG-…`, the beneficiary, USD 1,000.00, the NGN debited, the rate, the fee and the four timestamps. **There is no address, hash, token, gas or provider name anywhere on the page.** Show **Download receipt** (print view). 📸 `TC04-S5-processing.png`, `TC07-S5-completed.png`

### Step 5: Operator opens the same transfer

**Ops window** → **/ops/transfers** → click the reference → **/ops/transfers/:id**. Walk the five tabs:

| Tab | Point at |
|---|---|
| **Saga steps** | SCREEN, RESERVE, MATCH, CHAIN_SEND, CHAIN_CONFIRM, PAYOUT and FINALISE, each with its attempt, start/end and outcome |
| **Compliance checks** | five PASS rows: KYB, SANCTIONS, TRAVEL_RULE, THRESHOLD, VELOCITY |
| **Journal entries** | `…:RESERVE`, `…:CHAIN_CONFIRMED`, `…:PAYOUT_NGN` and `…:PAYOUT_USD`, each balanced, with `prev_hash → entry_hash` |
| **Chain transaction** | one SEND row: from treasury-N to the provider wallet, token amount, `tx_hash`, block, confirmations, gas used |
| **Payout order** | provider name, rate, score, status PAID, `paid_at` |

📸 one screenshot per tab: `TC07-O2-saga.png`, `TC07-O2-checks.png`, `TC07-O2-journal.png`, `TC07-O2-chain.png`, `TC07-O2-payout.png`

### Step 6: Fault: provider out of capacity → Reversed

1. **Ops window** → **/ops/simulator** → **Fault switches** → switch **Providers out of capacity** ON.
2. **SME window** → **/app/send** → same beneficiary, **USD** `1000`, **Get quote** → **Confirm**.
3. The transfer ends with the chip **Reversed (funds returned)**. The timeline marks the failed step, the page shows the NGN returned with a plain-English reason, and **/app** shows the available balance back to its value before the send.
4. **Ops window**: the transfer detail shows state REVERSED. The **Journal entries** tab shows `…:RESERVE` followed by `…:RELEASE`. There is no chain row, because the failure happened before the chain leg.
5. Switch **Providers out of capacity** OFF again.

📸 `TC08-S5-reversed.png`, `TC08-O2-journal.png`

### Step 7: Ledger page

**Ops window** → **/ops/ledger**:

1. **Trial balance** reads NGN 0 / USD 0, OK.
2. Click **Verify chain** → the hash chain is intact (`ok: true, broken_at: null`, N entries checked).
3. Click **Run reconciliation** → treasury on-chain balance equals ledger 1100, variance 0.

📸 `O4-ledger.png`

---

## Part 2: acceptance tests TC01 to TC14

Each test lists **Trigger**, **Pass when** and **Evidence**. The curl lines assume you pasted the helper above.

### TC01 Valid KYB

- **Trigger:** **Ops** → **/ops/review** → tab **KYB pending** → *Kano Agro Exports Ltd* → **Approve**.
  API equivalent: first get the ID with `call $OPS GET /ops/review | jget '.kyb_pending'`, then run `call $OPS POST /ops/review/<smeId>/decision '{"decision":"approve"}'`.
- **Pass when:** the result is VERIFIED, and a PASS row (gate KYB) is written in `compliance_checks`. `admin@kanoagroexports.ng` can now get a quote.
- **Evidence:** 📸 O3 before and after. Check row:
  ```bash
  psql postgresql://hsg_owner:hsg_owner@localhost:5432/hsg -c "select gate,result,detail,created_at from compliance_checks where gate='KYB' order by created_at desc limit 3"
  ```

### TC02 KYB fails screening

- **Trigger:** **/ops/review** → **KYB pending** → *Obsidian Crest Holdings Ltd* → **Approve**.
- **Pass when:** the result is REJECTED (the name matches the watchlist) and a FAIL row is written. The user can sign in, but cannot send:
  ```bash
  OBS=$(tok info@obsidiancrest.ng)
  call $OBS POST /quotes '{"usd_amount":"100000"}'      # -> {"error":{"code":"KYB_NOT_VERIFIED",...}}
  ```
- **Evidence:** 📸 O3, the FAIL check row (same psql as TC01), and the quote error response.

### TC03 NIP inflow

- **Trigger:** demo step 2 (UI), or:
  ```bash
  ACCT=$(call $SME GET /me | jget .virtual_account.account_number)
  call $SME GET /balance
  call $OPS POST /sim/nip-inflow "{\"account_number\":\"$ACCT\",\"amount\":\"500000000\",\"sender_name\":\"Adebayo Imports - GTBank\"}"
  call $SME GET /balance
  ```
- **Pass when:** the balance shows `available` +500000000 within 5 s, and there is one balanced entry with reference `inflow:<session_id>`. Repeating the call with the same `session_id` is a no-op.
- **Evidence:** 📸 S2 before and after, plus the entry in **/ops/ledger** (last 50 entries).

### TC04 Quote then transfer

- **Trigger:** demo step 3 (UI), or:
  ```bash
  BEN=$(call $SME GET /beneficiaries | jget '.items.find(b=>b.screening_status==="CLEARED").id')
  Q=$(call $SME POST /quotes '{"usd_amount":"100000"}' | jget .id)
  call $SME POST /transfers "{\"quote_id\":\"$Q\",\"beneficiary_id\":\"$BEN\",\"purpose\":\"Invoice INV-2291\"}" \
       -H "Idempotency-Key: tc04-$(date +%s)" -w '\nHTTP %{http_code}\n'
  ```
- **Pass when:** the response is HTTP **202** with an SmeTransfer, and an entry `<transferId>:RESERVE` exists (O2 → Journal entries).
- **Evidence:** 📸 S4 (quote card) and S5.

### TC05 Expired quote

- **Trigger:**
  ```bash
  call $OPS GET /ops/ledger | jget .entry_count          # note N
  Q=$(call $SME POST /quotes '{"usd_amount":"100000"}' | jget .id); sleep 65
  call $SME POST /transfers "{\"quote_id\":\"$Q\",\"beneficiary_id\":\"$BEN\",\"purpose\":\"late\"}" -H "Idempotency-Key: tc05-$(date +%s)"
  call $OPS GET /ops/ledger | jget .entry_count          # still N
  ```
  In the UI: get a quote on **/app/send**, wait for the countdown to reach zero, and the button changes to **Refresh quote**.
- **Pass when:** the response is `{"error":{"code":"QUOTE_EXPIRED",...}}` and the entry count is unchanged.
- **Evidence:** the API response and both counts.

### TC06 Beneficiary fails screening

The seed gives the demo SME *Black Meridian Shipping Co*. It was cleared when added, and its name was later put on the watchlist, so the API accepts the transfer and the SCREEN step declines it.
- **Trigger:**
  ```bash
  BAD=$(call $SME GET /beneficiaries | jget '.items.find(b=>b.name.startsWith("Black Meridian")).id')
  Q=$(call $SME POST /quotes '{"usd_amount":"50000"}' | jget .id)
  T=$(call $SME POST /transfers "{\"quote_id\":\"$Q\",\"beneficiary_id\":\"$BAD\",\"purpose\":\"freight\"}" -H "Idempotency-Key: tc06-$(date +%s)" | jget .id)
  sleep 3; call $SME GET /transfers/$T | jget .status          # Declined
  call $OPS GET /ops/transfers/$T | jget '.chain_transactions.length'   # 0
  ```
  The other way in: sending to a beneficiary that is already **BLOCKED** (*Varkov Maritime Logistics LLC*, *Golden Lotus Commodities FZE*) is refused synchronously with `BENEFICIARY_NOT_CLEARED`. In the UI, those beneficiaries show **Not cleared** and cannot be selected.
- **Pass when:** the state is DECLINED at SCREEN with a FAIL row for SANCTIONS, and there is no `chain_transactions` row.
- **Evidence:** 📸 **/ops/transfers/$T** → **Compliance checks** tab.

### TC07 Happy path

- **Trigger:** demo steps 1 to 5.
- **Pass when:** the state is COMPLETED, the webhook is logged, and the reconciliation variance is zero:
  ```bash
  call $OPS GET /sim/webhook-events | jget '.items[0]'
  call $OPS POST /ops/reconcile                           # variance_cents: "0"
  ```
  The webhook events also appear at the bottom of **/ops/simulator**.
- **Evidence:** 📸 all five O2 tabs (step 5). On the local chain there is no public explorer, so capture the Chain tab showing the hash, block and confirmations, plus `cast tx <hash> --rpc-url http://127.0.0.1:8545` output instead of an explorer page.

### TC08 Provider out of capacity

1. **One provider:** **/ops/simulator** → providers table → **Set capacity to 0** on the provider with the best rate. Send USD 1,000 from the SME.
   **Pass:** COMPLETED. **Payout order** tab shows a *different* provider.
2. **All providers:** click **Set capacity to 0** on the remaining two, or switch on **Providers out of capacity**. Send again.
   **Pass:** REVERSED. S5 shows *Reversed (funds returned)*, and the balance is restored.
   ```bash
   call $OPS GET /sim/providers | jget '.items.map(p=>p.name+" "+p.capacity_usd)'
   call $OPS PUT /sim/faults '{"providersOutOfCapacity":true}'
   ```
3. Restore the providers (**Edit** → capacity back), and turn the switch OFF.
- **Evidence:** 📸 the Payout order tab from run 1, and S5 Reversed from run 2.

### TC09 Chain congestion

- **Trigger:** **/ops/simulator** → **Chain confirmation delay** → `120` → **Apply** (or `call $OPS PUT /sim/faults '{"chainDelaySeconds":120}'`). Then send USD 1,000.
- **Pass when:** CHAIN_CONFIRM shows several attempts with backoff on the **Saga steps** tab, there is **exactly one** row in the **Chain transaction** tab (no re-broadcast), and the transfer reaches COMPLETED after the delay.
- Reset the delay to `0` afterwards.
- **Evidence:** 📸 Saga steps tab showing the attempts, and the Chain tab showing one row.

### TC10 Duplicate submission

- **Trigger:**
  ```bash
  Q=$(call $SME POST /quotes '{"usd_amount":"20000"}' | jget .id)
  BODY="{\"quote_id\":\"$Q\",\"beneficiary_id\":\"$BEN\",\"purpose\":\"dup test\"}"
  KEY="tc10-$(date +%s)"
  call $SME POST /transfers "$BODY" -H "Idempotency-Key: $KEY" -w '\nHTTP %{http_code}\n' > r1.txt
  call $SME POST /transfers "$BODY" -H "Idempotency-Key: $KEY" -w '\nHTTP %{http_code}\n' > r2.txt
  diff r1.txt r2.txt && echo IDENTICAL
  call $SME POST /transfers "{\"quote_id\":\"$Q\",\"beneficiary_id\":\"$BEN\",\"purpose\":\"changed\"}" -H "Idempotency-Key: $KEY"
  ```
- **Pass when:** both responses are identical with HTTP 202 and the same `id`. Only one transfer exists (`call $SME GET /transfers | jget '.items.filter(t=>t.purpose==="dup test").length'` returns 1). The changed body returns `409 IDEMPOTENCY_CONFLICT`.
- **Evidence:** `r1.txt`, `r2.txt`, the conflict response and the count.

### TC11 Ledger tamper

- **Trigger:** `cd hsg-backend && npx ts-node scripts/tamper-demo.ts`. This runs against `hsg_test` by default, never the live DB.
- **Pass when:** (a) the UPDATE as `hsg_app` is rejected (permission denied / trigger), and (b) the superuser edit with triggers bypassed makes `verifyChain()` return `broken_at: <seq>`. The script then restores the row.
- **Evidence:** the terminal output of both parts.

### TC12 Velocity breach

- **Trigger:** six transfers from one SME within 10 minutes:
  ```bash
  S1=$(tok sme001@hsg.test)
  B1=$(call $S1 GET /beneficiaries | jget '.items.find(b=>b.screening_status==="CLEARED").id')
  for i in 1 2 3 4 5 6; do
    Q=$(call $S1 POST /quotes '{"usd_amount":"10000"}' | jget .id)
    call $S1 POST /transfers "{\"quote_id\":\"$Q\",\"beneficiary_id\":\"$B1\",\"purpose\":\"velocity $i\"}" \
         -H "Idempotency-Key: tc12-$i-$(date +%s)" | jget '.reference+" "+o.status'
  done
  ```
- **Pass when:** the sixth transfer is **Under review** (HELD) and appears in **/ops/review** → held transfers with rule VELOCITY. Then **Approve and release** resumes it to COMPLETED, or **Reject** declines it.
- **Evidence:** 📸 O3 showing the held transfer and its rule.

### TC13 Reconciliation variance

Run this last, or on a run you will reset afterwards: it leaves a deliberate variance.
- **Trigger:**
  ```bash
  call $OPS POST /ops/reconcile                    # variance 0
  cd hsg-backend && npx ts-node scripts/chain-drain.ts 500 treasury-1
  call $OPS POST /ops/reconcile                    # variance_cents: "-50000"
  ```
  Alternatively, click **Run reconciliation** on **/ops/ledger** before and after.
- **Pass when:** the variance is reported with the amount (USD 500.00).
- **Evidence:** both reconcile responses.

### TC14 Payout fails after the chain leg

- **Trigger:** **/ops/simulator** → **Payout hard fail** ON (or `call $OPS PUT /sim/faults '{"payoutHardFail":true}'`). Then send USD 1,000 from the SME.
- **Pass when:** PAYOUT fails, then compensation runs: the return transfer from the provider wallet is confirmed, the reversing entries (`…:CHAIN_RETURNED`, `…:RELEASE`) are posted, the balance is restored, and the transfer ends REVERSED.
- Switch **Payout hard fail** OFF afterwards.
- **Evidence:** 📸 O2 **Chain transaction** tab with **two** hashes (SEND and RETURN), the **Journal entries** tab, and S5 Reversed.

---

## After the run

- **/ops/ledger**: run **Verify chain** and check the trial balance once more. Both must still be clean, except for the TC13 variance on reconcile.
- Every HELD transfer must be decided before you count "100% resolved" (the PRD evaluation targets).
- Reset for the next rehearsal with `./dev.sh --fresh --yes`.
