-- CreateEnum
CREATE TYPE "Role" AS ENUM ('SME', 'OPERATOR');

-- CreateEnum
CREATE TYPE "KybStatus" AS ENUM ('PENDING', 'VERIFIED', 'REJECTED');

-- CreateEnum
CREATE TYPE "ScreeningStatus" AS ENUM ('CLEARED', 'BLOCKED');

-- CreateEnum
CREATE TYPE "TransferState" AS ENUM ('CREATED', 'SCREENING', 'HELD', 'RESERVED', 'ONCHAIN_PENDING', 'ONCHAIN_CONFIRMED', 'PAYOUT_PENDING', 'COMPLETED', 'REVERSING', 'REVERSED', 'DECLINED');

-- CreateEnum
CREATE TYPE "LedgerAccountType" AS ENUM ('ASSET', 'LIABILITY', 'CLEARING', 'INCOME');

-- CreateEnum
CREATE TYPE "Side" AS ENUM ('DEBIT', 'CREDIT');

-- CreateEnum
CREATE TYPE "CheckResult" AS ENUM ('PASS', 'FAIL', 'HOLD');

-- CreateEnum
CREATE TYPE "WalletKind" AS ENUM ('TREASURY', 'PROVIDER');

-- CreateEnum
CREATE TYPE "ChainTxKind" AS ENUM ('SEND', 'RETURN', 'ADJUSTMENT');

-- CreateEnum
CREATE TYPE "ChainTxStatus" AS ENUM ('PENDING', 'CONFIRMED', 'FAILED');

-- CreateEnum
CREATE TYPE "PayoutStatus" AS ENUM ('CREATED', 'SUBMITTED', 'PAID', 'FAILED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "StepStatus" AS ENUM ('RUNNING', 'COMPLETED', 'FAILED', 'COMPENSATED');

-- CreateTable
CREATE TABLE "users" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "password_hash" TEXT NOT NULL,
    "role" "Role" NOT NULL,
    "sme_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sme_accounts" (
    "id" TEXT NOT NULL,
    "legal_name" TEXT NOT NULL,
    "country" TEXT NOT NULL DEFAULT 'NG',
    "address" TEXT NOT NULL,
    "rc_number" TEXT,
    "kyb_status" "KybStatus" NOT NULL DEFAULT 'PENDING',
    "webhook_url" TEXT,
    "webhook_secret" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "sme_accounts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "virtual_accounts" (
    "id" TEXT NOT NULL,
    "sme_id" TEXT NOT NULL,
    "account_number" TEXT NOT NULL,
    "bank_name" TEXT NOT NULL,
    "account_name" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "virtual_accounts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "beneficiaries" (
    "id" TEXT NOT NULL,
    "sme_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "country" TEXT NOT NULL,
    "bank_name" TEXT NOT NULL,
    "account_number" TEXT NOT NULL,
    "swift_bic" TEXT,
    "address" TEXT NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'USD',
    "payout_rail" TEXT,
    "screening_status" "ScreeningStatus" NOT NULL,
    "screening_detail" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "beneficiaries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "quotes" (
    "id" TEXT NOT NULL,
    "sme_id" TEXT NOT NULL,
    "usd_amount" BIGINT NOT NULL,
    "rate" TEXT NOT NULL,
    "principal_ngn" BIGINT NOT NULL,
    "fee_ngn" BIGINT NOT NULL,
    "total_ngn" BIGINT NOT NULL,
    "reference_rate" TEXT,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "used_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "quotes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "wallets" (
    "id" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "address" TEXT NOT NULL,
    "kind" "WalletKind" NOT NULL,
    "key_index" INTEGER NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "wallets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "transfers" (
    "id" TEXT NOT NULL,
    "reference" TEXT NOT NULL,
    "sme_id" TEXT NOT NULL,
    "beneficiary_id" TEXT NOT NULL,
    "quote_id" TEXT NOT NULL,
    "status" "TransferState" NOT NULL DEFAULT 'CREATED',
    "purpose" TEXT NOT NULL,
    "travel_rule" JSONB NOT NULL,
    "idempotency_key" TEXT NOT NULL,
    "request_hash" TEXT NOT NULL,
    "usd_amount" BIGINT NOT NULL,
    "rate" TEXT NOT NULL,
    "principal_ngn" BIGINT NOT NULL,
    "fee_ngn" BIGINT NOT NULL,
    "total_ngn" BIGINT NOT NULL,
    "treasury_wallet" TEXT,
    "failure_reason" TEXT,
    "held_rule" TEXT,
    "current_step" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "screening_at" TIMESTAMP(3),
    "held_at" TIMESTAMP(3),
    "reserved_at" TIMESTAMP(3),
    "onchain_pending_at" TIMESTAMP(3),
    "onchain_confirmed_at" TIMESTAMP(3),
    "payout_pending_at" TIMESTAMP(3),
    "completed_at" TIMESTAMP(3),
    "reversing_at" TIMESTAMP(3),
    "reversed_at" TIMESTAMP(3),
    "declined_at" TIMESTAMP(3),

    CONSTRAINT "transfers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ledger_accounts" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "type" "LedgerAccountType" NOT NULL,
    "currency" TEXT NOT NULL,
    "owner_sme_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ledger_accounts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "journal_entries" (
    "id" TEXT NOT NULL,
    "seq" BIGINT NOT NULL,
    "reference" TEXT NOT NULL,
    "event" TEXT NOT NULL,
    "transfer_id" TEXT,
    "memo" TEXT,
    "prev_hash" TEXT NOT NULL,
    "entry_hash" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "journal_entries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "journal_lines" (
    "id" TEXT NOT NULL,
    "entry_id" TEXT NOT NULL,
    "account_code" TEXT NOT NULL,
    "side" "Side" NOT NULL,
    "amount" BIGINT NOT NULL,
    "currency" TEXT NOT NULL,

    CONSTRAINT "journal_lines_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ledger_head" (
    "id" INTEGER NOT NULL DEFAULT 1,
    "last_seq" BIGINT NOT NULL,
    "last_hash" TEXT NOT NULL,

    CONSTRAINT "ledger_head_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "compliance_checks" (
    "id" TEXT NOT NULL,
    "transfer_id" TEXT,
    "sme_id" TEXT,
    "subject" TEXT NOT NULL DEFAULT 'TRANSFER',
    "gate" TEXT NOT NULL,
    "result" "CheckResult" NOT NULL,
    "detail" JSONB NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "compliance_checks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_log" (
    "id" TEXT NOT NULL,
    "actor" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "entity" TEXT NOT NULL,
    "entity_id" TEXT NOT NULL,
    "data" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_log_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "chain_transactions" (
    "id" TEXT NOT NULL,
    "transfer_id" TEXT,
    "kind" "ChainTxKind" NOT NULL,
    "from_address" TEXT NOT NULL,
    "to_address" TEXT NOT NULL,
    "token_amount" BIGINT NOT NULL,
    "tx_hash" TEXT NOT NULL,
    "nonce" INTEGER NOT NULL,
    "status" "ChainTxStatus" NOT NULL DEFAULT 'PENDING',
    "block_number" BIGINT,
    "gas_used" BIGINT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "confirmed_at" TIMESTAMP(3),

    CONSTRAINT "chain_transactions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "liquidity_providers" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "rate" TEXT NOT NULL,
    "capacity_usd" BIGINT NOT NULL,
    "reliability" DOUBLE PRECISION NOT NULL,
    "payout_delay_ms" INTEGER NOT NULL DEFAULT 3000,
    "wallet_address" TEXT NOT NULL,
    "adapter" TEXT NOT NULL DEFAULT 'SIMULATED',
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "liquidity_providers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payout_orders" (
    "id" TEXT NOT NULL,
    "transfer_id" TEXT NOT NULL,
    "provider_id" TEXT NOT NULL,
    "usd_amount" BIGINT NOT NULL,
    "rate" TEXT NOT NULL,
    "score" DOUBLE PRECISION,
    "status" "PayoutStatus" NOT NULL DEFAULT 'CREATED',
    "external_ref" TEXT,
    "failure" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "paid_at" TIMESTAMP(3),

    CONSTRAINT "payout_orders_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "saga_steps" (
    "id" TEXT NOT NULL,
    "transfer_id" TEXT NOT NULL,
    "step" TEXT NOT NULL,
    "attempt" INTEGER NOT NULL,
    "status" "StepStatus" NOT NULL,
    "started_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "ended_at" TIMESTAMP(3),
    "error" TEXT,

    CONSTRAINT "saga_steps_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "watchlist" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "country" TEXT NOT NULL,
    "source" TEXT NOT NULL DEFAULT 'SEED',

    CONSTRAINT "watchlist_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "webhook_events" (
    "id" TEXT NOT NULL,
    "sme_id" TEXT,
    "direction" TEXT NOT NULL DEFAULT 'OUTBOUND',
    "event" TEXT NOT NULL,
    "url" TEXT,
    "payload" JSONB NOT NULL,
    "signature" TEXT,
    "status" INTEGER,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "webhook_events_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE UNIQUE INDEX "virtual_accounts_sme_id_key" ON "virtual_accounts"("sme_id");

-- CreateIndex
CREATE UNIQUE INDEX "virtual_accounts_account_number_key" ON "virtual_accounts"("account_number");

-- CreateIndex
CREATE INDEX "beneficiaries_sme_id_idx" ON "beneficiaries"("sme_id");

-- CreateIndex
CREATE INDEX "quotes_sme_id_idx" ON "quotes"("sme_id");

-- CreateIndex
CREATE UNIQUE INDEX "wallets_address_key" ON "wallets"("address");

-- CreateIndex
CREATE UNIQUE INDEX "transfers_reference_key" ON "transfers"("reference");

-- CreateIndex
CREATE UNIQUE INDEX "transfers_quote_id_key" ON "transfers"("quote_id");

-- CreateIndex
CREATE INDEX "transfers_status_idx" ON "transfers"("status");

-- CreateIndex
CREATE INDEX "transfers_sme_id_created_at_idx" ON "transfers"("sme_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "transfers_sme_id_idempotency_key_key" ON "transfers"("sme_id", "idempotency_key");

-- CreateIndex
CREATE UNIQUE INDEX "ledger_accounts_code_key" ON "ledger_accounts"("code");

-- CreateIndex
CREATE UNIQUE INDEX "journal_entries_seq_key" ON "journal_entries"("seq");

-- CreateIndex
CREATE UNIQUE INDEX "journal_entries_reference_key" ON "journal_entries"("reference");

-- CreateIndex
CREATE INDEX "journal_entries_transfer_id_idx" ON "journal_entries"("transfer_id");

-- CreateIndex
CREATE INDEX "journal_lines_account_code_idx" ON "journal_lines"("account_code");

-- CreateIndex
CREATE INDEX "journal_lines_entry_id_idx" ON "journal_lines"("entry_id");

-- CreateIndex
CREATE INDEX "compliance_checks_transfer_id_idx" ON "compliance_checks"("transfer_id");

-- CreateIndex
CREATE INDEX "compliance_checks_sme_id_idx" ON "compliance_checks"("sme_id");

-- CreateIndex
CREATE INDEX "audit_log_entity_entity_id_idx" ON "audit_log"("entity", "entity_id");

-- CreateIndex
CREATE UNIQUE INDEX "chain_transactions_tx_hash_key" ON "chain_transactions"("tx_hash");

-- CreateIndex
CREATE UNIQUE INDEX "chain_transactions_transfer_id_kind_key" ON "chain_transactions"("transfer_id", "kind");

-- CreateIndex
CREATE UNIQUE INDEX "liquidity_providers_name_key" ON "liquidity_providers"("name");

-- CreateIndex
CREATE UNIQUE INDEX "payout_orders_transfer_id_key" ON "payout_orders"("transfer_id");

-- CreateIndex
CREATE INDEX "saga_steps_transfer_id_step_idx" ON "saga_steps"("transfer_id", "step");

-- AddForeignKey
ALTER TABLE "users" ADD CONSTRAINT "users_sme_id_fkey" FOREIGN KEY ("sme_id") REFERENCES "sme_accounts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "virtual_accounts" ADD CONSTRAINT "virtual_accounts_sme_id_fkey" FOREIGN KEY ("sme_id") REFERENCES "sme_accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "beneficiaries" ADD CONSTRAINT "beneficiaries_sme_id_fkey" FOREIGN KEY ("sme_id") REFERENCES "sme_accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "quotes" ADD CONSTRAINT "quotes_sme_id_fkey" FOREIGN KEY ("sme_id") REFERENCES "sme_accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transfers" ADD CONSTRAINT "transfers_sme_id_fkey" FOREIGN KEY ("sme_id") REFERENCES "sme_accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transfers" ADD CONSTRAINT "transfers_beneficiary_id_fkey" FOREIGN KEY ("beneficiary_id") REFERENCES "beneficiaries"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transfers" ADD CONSTRAINT "transfers_quote_id_fkey" FOREIGN KEY ("quote_id") REFERENCES "quotes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "journal_lines" ADD CONSTRAINT "journal_lines_entry_id_fkey" FOREIGN KEY ("entry_id") REFERENCES "journal_entries"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "compliance_checks" ADD CONSTRAINT "compliance_checks_transfer_id_fkey" FOREIGN KEY ("transfer_id") REFERENCES "transfers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "chain_transactions" ADD CONSTRAINT "chain_transactions_transfer_id_fkey" FOREIGN KEY ("transfer_id") REFERENCES "transfers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payout_orders" ADD CONSTRAINT "payout_orders_transfer_id_fkey" FOREIGN KEY ("transfer_id") REFERENCES "transfers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payout_orders" ADD CONSTRAINT "payout_orders_provider_id_fkey" FOREIGN KEY ("provider_id") REFERENCES "liquidity_providers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "saga_steps" ADD CONSTRAINT "saga_steps_transfer_id_fkey" FOREIGN KEY ("transfer_id") REFERENCES "transfers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
