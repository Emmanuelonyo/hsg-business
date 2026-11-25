/**
 * Compliance: name screening (pure) + the five transfer gates against real rows in hsg_test.
 * Every fixture uses a unique run tag so this suite never collides with other suites.
 */
import { PrismaService } from '../src/common/prisma.service';
import { newId } from '../src/common/ids';
import { CONFIG } from '../src/common/config';
import { ComplianceService } from '../src/modules/compliance/compliance.service';
import { jaccard, nameMatch, normaliseName, tokens } from '../src/modules/compliance/screening';

describe('screening helpers (pure)', () => {
  it('normalises case, punctuation, spacing and company suffixes', () => {
    expect(normaliseName('  Volga   Trading Co., Ltd. ')).toBe('volga trading');
    expect(normaliseName('ACME-Imports LLC')).toBe('acme imports');
    expect(normaliseName('Shenzhen Electronics (HK) Limited')).toBe('shenzhen electronics hk');
    expect(normaliseName('Siemens AG plc inc sa bv')).toBe('siemens');
  });

  it('matches exact names ignoring case, punctuation and suffixes', () => {
    expect(nameMatch('VOLGA TRADING LTD', 'Volga Trading')).toBe('exact');
    expect(nameMatch('volga trading, co.', 'Volga Trading Limited')).toBe('exact');
  });

  it('matches by token set: reordered words and watchlist ⊆ name', () => {
    expect(nameMatch('Trading Volga', 'Volga Trading')).toBe('token_set');
    expect(nameMatch('Volga Trading Shenzhen Branch', 'Volga Trading')).toBe('token_set');
  });

  it('matches by Jaccard >= 0.8 and rejects below', () => {
    // 4 shared of 5 total tokens = 0.8
    expect(jaccard(tokens('a b c d e'), tokens('a b c d'))).toBeCloseTo(0.8);
    expect(nameMatch('Alpha Beta Gamma Delta', 'Alpha Beta Gamma Delta Epsilon')).toBe('token_set');
    expect(nameMatch('Alpha Beta Gamma', 'Alpha Beta Gamma Delta Epsilon')).toBeNull(); // 3/5 = 0.6
  });

  it('does not match unrelated or partial names', () => {
    expect(nameMatch('Guangzhou Textiles', 'Volga Trading')).toBeNull();
    expect(nameMatch('Volga Foods', 'Volga Trading')).toBeNull();
    expect(nameMatch('Ltd', 'Volga Trading')).toBeNull();
  });
});

describe('ComplianceService (hsg_test)', () => {
  const prisma = new PrismaService();
  const svc = new ComplianceService(prisma);
  const tag = `T${Date.now().toString(36)}${Math.floor(Math.random() * 1e6).toString(36)}`; // unique word per run
  const listedName = `Zarkov ${tag} Holdings`;
  const watchIds: string[] = [];
  const smeIds: string[] = [];
  const created: { transfers: string[]; quotes: string[]; bens: string[] } = { transfers: [], quotes: [], bens: [] };

  beforeAll(async () => {
    await prisma.$connect();
    const id = newId('wl');
    watchIds.push(id);
    await prisma.watchlist.create({ data: { id, name: listedName, country: 'RU', source: 'TEST' } });
  });

  afterAll(async () => {
    // Best-effort cleanup of our own rows (children first).
    await prisma.complianceCheck.deleteMany({ where: { OR: [{ transferId: { in: created.transfers } }, { smeId: { in: smeIds } }] } }).catch(() => undefined);
    await prisma.transfer.deleteMany({ where: { id: { in: created.transfers } } }).catch(() => undefined);
    await prisma.quote.deleteMany({ where: { id: { in: created.quotes } } }).catch(() => undefined);
    await prisma.beneficiary.deleteMany({ where: { id: { in: created.bens } } }).catch(() => undefined);
    await prisma.virtualAccount.deleteMany({ where: { smeId: { in: smeIds } } }).catch(() => undefined);
    await prisma.smeAccount.deleteMany({ where: { id: { in: smeIds } } }).catch(() => undefined);
    await prisma.watchlist.deleteMany({ where: { id: { in: watchIds } } }).catch(() => undefined);
    await prisma.$disconnect();
  });

  async function makeSme(kyb: 'VERIFIED' | 'PENDING' = 'VERIFIED') {
    const id = newId('sme');
    smeIds.push(id);
    await prisma.smeAccount.create({ data: { id, legalName: `Test Importer ${tag}`, address: '12 Marina, Lagos', kybStatus: kyb } });
    return id;
  }
  async function makeBen(smeId: string, name = 'Shenzhen Parts Co', country = 'CN') {
    const id = newId('bn');
    created.bens.push(id);
    await prisma.beneficiary.create({
      data: { id, smeId, name, country, bankName: 'Bank of China', accountNumber: '6222000011112222', address: '1 Futian Rd, Shenzhen', screeningStatus: 'CLEARED' },
    });
    return id;
  }
  async function makeTransfer(smeId: string, benId: string, opts: { usd?: bigint; travelRule?: any; createdAt?: Date } = {}) {
    const usd = opts.usd ?? 100_000n;
    const qid = newId('qt');
    created.quotes.push(qid);
    await prisma.quote.create({
      data: { id: qid, smeId, usdAmount: usd, rate: '1587.90', principalNgn: usd * 15879n / 10n, feeNgn: 750_000n, totalNgn: usd * 15879n / 10n + 750_000n, expiresAt: new Date(Date.now() + 60_000), usedAt: new Date() },
    });
    const id = newId('tr');
    created.transfers.push(id);
    const travelRule = opts.travelRule ?? {
      originator: { name: `Test Importer ${tag}`, account: '0123456789', address: '12 Marina, Lagos' },
      beneficiary: { name: 'Shenzhen Parts Co', account: '6222000011112222', address: '1 Futian Rd, Shenzhen' },
    };
    await prisma.transfer.create({
      data: {
        id, reference: `HSG-TEST-${id.slice(-12)}`, smeId, beneficiaryId: benId, quoteId: qid, purpose: 'test', travelRule,
        idempotencyKey: id, requestHash: 'x', usdAmount: usd, rate: '1587.90', principalNgn: usd * 15879n / 10n, feeNgn: 750_000n,
        totalNgn: usd * 15879n / 10n + 750_000n, ...(opts.createdAt ? { createdAt: opts.createdAt } : {}),
      },
    });
    return id;
  }
  const checks = (transferId: string) => prisma.complianceCheck.findMany({ where: { transferId }, orderBy: { gate: 'asc' } });

  it('screenName: blocks exact and token-set matches only in the same country', async () => {
    expect((await svc.screenName(`zarkov ${tag.toLowerCase()} holdings ltd`, 'ru')).status).toBe('BLOCKED');
    const ts = await svc.screenName(`${tag} Zarkov Holdings Trading`, 'RU');
    expect(ts.status).toBe('BLOCKED');
    expect(ts.matched?.method).toBe('token_set');
    expect((await svc.screenName(listedName, 'CN')).status).toBe('CLEARED'); // different country
    expect((await svc.screenName(`Unrelated ${tag} Ltd`, 'RU')).status).toBe('CLEARED');
  });

  it('PASS: all five gates pass and five rows are written', async () => {
    const sme = await makeSme();
    const tr = await makeTransfer(sme, await makeBen(sme));
    expect(await svc.runTransferGates(tr)).toEqual({ outcome: 'PASS' });
    const rows = await checks(tr);
    expect(rows.map((r) => r.gate).sort()).toEqual(['KYB', 'SANCTIONS', 'THRESHOLD', 'TRAVEL_RULE', 'VELOCITY']);
    expect(rows.every((r) => r.result === 'PASS')).toBe(true);
    // Status untouched: the saga sets it.
    expect((await prisma.transfer.findUniqueOrThrow({ where: { id: tr } })).status).toBe('CREATED');
  });

  it('is idempotent: a second run returns the recorded outcome without new rows', async () => {
    const sme = await makeSme();
    const tr = await makeTransfer(sme, await makeBen(sme), { usd: CONFIG.THRESHOLD_USD_CENTS + 1n });
    const first = await svc.runTransferGates(tr);
    const second = await svc.runTransferGates(tr);
    expect(second).toEqual(first);
    expect((await checks(tr)).length).toBe(5);
  });

  it('DECLINED at KYB when the SME is not verified, and stops there', async () => {
    const sme = await makeSme('PENDING');
    const tr = await makeTransfer(sme, await makeBen(sme));
    const out = await svc.runTransferGates(tr);
    expect(out).toMatchObject({ outcome: 'DECLINED', rule: 'KYB' });
    const rows = await checks(tr);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ gate: 'KYB', result: 'FAIL' });
  });

  it('DECLINED at SANCTIONS for a watchlisted beneficiary (TC06)', async () => {
    const sme = await makeSme();
    const tr = await makeTransfer(sme, await makeBen(sme, `${listedName} Limited`, 'RU'));
    const out = await svc.runTransferGates(tr);
    expect(out).toMatchObject({ outcome: 'DECLINED', rule: 'SANCTIONS' });
    const rows = await checks(tr);
    expect(rows.map((r) => `${r.gate}:${r.result}`).sort()).toEqual(['KYB:PASS', 'SANCTIONS:FAIL']);
  });

  it('DECLINED at TRAVEL_RULE when the originator address is missing', async () => {
    const sme = await makeSme();
    const ben = await makeBen(sme);
    const tr = await makeTransfer(sme, ben, {
      travelRule: { originator: { name: 'X', account: '0123456789', address: '' }, beneficiary: { name: 'Y', account: '1', address: 'Z' } },
    });
    expect(await svc.runTransferGates(tr)).toMatchObject({ outcome: 'DECLINED', rule: 'TRAVEL_RULE' });
    const tl = (await checks(tr)).find((r) => r.gate === 'TRAVEL_RULE')!;
    expect((tl.detail as any).missing).toEqual(['originator.address']);
  });

  it('HELD at THRESHOLD above USD 10,000; exactly 10,000 passes', async () => {
    const sme = await makeSme();
    const ben = await makeBen(sme);
    const over = await makeTransfer(sme, ben, { usd: CONFIG.THRESHOLD_USD_CENTS + 1n });
    expect(await svc.runTransferGates(over)).toMatchObject({ outcome: 'HELD', rule: 'THRESHOLD' });
    const at = await makeTransfer(sme, ben, { usd: CONFIG.THRESHOLD_USD_CENTS });
    expect(await svc.runTransferGates(at)).toEqual({ outcome: 'PASS' });
  });

  it('HELD at VELOCITY on the 6th transfer in 10 minutes (TC12); older ones do not count', async () => {
    const sme = await makeSme();
    const ben = await makeBen(sme);
    // An old transfer outside the window must not count.
    await makeTransfer(sme, ben, { createdAt: new Date(Date.now() - (CONFIG.VELOCITY_WINDOW_MIN + 1) * 60_000) });
    const ids: string[] = [];
    for (let i = 0; i < CONFIG.VELOCITY_MAX + 1; i++) {
      ids.push(await makeTransfer(sme, ben, { createdAt: new Date(Date.now() - (CONFIG.VELOCITY_MAX + 1 - i) * 1000) }));
    }
    for (let i = 0; i < CONFIG.VELOCITY_MAX; i++) expect(await svc.runTransferGates(ids[i])).toEqual({ outcome: 'PASS' });
    const sixth = await svc.runTransferGates(ids[CONFIG.VELOCITY_MAX]);
    expect(sixth).toMatchObject({ outcome: 'HELD', rule: 'VELOCITY' });
    const v = (await checks(ids[CONFIG.VELOCITY_MAX])).find((r) => r.gate === 'VELOCITY')!;
    expect(v.result).toBe('HOLD');
  });
});
