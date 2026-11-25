/**
 * THE fiat boundary. Every SME-facing response (anything outside /api/ops and /api/sim) is built here,
 * by whitelisting fields. Nothing is ever spread from a database row, so new columns (treasury wallet,
 * provider, tx hash ...) can never leak to the SME by accident. test/fiat-boundary.spec.ts enforces it.
 */
import { Beneficiary, Quote, SmeAccount, Transfer, User, VirtualAccount } from '@prisma/client';
import { toSmeStatus } from '../../common/status-map';

const iso = (d: Date | null | undefined): string | null => (d ? d.toISOString() : null);

/** "6222334567" -> "••••4567" */
export function maskAccount(accountNumber: string): string {
  return `••••${accountNumber.slice(-4)}`;
}

/**
 * Words the SME must never see. If a stored free-text field (failure_reason, written by the saga)
 * contains one of these, the serializer replaces it with a safe default sentence.
 */
export const FORBIDDEN_SME_WORDS = ['tx_hash', 'hash', 'wallet', 'provider', 'token', 'chain', 'gas', 'usdc', 'bridge', 'crypto', 'stablecoin', 'onchain'];
export function isSmeSafeText(s: string): boolean {
  const lower = s.toLowerCase();
  return !FORBIDDEN_SME_WORDS.some((w) => lower.includes(w));
}

// ---------- /me ----------

export function serializeMe(user: Pick<User, 'id' | 'email'>, sme: SmeAccount | null, va: VirtualAccount | null) {
  return {
    id: user.id,
    email: user.email,
    sme: sme
      ? { id: sme.id, legal_name: sme.legalName, kyb_status: sme.kybStatus, address: sme.address, country: sme.country }
      : null,
    virtual_account: va
      ? { account_number: va.accountNumber, bank_name: va.bankName, account_name: va.accountName }
      : null,
  };
}

// ---------- /balance ----------

export function serializeBalance(b: { available: bigint; held: bigint }) {
  return { currency: 'NGN' as const, available: b.available.toString(), held: b.held.toString() };
}

// ---------- /beneficiaries ----------

export function serializeBeneficiary(b: Beneficiary) {
  return {
    id: b.id,
    name: b.name,
    country: b.country,
    bank_name: b.bankName,
    account_number_masked: maskAccount(b.accountNumber),
    swift_bic: b.swiftBic ?? null,
    address: b.address, // postal address
    currency: b.currency,
    screening_status: b.screeningStatus,
    created_at: iso(b.createdAt),
  };
}

// ---------- /quotes ----------

export function serializeQuote(q: Quote) {
  // reference_rate is deliberately NOT exposed (ops-only).
  return {
    id: q.id,
    usd_amount: q.usdAmount.toString(),
    rate: q.rate,
    principal_ngn: q.principalNgn.toString(),
    fee_ngn: q.feeNgn.toString(),
    total_ngn: q.totalNgn.toString(),
    expires_at: iso(q.expiresAt),
    created_at: iso(q.createdAt),
  };
}

// ---------- /transfers ----------

type TimelineState = 'done' | 'current' | 'pending' | 'failed';
interface TimelineStep { key: 'received' | 'checks' | 'sent' | 'delivered'; label: string; at: string | null; state: TimelineState; }

const DEFAULT_REVERSED_REASON = 'The receiving bank could not accept this payment. Your naira has been returned.';
const DEFAULT_DECLINED_REASON = 'This payment did not pass our compliance checks.';

/**
 * Four SME steps mapped from internal timestamps (contract "Timeline mapping"):
 *  received  = created_at
 *  checks    = reserved_at        (failed if DECLINED; current while HELD)
 *  sent      = onchain_confirmed_at
 *  delivered = completed_at
 * The first step without a timestamp is `current` while processing, or `failed` when the
 * transfer ended REVERSED / DECLINED; everything after it is `pending`.
 */
export function buildTimeline(t: Transfer): TimelineStep[] {
  const steps: TimelineStep[] = [
    { key: 'received', label: 'Received', at: iso(t.createdAt), state: 'pending' },
    { key: 'checks', label: 'Checks passed', at: iso(t.reservedAt), state: 'pending' },
    { key: 'sent', label: 'Sent', at: iso(t.onchainConfirmedAt), state: 'pending' },
    { key: 'delivered', label: 'Delivered', at: iso(t.completedAt), state: 'pending' },
  ];
  const failedEnd = t.status === 'REVERSED' || t.status === 'DECLINED';
  let reachedOpenStep = false;
  for (const s of steps) {
    if (reachedOpenStep) { s.state = 'pending'; continue; }
    if (s.at) { s.state = 'done'; continue; }
    reachedOpenStep = true;
    s.state = failedEnd ? 'failed' : 'current';
  }
  return steps;
}

export function serializeTransfer(t: Transfer & { beneficiary: Beneficiary }) {
  let failureReason: string | null = null;
  if (t.status === 'REVERSED') failureReason = t.failureReason && isSmeSafeText(t.failureReason) ? t.failureReason : DEFAULT_REVERSED_REASON;
  if (t.status === 'DECLINED') failureReason = t.failureReason && isSmeSafeText(t.failureReason) ? t.failureReason : DEFAULT_DECLINED_REASON;
  // Naira is only "returned" if it was held in the first place (RESERVE posted).
  const ngnReturned = t.status === 'REVERSED' && t.reservedAt ? t.totalNgn.toString() : null;

  return {
    id: t.id,
    reference: t.reference,
    status: toSmeStatus(t.status),
    usd_amount: t.usdAmount.toString(),
    ngn_debited: t.totalNgn.toString(),
    rate: t.rate,
    fee_ngn: t.feeNgn.toString(),
    purpose: t.purpose,
    beneficiary: {
      id: t.beneficiary.id,
      name: t.beneficiary.name,
      country: t.beneficiary.country,
      bank_name: t.beneficiary.bankName,
      account_number_masked: maskAccount(t.beneficiary.accountNumber),
    },
    failure_reason: failureReason,
    ngn_returned: ngnReturned,
    created_at: iso(t.createdAt),
    completed_at: iso(t.completedAt),
    timeline: buildTimeline(t),
  };
}

/**
 * The 202 body of POST /transfers, as at acceptance. Idempotent replays return exactly this
 * (same key + same body -> identical response), even if the saga has moved the transfer on since.
 */
export function serializeTransferAccepted(t: Transfer & { beneficiary: Beneficiary }) {
  return serializeTransfer({
    ...t,
    status: 'CREATED',
    failureReason: null,
    screeningAt: null, heldAt: null, reservedAt: null, onchainPendingAt: null, onchainConfirmedAt: null,
    payoutPendingAt: null, completedAt: null, reversingAt: null, reversedAt: null, declinedAt: null,
  });
}
