# HSG API contract (build-night source of truth)

All routes under `/api`. JSON. Money = **strings in minor units** (NGN kobo, USD cents). Rates = 2dp strings ("1580.00"). Timestamps = ISO-8601 strings.
Auth: `Authorization: Bearer <jwt>` (also accepts `hsg_token` cookie). Errors: `{"error":{"code","message"}}` with codes
`QUOTE_EXPIRED, INSUFFICIENT_FUNDS, BENEFICIARY_NOT_CLEARED, KYB_NOT_VERIFIED, IDEMPOTENCY_CONFLICT, NOT_FOUND, FORBIDDEN, UNAUTHORIZED, VALIDATION_ERROR`.

**Fiat boundary:** no SME response (anything outside `/api/ops` and `/api/sim`) may contain the substrings `tx_hash`, `hash`, `wallet`, `provider`, `token` (except the login `token` field), `chain`, `gas`, `address` *as a crypto address* (postal `address` is fine), `usdc`, `bridge`. Enforced by `test/fiat-boundary.spec.ts`.

Seed logins (password for all: `Passw0rd!`): `ops@hsg.test` (OPERATOR), `funmi@adebayoimports.ng` (SME, verified, demo account), `sme001@hsg.test` … `sme100@hsg.test` (load-test SMEs). Two KYB-pending SMEs; one of them has a legal name on the watchlist.

---

## SME

### POST /auth/login  (public)
`{email, password}` → `200 {token, role: "SME"|"OPERATOR", user:{id,email,smeId}}`. Wrong creds → 401 `UNAUTHORIZED` "That email and password don't match". KYB-pending SMEs CAN sign in (dashboard shows a "verification pending" state); they cannot send (KYB gate declines / POST /quotes returns `KYB_NOT_VERIFIED`).

### POST /auth/register  (public, throttled 5 per IP per 10 min)
`{legal_name, rc_number, address, contact_name, email, password}` → `201 {token, role:"SME", user}` (signed in). Creates the SME with `kyb_status: PENDING`, its user, a virtual account (next free `95xxxxxxxx`) and ledger accounts. It can sign in and be funded immediately; quotes/transfers return `KYB_NOT_VERIFIED` until an operator approves it in `/ops/review` (KYB tab). Errors: `CONFLICT` (email exists), `VALIDATION_ERROR`, `RATE_LIMITED` (429).

### GET /me
`{id, email, sme:{id, legal_name, kyb_status, address, country}, virtual_account:{account_number, bank_name, account_name}}`

### GET /balance
`{currency:"NGN", available:"500000000", held:"0"}` — derived from ledger accounts 2000-{sme} / 2100-{sme}.

### GET /beneficiaries
`{items:[{id, name, country, bank_name, account_number_masked:"••••6789", swift_bic, address, currency:"USD", screening_status:"CLEARED"|"BLOCKED", created_at}]}`

### POST /beneficiaries
`{name, country, bank_name, account_number, swift_bic?, address, currency?:"USD"}` → `201` beneficiary (same shape). Screening runs synchronously.

### POST /quotes
`{usd_amount:"100000"}` → `201 {id, usd_amount, rate:"1580.00", principal_ngn, fee_ngn:"750000", total_ngn, expires_at, created_at}` (60 s TTL).
Errors: `KYB_NOT_VERIFIED`, `VALIDATION_ERROR`. (Insufficient funds is NOT checked at quote time; UI compares total_ngn to available and shows the state.)

### POST /transfers   (header `Idempotency-Key` required)
`{quote_id, beneficiary_id, purpose}` → `202` SmeTransfer (below). Same key + same body → identical response (status 202). Same key + different body → `409 IDEMPOTENCY_CONFLICT`.
Synchronous checks in order: quote belongs to SME & unused else NOT_FOUND; expired → `QUOTE_EXPIRED` (no journal entry); beneficiary BLOCKED → `BENEFICIARY_NOT_CLEARED`; KYB not verified → `KYB_NOT_VERIFIED`; available < total_ngn → `INSUFFICIENT_FUNDS`. Then creates transfer (CREATED), marks quote used, enqueues SCREEN.

### GET /transfers?status=Processing|Under%20review|Completed|Reversed|Declined&limit=50
`{items: SmeTransfer[]}` newest first.

### GET /transfers/:id
SmeTransfer:
```json
{
  "id":"tr_01J...", "reference":"HSG-20261123-000142", "status":"Processing",
  "usd_amount":"100000", "ngn_debited":"158750000", "rate":"1580.00", "fee_ngn":"750000",
  "purpose":"Payment for goods, invoice INV-2291",
  "beneficiary":{"id":"bn_..","name":"..","country":"CN","bank_name":"..","account_number_masked":"••••6789"},
  "failure_reason":null, "ngn_returned":null,
  "created_at":"..", "completed_at":null,
  "timeline":[
    {"key":"received","label":"Received","at":"..","state":"done"},
    {"key":"checks","label":"Checks passed","at":null,"state":"current"},
    {"key":"sent","label":"Sent","at":null,"state":"pending"},
    {"key":"delivered","label":"Delivered","at":null,"state":"pending"}
  ]
}
```
Timeline mapping: received = created_at; checks = reserved_at (state `failed` if DECLINED/HELD shows `current`); sent = onchain_confirmed_at; delivered = completed_at. On REVERSED: the step that failed gets `failed`, `ngn_returned` = total, `failure_reason` plain English (e.g. "The receiving bank could not accept this payment. Your naira has been returned.").

---

## Operator (`@Roles('OPERATOR')`)

### GET /ops/overview
`{counts_today:{CREATED:0,...,COMPLETED:12,REVERSED:1,...}, p95_settlement_seconds: 41.2, completed_today, total_reversed_ngn:"...", treasury:{onchain_cents:"...", ledger_1100_cents:"...", variance_cents:"..."}}`

### GET /ops/transfers?state=COMPLETED&q=HSG-...&limit=100
`{items:[{id, reference, state, sme:{id, legal_name}, beneficiary_name, usd_amount, total_ngn, rate, provider_name|null, current_step, created_at, completed_at, settlement_seconds|null}]}`

### GET /ops/transfers/:id
```json
{
  "transfer": {"id","reference","state","current_step","failure_reason","held_rule","purpose","travel_rule":{...},
               "usd_amount","principal_ngn","fee_ngn","total_ngn","rate","treasury_wallet",
               "timestamps":{"created_at","screening_at","held_at","reserved_at","onchain_pending_at","onchain_confirmed_at","payout_pending_at","completed_at","reversing_at","reversed_at","declined_at"}},
  "sme": {"id","legal_name","kyb_status"},
  "beneficiary": {"id","name","country","bank_name","account_number","swift_bic","address","screening_status"},
  "quote": {"id","rate","reference_rate","expires_at"},
  "saga_steps": [{"id","step","attempt","status","started_at","ended_at","error"}],
  "compliance_checks": [{"id","gate","result","detail","created_at"}],
  "journal_entries": [{"seq","reference","event","created_at","entry_hash","prev_hash","lines":[{"account_code","side","amount","currency"}]}],
  "chain_transactions": [{"id","kind","from_address","to_address","token_amount","tx_hash","explorer_url","nonce","status","block_number","confirmations","gas_used","created_at","confirmed_at"}],
  "payout_order": {"id","provider":{"id","name","adapter"},"usd_amount","rate","score","status","external_ref","failure","created_at","paid_at"} | null
}
```

### POST /ops/transfers/:id/retry → `{ok:true, step}` re-enqueues current step with a fresh job id.

### GET /ops/review
`{held_transfers:[{id, reference, sme:{id,legal_name}, beneficiary:{name,country}, usd_amount, rule, reason, travel_rule, held_at}], kyb_pending:[{id, legal_name, rc_number, country, address, created_at}]}`

### POST /ops/review/:id/decision   (`:id` = transfer id OR sme id)
`{decision:"approve"|"reject", reason?}`. Transfer approve → status RESERVED path resumes (enqueue RESERVE); reject → DECLINED with reason (nothing held yet → no entry). SME approve → screens legal name vs watchlist: clean → VERIFIED + PASS check; match → REJECTED + FAIL check (TC02). Returns `{ok:true, result}`.

### GET /ops/ledger
`{trial_balance:{NGN:"0",USD:"0",ok:true}, accounts:[{code,name,type,currency,debit,credit,net}], entries:[{seq,reference,event,created_at,prev_hash,entry_hash,lines:[...]}] (last 50), entry_count}` — accounts aggregate SME 2000-*/2100-* into single "2000"/"2100" rows.

### GET /ops/ledger/entries?page=1&page_size=25&q=
Paginated journal, newest first (page_size 1–200; `q` = case-insensitive match on reference). `{items:[entry…], total, page, page_size, total_pages}`

### GET /ops/treasury
Live on-chain balances: `{wallets:[{label, kind:"TREASURY"|"PROVIDER", address, provider_name, balance_cents, tx_sent, tx_received}], treasury_onchain_cents, ledger_1100_cents, variance_cents, token, chain_error, read_at}`

### POST /ops/ledger/verify → `{ok, broken_at: null|"1049", checked}`

### POST /ops/reconcile → `{ledger_1100_cents, onchain_cents, variance_cents, wallets:[{address,label,balance_cents}], checked_at}`

### Simulators (OPERATOR)
- `POST /sim/nip-inflow` `{account_number, amount, sender_name, session_id?}` → `{ok, entry:{seq,reference}, balance:{available,held}}` (amount kobo string; session_id generated if absent; duplicate session_id is a no-op)
- `GET /sim/providers` → `{items:[{id,name,rate,capacity_usd,reliability,payout_delay_ms,adapter,active,wallet_address}]}`
- `PUT /sim/providers/:id` `{rate?, capacity_usd?, reliability?, payout_delay_ms?, active?}` → provider
- `GET /sim/faults` → `{payoutHardFail, chainDelaySeconds, providersOutOfCapacity}`; `PUT /sim/faults` partial → same
- `GET /sim/smes` → `{items:[{id, legal_name, kyb_status, account_number}]}` (for the fund form picker)
- `POST /sim/webhook-sink` (public) logs body to webhook_events; `GET /sim/webhook-events` → `{items:[...]}` last 50
