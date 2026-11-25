/**
 * The fiat boundary test (PRD "Idempotency and the fiat boundary").
 *
 * Every SME response is built by src/fiat/sme-serializer.ts. We feed it fixtures where EVERY internal
 * column is populated with crypto-side data (treasury wallet, tx hash, provider reference rate ...)
 * and assert that no key and no value of the output contains a forbidden word.
 * If someone adds a field to the serializer that leaks, this test fails.
 */
import { Beneficiary, Quote, SmeAccount, Transfer, User, VirtualAccount } from '@prisma/client';
import {
  buildTimeline, serializeBalance, serializeBeneficiary, serializeMe, serializeQuote, serializeTransfer, serializeTransferAccepted,
} from '../src/modules/fiat/sme-serializer';
import { WebhookService } from '../src/modules/sim/webhook.service';

const FORBIDDEN = ['tx_hash', 'hash', 'wallet', 'provider', 'token', 'chain', 'gas', 'usdc', 'bridge'];

/** Collect every key and every leaf value (as text) in a JSON value. */
function walk(v: unknown, out: { keys: string[]; values: string[] } = { keys: [], values: [] }) {
  if (Array.isArray(v)) v.forEach((x) => walk(x, out));
  else if (v && typeof v === 'object') for (const [k, x] of Object.entries(v)) { out.keys.push(k); walk(x, out); }
  else if (v !== null && v !== undefined) out.values.push(String(v));
  return out;
}
function expectNoLeak(body: unknown) {
  const json = JSON.parse(JSON.stringify(body, (_k, v) => (typeof v === 'bigint' ? v.toString() : v)));
  const { keys, values } = walk(json);
  for (const word of FORBIDDEN) {
    for (const k of keys) expect({ key: k, word, leaks: k.toLowerCase().includes(word) }).toEqual({ key: k, word, leaks: false });
    for (const val of values) expect({ value: val, word, leaks: val.toLowerCase().includes(word) }).toEqual({ value: val, word, leaks: false });
  }
}

const t0 = new Date('2026-11-23T09:14:02.000Z');
const at = (s: number) => new Date(t0.getTime() + s * 1000);

const sme: SmeAccount = {
  id: 'sme_01JADEBAYO00000000000001', legalName: 'Adebayo Imports Ltd', country: 'NG', address: '14 Broad Street, Lagos Island',
  rcNumber: 'RC1234567', kybStatus: 'VERIFIED', webhookUrl: 'https://wallet-provider.example/chain-hook', webhookSecret: 'whsec_token_hash',
  createdAt: t0,
};
const user: User = { id: 'usr_01JFUNMI000000000000000001', email: 'funmi@adebayoimports.ng', passwordHash: '$2a$10$hashhashhash', role: 'SME', smeId: sme.id, createdAt: t0 };
const va: VirtualAccount = { id: 'va_01J0000000000000000000001', smeId: sme.id, accountNumber: '9012345678', bankName: 'Wema Bank', accountName: 'HSG / Adebayo Imports Ltd', createdAt: t0 };
const ben: Beneficiary = {
  id: 'bn_01JSHENZHEN00000000000001', smeId: sme.id, name: 'Shenzhen Brightway Electronics', country: 'CN', bankName: 'Bank of China',
  accountNumber: '6222021234566789', swiftBic: 'BKCHCNBJ', address: '88 Futian Road, Shenzhen', currency: 'USD',
  payoutRail: 'bridge_wire', screeningStatus: 'CLEARED',
  screeningDetail: { provider: 'watchlist', token_set: true, chain: 'x', wallet: '0xabc' } as any, createdAt: t0,
};
const quote: Quote = {
  id: 'qt_01JQUOTE0000000000000001', smeId: sme.id, usdAmount: 100000n, rate: '1580.00', principalNgn: 158000000n, feeNgn: 750000n,
  totalNgn: 158750000n, referenceRate: '1572.14 (provider usdc bridge)', expiresAt: at(60), usedAt: at(5), createdAt: t0,
};
const full: Transfer = {
  id: 'tr_01JTRANSFER0000000000001', reference: 'HSG-20261123-000142', smeId: sme.id, beneficiaryId: ben.id, quoteId: quote.id,
  status: 'COMPLETED', purpose: 'Payment for goods, invoice INV-2291',
  travelRule: { originator: { name: 'Adebayo', account: '9012345678', address: 'Lagos', wallet: '0xdead' }, beneficiary: { name: 'x', account: 'y', address: 'z' } } as any,
  idempotencyKey: '6f1c0c1e-token', requestHash: 'deadbeefhash', usdAmount: 100000n, rate: '1580.00', principalNgn: 158000000n, feeNgn: 750000n,
  totalNgn: 158750000n, treasuryWallet: '0x70997970C51812dc3A010C7d01b50e0d17dc79C8', failureReason: null, heldRule: null, currentStep: 'FINALISE',
  createdAt: t0, updatedAt: at(40), screeningAt: at(1), heldAt: null, reservedAt: at(2), onchainPendingAt: at(3), onchainConfirmedAt: at(10),
  payoutPendingAt: at(11), completedAt: at(40), reversingAt: null, reversedAt: null, declinedAt: null,
};
const withBen = (t: Partial<Transfer>) => ({ ...full, ...t, beneficiary: ben });

describe('fiat boundary: SME serializers never leak crypto-side fields', () => {
  it('GET /me', () => expectNoLeak(serializeMe(user, sme, va)));
  it('GET /balance', () => expectNoLeak(serializeBalance({ available: 500000000n, held: 0n })));
  it('GET/POST /beneficiaries', () => expectNoLeak({ items: [serializeBeneficiary(ben)] }));
  it('POST /quotes (reference_rate is never exposed)', () => {
    const q = serializeQuote(quote);
    expectNoLeak(q);
    expect(Object.keys(q).sort()).toEqual(['created_at', 'expires_at', 'fee_ngn', 'id', 'principal_ngn', 'rate', 'total_ngn', 'usd_amount']);
  });

  it('GET /transfers/:id for every internal state (fully-populated row)', () => {
    const states: Transfer['status'][] = ['CREATED', 'SCREENING', 'HELD', 'RESERVED', 'ONCHAIN_PENDING', 'ONCHAIN_CONFIRMED', 'PAYOUT_PENDING', 'COMPLETED', 'REVERSING', 'REVERSED', 'DECLINED'];
    for (const status of states) {
      expectNoLeak(serializeTransfer(withBen({ status })));
      expectNoLeak(serializeTransferAccepted(withBen({ status })));
    }
  });

  it('a technical failure_reason written by the saga is replaced with plain English', () => {
    const r = serializeTransfer(withBen({ status: 'REVERSED', completedAt: null, failureReason: 'provider-2 payout failed after chain tx 0xabc; gas too low' }));
    expectNoLeak(r);
    expect(r.failure_reason).toBe('The receiving bank could not accept this payment. Your naira has been returned.');
    expect(r.ngn_returned).toBe('158750000');
  });

  it('outbound webhook body (same serializer) does not leak', async () => {
    let sent: string | undefined;
    const prisma: any = {
      transfer: { findUnique: async () => ({ ...withBen({}), sme: { ...sme, webhookUrl: 'http://sink.test/hook' } }) },
      webhookEvent: { create: async ({ data }: any) => { sent = JSON.stringify(data.payload); return data; } },
    };
    const realFetch = global.fetch;
    (global as any).fetch = async () => ({ status: 200 });
    try { await new WebhookService(prisma).notifyTransfer(full.id, 'transfer.completed'); } finally { (global as any).fetch = realFetch; }
    expect(sent).toBeDefined();
    expectNoLeak(JSON.parse(sent!));
  });
});

describe('SME transfer shape', () => {
  it('matches the contract keys exactly', () => {
    const r = serializeTransfer(withBen({}));
    expect(Object.keys(r).sort()).toEqual([
      'beneficiary', 'completed_at', 'created_at', 'failure_reason', 'fee_ngn', 'id', 'ngn_debited', 'ngn_returned', 'purpose',
      'rate', 'reference', 'status', 'timeline', 'usd_amount',
    ]);
    expect(Object.keys(r.beneficiary).sort()).toEqual(['account_number_masked', 'bank_name', 'country', 'id', 'name']);
    expect(r.beneficiary.account_number_masked).toBe('••••6789');
    expect(r.status).toBe('Completed');
    expect(r.ngn_debited).toBe('158750000');
  });

  const states = (t: Partial<Transfer>) => buildTimeline({ ...full, ...t }).map((s) => s.state);
  it('timeline: processing / held / declined / reversed / completed', () => {
    const fresh = { reservedAt: null, onchainConfirmedAt: null, completedAt: null };
    expect(states({ status: 'SCREENING', ...fresh })).toEqual(['done', 'current', 'pending', 'pending']);
    expect(states({ status: 'HELD', ...fresh })).toEqual(['done', 'current', 'pending', 'pending']);
    expect(states({ status: 'DECLINED', ...fresh })).toEqual(['done', 'failed', 'pending', 'pending']);
    expect(states({ status: 'ONCHAIN_PENDING', onchainConfirmedAt: null, completedAt: null })).toEqual(['done', 'done', 'current', 'pending']);
    expect(states({ status: 'REVERSED', completedAt: null })).toEqual(['done', 'done', 'done', 'failed']);
    expect(states({ status: 'COMPLETED' })).toEqual(['done', 'done', 'done', 'done']);
  });

  it('accepted (202) snapshot is stable whatever the current state', () => {
    expect(serializeTransferAccepted(withBen({ status: 'COMPLETED' }))).toEqual(serializeTransferAccepted(withBen({ status: 'CREATED', reservedAt: null })));
    expect(serializeTransferAccepted(withBen({})).status).toBe('Processing');
  });
});
