// Ledger rules (PRD "Rules the build must hold > Ledger"), run against hsg_test.
// The journal is append-only even here, so tests never delete journal rows: every run uses
// fresh references (RUN prefix) and asserts relative to what is already in the table.
import { PrismaClient } from '@prisma/client';
import { ulid } from 'ulid';
import { PrismaService } from '../src/common/prisma.service';
import { LedgerService } from '../src/modules/ledger/ledger.service';
import { PostingsService } from '../src/modules/ledger/postings.service';
import { LineInput } from '../src/modules/ledger/ledger.types';

const OWNER_URL = process.env.TEST_MIGRATE_DATABASE_URL ?? 'postgresql://hsg_owner:hsg_owner@localhost:5432/hsg_test';
const RUN = `t${ulid()}`;

let prisma: PrismaService;
let owner: PrismaClient;
let ledger: LedgerService;
let postings: PostingsService;

const ngn = (dr: string, cr: string, amount: bigint): LineInput[] => [
  { accountCode: dr, side: 'DEBIT', amount, currency: 'NGN' },
  { accountCode: cr, side: 'CREDIT', amount, currency: 'NGN' },
];

beforeAll(async () => {
  prisma = new PrismaService(); // DATABASE_URL = hsg_app on hsg_test (test/setup-env.ts)
  owner = new PrismaClient({ datasources: { db: { url: OWNER_URL } } });
  ledger = new LedgerService(prisma);
  postings = new PostingsService(ledger);
});

afterAll(async () => {
  await prisma.$disconnect();
  await owner.$disconnect();
});

describe('postEntry', () => {
  it('accepts a balanced entry and chains it to the previous hash', async () => {
    const before = await prisma.ledgerHead.findUniqueOrThrow({ where: { id: 1 } });
    const e = await ledger.postEntry(`${RUN}:balanced`, ngn('1000', '3000', 12_345n), { event: 'TEST' });
    expect(e.duplicate).toBe(false);
    expect(e.entryHash).toMatch(/^[0-9a-f]{64}$/);
    const lines = await prisma.journalLine.findMany({ where: { entryId: e.id } });
    expect(lines).toHaveLength(2);
    // Under concurrent test suites another entry could slip in, so only check what must hold.
    expect(e.seq > before.lastSeq).toBe(true);
    const head = await prisma.ledgerHead.findUniqueOrThrow({ where: { id: 1 } });
    expect(head.lastSeq >= e.seq).toBe(true);
  });

  it('rejects an unbalanced entry and writes nothing', async () => {
    const count = await prisma.journalEntry.count();
    await expect(ledger.postEntry(`${RUN}:unbalanced`, [
      { accountCode: '1000', side: 'DEBIT', amount: 100n, currency: 'NGN' },
      { accountCode: '3000', side: 'CREDIT', amount: 99n, currency: 'NGN' },
    ], { event: 'TEST' })).rejects.toMatchObject({ code: 'LEDGER_UNBALANCED' });
    expect(await prisma.journalEntry.findUnique({ where: { reference: `${RUN}:unbalanced` } })).toBeNull();
    expect(await prisma.journalEntry.count()).toBeGreaterThanOrEqual(count);
  });

  it('rejects an entry that only balances across currencies', async () => {
    await expect(ledger.postEntry(`${RUN}:mixed`, [
      { accountCode: '1000', side: 'DEBIT', amount: 100n, currency: 'NGN' },
      { accountCode: '1100', side: 'CREDIT', amount: 100n, currency: 'USD' },
    ], { event: 'TEST' })).rejects.toMatchObject({ code: 'LEDGER_UNBALANCED' });
  });

  it('rejects zero and negative amounts, and fewer than two lines', async () => {
    await expect(ledger.postEntry(`${RUN}:zero`, ngn('1000', '3000', 0n), { event: 'TEST' })).rejects.toMatchObject({ code: 'LEDGER_INVALID' });
    await expect(ledger.postEntry(`${RUN}:neg`, ngn('1000', '3000', -5n), { event: 'TEST' })).rejects.toMatchObject({ code: 'LEDGER_INVALID' });
    await expect(ledger.postEntry(`${RUN}:one`, [ngn('1000', '3000', 5n)[0]], { event: 'TEST' })).rejects.toMatchObject({ code: 'LEDGER_INVALID' });
    await expect(ledger.postEntry(`${RUN}:float`, ngn('1000', '3000', 5.5 as any), { event: 'TEST' })).rejects.toMatchObject({ code: 'LEDGER_INVALID' });
  });

  it('posts a duplicate reference only once', async () => {
    const ref = `${RUN}:dup`;
    const [a, b] = await Promise.all([
      ledger.postEntry(ref, ngn('1000', '3000', 500n), { event: 'TEST' }),
      ledger.postEntry(ref, ngn('1000', '3000', 500n), { event: 'TEST' }),
    ]);
    const c = await ledger.postEntry(ref, ngn('1000', '3000', 500n), { event: 'TEST' });
    expect(a.id).toBe(b.id);
    expect(c.id).toBe(a.id);
    expect([a.duplicate, b.duplicate].filter(Boolean)).toHaveLength(1);
    expect(c.duplicate).toBe(true);
    expect(await prisma.journalEntry.count({ where: { reference: ref } })).toBe(1);
  });

  it('serialises 20 concurrent postings into a gapless, valid chain', async () => {
    const results = await Promise.all(
      Array.from({ length: 20 }, (_, i) => ledger.postEntry(`${RUN}:conc:${i}`, ngn('1000', '3000', BigInt(i + 1)), { event: 'TEST' })),
    );
    expect(new Set(results.map((r) => r.seq.toString())).size).toBe(20);
    // Whole table: seq runs 1..N with no gaps.
    const [row] = await prisma.$queryRaw<{ n: bigint; lo: bigint; hi: bigint }[]>`
      SELECT COUNT(*)::bigint AS n, MIN(seq) AS lo, MAX(seq) AS hi FROM journal_entries`;
    expect(row.lo).toBe(1n);
    expect(row.hi).toBe(row.n);
    const v = await ledger.verifyChain();
    expect(v).toMatchObject({ ok: true, broken_at: null });
    expect(v.checked).toBe(Number(row.n));
  });
});

describe('postings and balances', () => {
  it('rejects a reserve larger than the SME available balance (no overdraft)', async () => {
    const sme = `sme_${RUN}`;
    await postings.inflow(sme, `${RUN}-sess1`, 1_000_00n);
    expect(await ledger.smeBalances(sme)).toEqual({ available: 1_000_00n, held: 0n });

    await expect(postings.reserve(`tr_${RUN}_a`, sme, 1_500_00n)).rejects.toMatchObject({ code: 'INSUFFICIENT_FUNDS', transient: false });
    await postings.reserve(`tr_${RUN}_b`, sme, 800_00n);
    // Two reserves racing for the remaining 200.00: exactly one may win.
    const race = await Promise.allSettled([
      postings.reserve(`tr_${RUN}_c`, sme, 150_00n),
      postings.reserve(`tr_${RUN}_d`, sme, 150_00n),
    ]);
    expect(race.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    expect(await ledger.smeBalances(sme)).toEqual({ available: 50_00n, held: 950_00n });
  });

  it('runs a full transfer lifecycle and keeps the trial balance at zero', async () => {
    const sme = `sme_${RUN}_life`;
    const tr = `tr_${RUN}_life`;
    await postings.treasuryFunding(`${RUN}-treasury`, 10_000_00n);
    await postings.inflow(sme, `${RUN}-sess2`, 2_000_000_00n);
    await postings.reserve(tr, sme, 1_590_000_00n);
    await postings.chainConfirmed(tr, 1_000_00n);
    await postings.payoutNgn(tr, sme, 1_580_000_00n, 10_000_00n);
    await postings.payoutUsd(tr, 1_000_00n);
    expect(await ledger.smeBalances(sme)).toEqual({ available: 410_000_00n, held: 0n });

    const tb = await ledger.trialBalance();
    expect(tb).toEqual({ NGN: 0n, USD: 0n, ok: true });

    const accounts = await ledger.accountBalances({ aggregateSme: true });
    expect(accounts.find((a) => a.code === '2000')).toBeDefined();
    expect(accounts.some((a) => a.code.startsWith('2000-'))).toBe(false);
    const recent = await ledger.recentEntries(5);
    expect(recent).toHaveLength(5);
    expect(BigInt(recent[0].seq) > BigInt(recent[4].seq)).toBe(true);
  });
});

describe('append-only and tamper evidence', () => {
  it('rejects UPDATE/DELETE on journal rows as the app role, and the trigger stops even the owner', async () => {
    const e = await ledger.postEntry(`${RUN}:locked`, ngn('1000', '3000', 77n), { event: 'TEST' });
    // App role: no UPDATE/DELETE privilege at all.
    await expect(prisma.$executeRaw`UPDATE journal_lines SET amount = 1 WHERE entry_id = ${e.id}`).rejects.toThrow(/permission denied/);
    await expect(prisma.$executeRaw`DELETE FROM journal_entries WHERE id = ${e.id}`).rejects.toThrow(/permission denied/);
    // Owner (superuser) has the privilege, but the trigger still refuses.
    await expect(owner.$executeRaw`UPDATE journal_lines SET amount = 1 WHERE entry_id = ${e.id}`).rejects.toThrow(/append-only/);
    await expect(owner.$executeRaw`DELETE FROM journal_entries WHERE id = ${e.id}`).rejects.toThrow(/append-only/);
    await expect(owner.$executeRawUnsafe('TRUNCATE journal_lines, journal_entries')).rejects.toThrow(/append-only/);
  });

  it('makes verifyChain report broken_at when a row is altered behind the triggers', async () => {
    const e = await ledger.postEntry(`${RUN}:tamper`, ngn('1000', '3000', 1_000n), { event: 'TEST' });
    const line = await prisma.journalLine.findFirstOrThrow({ where: { entryId: e.id, side: 'DEBIT' } });

    // Superuser with session_replication_role = replica: triggers are skipped for this transaction.
    const setAmount = (amount: bigint) => owner.$transaction([
      owner.$executeRawUnsafe(`SET LOCAL session_replication_role = replica`),
      owner.$executeRaw`UPDATE journal_lines SET amount = ${amount} WHERE id = ${line.id}`,
    ]);

    await setAmount(999_999n);
    try {
      const v = await ledger.verifyChain();
      expect(v.ok).toBe(false);
      expect(v.broken_at).toBe(e.seq.toString());
    } finally {
      await setAmount(line.amount); // put it back so hsg_test stays valid for other suites
    }
    expect((await ledger.verifyChain()).ok).toBe(true);
  });
});
