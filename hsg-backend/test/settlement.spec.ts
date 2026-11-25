/**
 * Settlement against the real local chain (anvil :8545, chain.local.json) and the hsg_test database.
 * Every send here is treasury-5 -> treasury-5 (a self-transfer of 1 cent) so on-chain balances never change
 * and reconcile on the dev database is unaffected.
 */
import { PrismaService } from '../src/common/prisma.service';
import { RedisService } from '../src/common/redis.service';
import { FaultsService } from '../src/common/faults.service';
import { newId } from '../src/common/ids';
import { SettlementService, nonceKey } from '../src/modules/settlement/settlement.service';
import { loadChainConfig } from '../src/modules/settlement/chain-config';
import { ReconcileController } from '../src/modules/settlement/reconcile.controller';
import { AuditService } from '../src/common/audit.service';

const cfg = loadChainConfig();
const WALLET = cfg.treasury[4].address; // treasury-5

const prisma = new PrismaService();
const redis = new RedisService();
const faults = new FaultsService(redis);
const settlement = new SettlementService(prisma, redis, faults);

const created = { sme: '', bn: '', qt: '', transfers: [] as string[], hashes: [] as string[] };

/** Minimal transfer row so chain_transactions.transfer_id has something to point at. */
async function makeTransfer(): Promise<string> {
  const id = newId('tr');
  await prisma.transfer.create({
    data: {
      id, reference: `HSG-TEST-${id.slice(-8)}`, smeId: created.sme, beneficiaryId: created.bn,
      quoteId: (await prisma.quote.create({ data: { id: newId('qt'), smeId: created.sme, usdAmount: 1n, rate: '1500.00', principalNgn: 1500n, feeNgn: 0n, totalNgn: 1500n, expiresAt: new Date(Date.now() + 60_000) } })).id,
      purpose: 'test', travelRule: {}, idempotencyKey: id, requestHash: 'x', usdAmount: 1n, rate: '1500.00', principalNgn: 1500n, feeNgn: 0n, totalNgn: 1500n,
    },
  });
  created.transfers.push(id);
  return id;
}

async function waitFor(hash: `0x${string}`, ms = 30_000) {
  const t0 = Date.now();
  for (;;) {
    const r = await settlement.checkReceipt(hash);
    if (r.status !== 'PENDING' || Date.now() - t0 > ms) return r;
    await new Promise((res) => setTimeout(res, 250));
  }
}

beforeAll(async () => {
  await faults.set({ chainDelaySeconds: 0 });
  await redis.client.del(nonceKey(WALLET)); // other Redis DBs may have used this wallet: start from the chain's count
  created.sme = newId('sme');
  await prisma.smeAccount.create({ data: { id: created.sme, legalName: 'Settlement Test Ltd', address: 'Lagos' } });
  created.bn = newId('bn');
  await prisma.beneficiary.create({ data: { id: created.bn, smeId: created.sme, name: 'Bene', country: 'US', bankName: 'B', accountNumber: '1', address: 'X', screeningStatus: 'CLEARED' } });
});

afterAll(async () => {
  await faults.set({ chainDelaySeconds: 0 });
  await prisma.chainTransaction.deleteMany({ where: { OR: [{ transferId: { in: created.transfers } }, { txHash: { in: created.hashes } }] } });
  await prisma.transfer.deleteMany({ where: { id: { in: created.transfers } } });
  await prisma.quote.deleteMany({ where: { smeId: created.sme } });
  await prisma.beneficiary.deleteMany({ where: { id: created.bn } });
  await prisma.smeAccount.deleteMany({ where: { id: created.sme } });
  await prisma.$disconnect();
  await redis.client.quit();
});

describe('SettlementService (anvil)', () => {
  it('sendTokens is idempotent per (transferId, kind): second call returns the same hash, one row', async () => {
    const transferId = await makeTransfer();
    const p = { transferId, kind: 'SEND' as const, from: WALLET, to: WALLET, usdCents: 1n };
    const a = await settlement.sendTokens(p);
    const b = await settlement.sendTokens(p);
    expect(a.duplicate).toBe(false);
    expect(b.duplicate).toBe(true);
    expect(b.txHash).toBe(a.txHash);
    expect(b.nonce).toBe(a.nonce);
    expect(await prisma.chainTransaction.count({ where: { transferId } })).toBe(1);
    // the row was written with the hash (it exists before/independent of confirmation)
    const row = await prisma.chainTransaction.findUniqueOrThrow({ where: { txHash: a.txHash } });
    expect(row.tokenAmount).toBe(10_000n); // 1 cent = 10,000 token units
    expect((await waitFor(a.txHash)).status).toBe('CONFIRMED');
  });

  it('consecutive sends from one wallet get distinct sequential nonces', async () => {
    const t1 = await makeTransfer();
    const t2 = await makeTransfer();
    const a = await settlement.sendTokens({ transferId: t1, kind: 'SEND', from: WALLET, to: WALLET, usdCents: 1n });
    const b = await settlement.sendTokens({ transferId: t2, kind: 'SEND', from: WALLET, to: WALLET, usdCents: 1n });
    expect(b.nonce).toBe(a.nonce + 1);
    expect(b.txHash).not.toBe(a.txHash);
    const [ra, rb] = await Promise.all([waitFor(a.txHash), waitFor(b.txHash)]);
    expect(ra.status).toBe('CONFIRMED');
    expect(rb.status).toBe('CONFIRMED');
  });

  it('receipt becomes CONFIRMED with block, gas, confirmations and confirmed_at', async () => {
    const transferId = await makeTransfer();
    const sent = await settlement.sendTokens({ transferId, kind: 'SEND', from: WALLET, to: WALLET, usdCents: 1n });
    const r = await waitFor(sent.txHash);
    expect(r.status).toBe('CONFIRMED');
    expect(r.blockNumber).toBeGreaterThan(0n);
    expect(r.gasUsed).toBeGreaterThan(0n);
    expect(r.confirmations).toBeGreaterThanOrEqual(1);
    const row = await prisma.chainTransaction.findUniqueOrThrow({ where: { txHash: sent.txHash } });
    expect(row.status).toBe('CONFIRMED');
    expect(row.blockNumber).toBe(r.blockNumber);
    expect(row.confirmedAt).not.toBeNull();
  });

  it('chain delay fault keeps a mined transaction PENDING (TC09)', async () => {
    const transferId = await makeTransfer();
    await faults.set({ chainDelaySeconds: 120 });
    const sent = await settlement.sendTokens({ transferId, kind: 'SEND', from: WALLET, to: WALLET, usdCents: 1n });
    await new Promise((res) => setTimeout(res, 4500)); // > 2 anvil blocks: it IS mined by now
    expect((await settlement.checkReceipt(sent.txHash)).status).toBe('PENDING');
    expect((await prisma.chainTransaction.findUniqueOrThrow({ where: { txHash: sent.txHash } })).status).toBe('PENDING');
    await faults.set({ chainDelaySeconds: 0 });
    expect((await waitFor(sent.txHash)).status).toBe('CONFIRMED');
  });

  it('pickTreasuryWallet is stable per transfer id', async () => {
    const a = await settlement.pickTreasuryWallet('tr_same');
    expect(await settlement.pickTreasuryWallet('tr_same')).toBe(a);
    const all = cfg.treasury.map((t) => t.address.toLowerCase());
    expect(all).toContain(a.toLowerCase());
  });

  it('balances are read in USD cents', async () => {
    expect(await settlement.tokenBalanceCents(WALLET)).toBeGreaterThan(0n);
    expect(await settlement.treasuryOnchainCents()).toBeGreaterThan(0n);
    expect(settlement.explorerUrl('0xabc')).toBeNull();
  });

  it('reconcile reports variance = on-chain minus ledger 1100 (TC13)', async () => {
    const onchain = await settlement.treasuryOnchainCents();
    // Fake ledger that claims USD 500.00 more than the wallets hold, as after `scripts/chain-drain.ts 500`.
    const fakeLedger = { assetBalance: async (code: string) => { expect(code).toBe('1100'); return onchain + 50_000n; } } as any;
    const ctrl = new ReconcileController(settlement, fakeLedger, prisma, new AuditService(prisma));
    const r = await ctrl.reconcile({ userId: 'usr_test', role: 'OPERATOR', smeId: null, email: 't@test' });
    expect(r.onchain_cents).toBe(onchain.toString());
    expect(r.variance_cents).toBe('-50000');
    expect(r.wallets).toHaveLength(5);
    await prisma.auditLog.deleteMany({ where: { actor: 'usr_test', action: 'RECONCILE' } });
  });

  it('reconcile falls back to a SQL sum of 1100 when LedgerService is not ready', async () => {
    const notReady = { assetBalance: async () => { throw new Error('not implemented'); } } as any;
    const ctrl = new ReconcileController(settlement, notReady, prisma, new AuditService(prisma));
    const r = await ctrl.reconcile({ userId: 'usr_test', role: 'OPERATOR', smeId: null, email: 't@test' });
    expect(BigInt(r.variance_cents)).toBe(BigInt(r.onchain_cents) - BigInt(r.ledger_1100_cents));
    await prisma.auditLog.deleteMany({ where: { actor: 'usr_test', action: 'RECONCILE' } });
  });
});
