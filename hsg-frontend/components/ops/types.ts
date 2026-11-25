/** Operator console API shapes (docs/API-CONTRACT.md, "Operator" and "Simulators"). Money = minor-unit strings. */
import type { TransferState } from "@/lib/types";

export type { TransferState };

/* ---------- O1 overview ---------- */
export interface OpsOverview {
  counts_today: Partial<Record<TransferState, number>>;
  p95_settlement_seconds: number | null;
  completed_today: number;
  total_reversed_ngn: string;
  treasury: { onchain_cents: string; ledger_1100_cents: string; variance_cents: string };
}

/* ---------- O2 transfers ---------- */
export interface OpsTransferRow {
  id: string;
  reference: string;
  state: TransferState;
  sme: { id: string; legal_name: string };
  beneficiary_name: string;
  usd_amount: string;
  total_ngn: string;
  rate: string;
  provider_name: string | null;
  current_step: string | null;
  created_at: string;
  completed_at: string | null;
  settlement_seconds: number | null;
}

export interface SagaStepRow { id: string; step: string; attempt: number; status: string; started_at: string | null; ended_at: string | null; error: string | null }
export interface ComplianceCheckRow { id: string; gate: string; result: "PASS" | "FAIL" | "HOLD" | string; detail: unknown; created_at: string }
export interface JournalLine { account_code: string; side: "DEBIT" | "CREDIT" | "DR" | "CR" | string; amount: string; currency: "NGN" | "USD" | string }
export interface JournalEntry { seq: string | number; reference: string; event: string; created_at: string; entry_hash: string; prev_hash: string; lines: JournalLine[] }
export interface ChainTx {
  id: string; kind: "SEND" | "RETURN" | string; from_address: string; to_address: string; token_amount: string;
  tx_hash: string | null; explorer_url: string | null; nonce: number | string | null; status: string;
  block_number: number | string | null; confirmations: number | null; gas_used: string | number | null;
  created_at: string; confirmed_at: string | null;
}
export interface PayoutOrder {
  id: string; provider: { id: string; name: string; adapter: string }; usd_amount: string; rate: string; score: number | string | null;
  status: string; external_ref: string | null; failure: string | null; created_at: string; paid_at: string | null;
}
export type TravelRule = Record<string, unknown> | null;

export interface OpsTransferDetail {
  transfer: {
    id: string; reference: string; state: TransferState; current_step: string | null; failure_reason: string | null; held_rule: string | null;
    purpose: string; travel_rule: TravelRule; usd_amount: string; principal_ngn: string; fee_ngn: string; total_ngn: string; rate: string;
    treasury_wallet: string | null; timestamps: Record<string, string | null>;
  };
  sme: { id: string; legal_name: string; kyb_status: string };
  beneficiary: { id: string; name: string; country: string; bank_name: string; account_number: string; swift_bic: string | null; address: string; screening_status: string };
  quote: { id: string; rate: string; reference_rate: string | null; expires_at: string } | null;
  saga_steps: SagaStepRow[];
  compliance_checks: ComplianceCheckRow[];
  journal_entries: JournalEntry[];
  chain_transactions: ChainTx[];
  payout_order: PayoutOrder | null;
}

/* ---------- O3 review ---------- */
export interface HeldTransfer {
  id: string; reference: string; sme: { id: string; legal_name: string }; beneficiary: { name: string; country: string };
  usd_amount: string; rule: string | null; reason: string | null; travel_rule: TravelRule; held_at: string | null;
}
export interface KybPending { id: string; legal_name: string; rc_number: string | null; country: string; address: string; created_at: string }
export interface ReviewQueue { held_transfers: HeldTransfer[]; kyb_pending: KybPending[] }
export interface DecisionResult { ok: boolean; result: unknown }

/* ---------- O4 ledger ---------- */
export interface LedgerAccount { code: string; name: string; type: string; currency: string; debit: string; credit: string; net: string }
export interface LedgerView {
  trial_balance: { NGN: string; USD: string; ok: boolean };
  accounts: LedgerAccount[];
  entries: JournalEntry[];
  entry_count: number | string;
}
export interface VerifyResult { ok: boolean; broken_at: string | null; checked: number | string }
export interface ReconcileResult {
  ledger_1100_cents: string; onchain_cents: string; variance_cents: string;
  wallets: { address: string; label: string; balance_cents: string }[]; checked_at: string;
}

export interface EntriesPage { items: JournalEntry[]; total: number; page: number; page_size: number; total_pages: number }
export interface TreasuryWallet {
  label: string; kind: "TREASURY" | "PROVIDER"; address: string; provider_name: string | null;
  balance_cents: string | null; tx_sent: number; tx_received: number;
}
export interface TreasuryView {
  wallets: TreasuryWallet[]; treasury_onchain_cents: string; ledger_1100_cents: string; variance_cents: string | null;
  token: string | null; chain_error: string | null; read_at: string;
}

/* ---------- O5 simulators ---------- */
export interface SimSme { id: string; legal_name: string; kyb_status: string; account_number: string }
export interface SimProvider {
  id: string; name: string; rate: string; capacity_usd: string; reliability: number | string; payout_delay_ms: number;
  adapter: string; active: boolean; wallet_address: string;
}
export interface Faults { payoutHardFail: boolean; chainDelaySeconds: number; providersOutOfCapacity: boolean }
export interface NipInflowResult { ok: boolean; entry: { seq: string | number; reference: string }; balance: { available: string; held: string } }
export interface WebhookEvent {
  id: string; direction?: string; event?: string; url?: string | null; payload?: unknown; status?: number | null;
  created_at?: string; createdAt?: string; [k: string]: unknown;
}
