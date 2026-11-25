/**
 * Liquidity: provider scoring, capacity routing (TC08), idempotent match/unmatch, payout adapters.
 * Runs against the real hsg_test database. Amounts are deliberately huge (trillions of cents) so the
 * only providers that can cover them are the ones this test creates: any other rows in hsg_test
 * (seeded providers, other agents' tests) are never eligible and cannot change the outcome.
 */
import { PrismaClient } from '@prisma/client';
import { ulid } from 'ulid';
import { LiquidityService } from '../src/modules/liquidity/liquidity.service';
import { SimulatedAdapter } from '../src/modules/liquidity/simulated-adapter';
import { BridgeAdapter } from '../src/modules/liquidity/bridge-adapter';
import { rankProviders } from '../src/modules/liquidity/scoring';
import { DomainError } from '../src/common/errors';

const prisma = new PrismaClient();
const faultState = { payoutHardFail: false, chainDelaySeconds: 0, providersOutOfCapacity: false };
// FaultsService stand-in: keeps the test off the shared Redis fault key.
const faults: any = { get: async () => ({ ...faultState }), set: async (p: any) => Object.assign(faultState, p) };
const simulated = new SimulatedAdapter(prisma as any, faults);
simulated.sleep = async () => undefined;
const bridge = new BridgeAdapter();
const liquidity = new LiquidityService(prisma as any, faults, simulated, bridge);

const run = ulid().toLowerCase();
const BIG = 1_000_000_000_000_000n; // 10^15 cents of capacity per test provider
const AMOUNT = 200_000_000_000_000n; // 2 * 10^14 cents: no real provider can cover this
const providerIds: string[] = [];
const transferIds: string[] = [];
let smeId = '';
let beneficiaryId = '';

async function makeProvider(name: string, rate: string, reliability: number, capacity = BIG) {
  const p = await prisma.liquidityProvider.create({
    data: { id: `lp_${ulid()}`, name: `${name}-${run}`, rate, reliability, capacityUsd: capacity, payoutDelayMs: 0, walletAddress: `0x${name.padEnd(40, '0').slice(0, 40)}` },
  });
  providerIds.push(p.id);
  return p;
}

async function makeTransfer(usd = AMOUNT) {
  const qid = `qt_${ulid()}`;
  await prisma.quote.create({ data: { id: qid, smeId, usdAmount: usd, rate: '1580.00', principalNgn: 1n, feeNgn: 1n, totalNgn: 2n, expiresAt: new Date(Date.now() + 60_000) } });
  const id = `tr_${ulid()}`;
  await prisma.transfer.create({
    data: { id, reference: `HSG-LIQ-${ulid()}`, smeId, beneficiaryId, quoteId: qid, purpose: 'test', travelRule: {}, idempotencyKey: id, requestHash: 'x', usdAmount: usd, rate: '1580.00', principalNgn: 1n, feeNgn: 1n, totalNgn: 2n },
  });
  transferIds.push(id);
  return id;
}

beforeAll(async () => {
  smeId = `sme_${ulid()}`;
  await prisma.smeAccount.create({ data: { id: smeId, legalName: `Liquidity Test ${run}`, address: 'Lagos', kybStatus: 'VERIFIED' } });
  beneficiaryId = `bn_${ulid()}`;
  await prisma.beneficiary.create({ data: { id: beneficiaryId, smeId, name: 'Test Supplier', country: 'CN', bankName: 'Bank', accountNumber: '123456789', address: 'Shenzhen', screeningStatus: 'CLEARED' } });
});

afterAll(async () => {
  await prisma.payoutOrder.deleteMany({ where: { transferId: { in: transferIds } } });
  await prisma.transfer.deleteMany({ where: { id: { in: transferIds } } });
  await prisma.quote.deleteMany({ where: { smeId } });
  await prisma.beneficiary.deleteMany({ where: { smeId } });
  await prisma.smeAccount.deleteMany({ where: { id: smeId } });
  await prisma.liquidityProvider.deleteMany({ where: { id: { in: providerIds } } });
  await prisma.$disconnect();
});

describe('provider scoring (pure)', () => {
  const c = (name: string, rate: string, reliability: number, capacityUsd: bigint) => ({ id: name, name, rate, reliability, capacityUsd });

  it('picks the provider with the best weighted score of rate 0.5, reliability 0.3, headroom 0.2', () => {
    const ranked = rankProviders([c('B', '1590.00', 0.99, 10_000n), c('A', '1575.00', 0.95, 10_000n), c('C', '1600.00', 0.8, 10_000n)], 100n);
    expect(ranked.map((r) => r.provider.name)).toEqual(['A', 'B', 'C']);
    // A: 0.5*1 + 0.3*0.95 + 0.2*1 = 0.985
    expect(ranked[0].score).toBeCloseTo(0.985, 4);
    // B: 0.5*(10/25) + 0.3*0.99 + 0.2*1 = 0.697
    expect(ranked[1].score).toBeCloseTo(0.697, 4);
  });

  it('reliability and headroom can outweigh a slightly better rate', () => {
    // A is cheapest but unreliable and can barely cover the amount.
    // A: 0.5*1 + 0.3*0.2 + 0.2*0.1 = 0.58;  B: 0.5*(20/25) + 0.3*0.99 + 0.2*1 = 0.897
    const ranked = rankProviders([c('A', '1575.00', 0.2, 100n), c('B', '1580.00', 0.99, 10_000n), c('C', '1600.00', 0.99, 10_000n)], 100n);
    expect(ranked[0].provider.name).toBe('B');
    expect(ranked[0].score).toBeCloseTo(0.897, 4);
  });

  it('excludes providers without capacity for the whole amount', () => {
    const ranked = rankProviders([c('A', '1575.00', 0.95, 99n), c('B', '1590.00', 0.9, 100n)], 100n);
    expect(ranked.map((r) => r.provider.name)).toEqual(['B']);
    expect(rankProviders([c('A', '1575.00', 0.95, 0n)], 100n)).toEqual([]);
  });
});

describe('LiquidityService (hsg_test)', () => {
  let A: any, B: any, C: any;
  beforeAll(async () => {
    A = await makeProvider('alpha', '1575.00', 0.95);
    B = await makeProvider('bravo', '1590.00', 0.99);
    C = await makeProvider('charlie', '1600.00', 0.8);
  });

  it('match picks the best provider, decrements capacity and creates a CREATED order; idempotent per transfer', async () => {
    const t = await makeTransfer();
    const choice = await liquidity.match(t, AMOUNT);
    expect(choice.providerId).toBe(A.id);
    expect(choice.score).toBeGreaterThan(0);

    const order = await prisma.payoutOrder.findUniqueOrThrow({ where: { transferId: t } });
    expect(order.status).toBe('CREATED');
    expect(order.providerId).toBe(A.id);
    expect(order.score).toBeCloseTo(choice.score, 4);
    expect((await prisma.liquidityProvider.findUniqueOrThrow({ where: { id: A.id } })).capacityUsd).toBe(BIG - AMOUNT);

    // Second MATCH for the same transfer: same order, capacity untouched.
    const again = await liquidity.match(t, AMOUNT);
    expect(again.providerId).toBe(A.id);
    expect(await prisma.payoutOrder.count({ where: { transferId: t } })).toBe(1);
    expect((await prisma.liquidityProvider.findUniqueOrThrow({ where: { id: A.id } })).capacityUsd).toBe(BIG - AMOUNT);
  });

  it('unmatch restores capacity exactly once and cancels the order', async () => {
    const t = await makeTransfer();
    await liquidity.match(t, AMOUNT);
    const before = (await prisma.liquidityProvider.findUniqueOrThrow({ where: { id: A.id } })).capacityUsd;
    await liquidity.unmatch(t);
    await liquidity.unmatch(t); // second call is a no-op
    const after = (await prisma.liquidityProvider.findUniqueOrThrow({ where: { id: A.id } })).capacityUsd;
    expect(after).toBe(before + AMOUNT);
    expect((await prisma.payoutOrder.findUniqueOrThrow({ where: { transferId: t } })).status).toBe('CANCELLED');
  });

  it('TC08 first run: best provider at capacity 0 routes to the next one', async () => {
    await prisma.liquidityProvider.update({ where: { id: A.id }, data: { capacityUsd: 0n } });
    const t = await makeTransfer();
    const choice = await liquidity.match(t, AMOUNT);
    expect(choice.providerId).toBe(B.id);
  });

  it('TC08 second run: all at capacity 0 -> hard NO_PROVIDER_CAPACITY, no order', async () => {
    await prisma.liquidityProvider.updateMany({ where: { id: { in: [A.id, B.id, C.id] } }, data: { capacityUsd: 0n } });
    const t = await makeTransfer();
    const err = await liquidity.match(t, AMOUNT).catch((e) => e);
    expect(err).toBeInstanceOf(DomainError);
    expect(err.code).toBe('NO_PROVIDER_CAPACITY');
    expect(err.transient).toBe(false);
    expect(await prisma.payoutOrder.count({ where: { transferId: t } })).toBe(0);
  });

  it('honours the providersOutOfCapacity fault switch (match and bestRate)', async () => {
    await prisma.liquidityProvider.updateMany({ where: { id: { in: [A.id, B.id, C.id] } }, data: { capacityUsd: BIG } });
    expect(await liquidity.bestRate(AMOUNT)).toBe('1575.00');
    faultState.providersOutOfCapacity = true;
    try {
      const t = await makeTransfer();
      await expect(liquidity.match(t, AMOUNT)).rejects.toMatchObject({ code: 'NO_PROVIDER_CAPACITY' });
      expect(await liquidity.bestRate(AMOUNT)).toBeNull();
    } finally {
      faultState.providersOutOfCapacity = false;
    }
  });

  it('inactive providers are never chosen', async () => {
    await prisma.liquidityProvider.update({ where: { id: A.id }, data: { active: false } });
    const t = await makeTransfer();
    expect((await liquidity.match(t, AMOUNT)).providerId).toBe(B.id);
    await prisma.liquidityProvider.update({ where: { id: A.id }, data: { active: true } });
  });
});

describe('payout adapters', () => {
  const req = (providerId: string) => ({
    orderId: 'po_1', transferId: 'tr_TEST', providerId, usdCents: 123_456n,
    beneficiary: { name: 'Shenzhen Ruiqi', accountNumber: '6222', bankName: 'ICBC', country: 'CN' },
    fromAddress: '0xabc', externalAccountId: 'ext_1',
  });

  it('SimulatedAdapter: success, transient (reliability roll) and hard (fault switch)', async () => {
    const p = await makeProvider('sim', '1580.00', 0.9);
    simulated.random = () => 0.5;
    const ok = await simulated.payout(req(p.id));
    expect(ok).toMatchObject({ ok: true });
    expect((ok as any).externalRef).toMatch(/^SIM-/);

    simulated.random = () => 0.95; // above reliability 0.9 -> temporary failure
    expect(await simulated.payout(req(p.id))).toMatchObject({ ok: false, hard: false });

    faultState.payoutHardFail = true;
    try {
      expect(await simulated.payout(req(p.id))).toMatchObject({ ok: false, hard: true });
    } finally {
      faultState.payoutHardFail = false;
      simulated.random = Math.random;
    }
  });

  it('BridgeAdapter builds the PRD POST /v0/transfers body and refuses to run unconfigured', async () => {
    const r = bridge.buildTransferRequest(req('lp_x'));
    expect(r.headers['Idempotency-Key']).toBe('tr_TEST');
    expect(r.url).toMatch(/\/v0\/transfers$/);
    expect(r.body.source).toEqual({ payment_rail: 'base', currency: 'usdc', from_address: '0xabc' });
    expect(r.body.destination).toEqual({ payment_rail: 'wire', currency: 'usd', external_account_id: 'ext_1', amount: '1234.56' });
    expect(r.body.on_behalf_of).toBeTruthy();
    const saved = { url: process.env.BRIDGE_API_URL, key: process.env.BRIDGE_API_KEY };
    process.env.BRIDGE_API_URL = ''; process.env.BRIDGE_API_KEY = '';
    await expect(bridge.payout(req('lp_x'))).rejects.toThrow('Bridge sandbox not configured');
    process.env.BRIDGE_API_URL = saved.url; process.env.BRIDGE_API_KEY = saved.key;
  });

  it('partnerFor routes by the provider adapter column', () => {
    expect(liquidity.partnerFor('SIMULATED').name).toBe('SIMULATED');
    expect(liquidity.partnerFor('BRIDGE').name).toBe('BRIDGE');
  });
});
