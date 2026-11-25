/**
 * Saga: step processors, idempotency, retry policy and compensation order.
 * Uses the real hsg_test database for transfers / saga_steps / payout_orders / chain_transactions,
 * and hand-written fakes for the ledger postings, chain, compliance, liquidity, webhook and queues.
 * No Redis, no BullMQ, no chain: a small in-memory driver plays the queue.
 */
import { PrismaClient } from '@prisma/client';
import { ulid } from 'ulid';
import { DomainError } from '../src/common/errors';
import { ChainJobData, SagaContext } from '../src/modules/saga/saga-context';
import { processChainJob, processSagaJob } from '../src/modules/saga/saga-runner';
import { runReserve } from '../src/modules/saga/steps/reserve.step';
import { REASON_BANK_REJECTED, REASON_GENERIC } from '../src/modules/saga/compensation';

const prisma = new PrismaClient();
const run = ulid().toLowerCase();
const TREASURY = '0x1111111111111111111111111111111111111111';
let smeId = '';
let beneficiaryId = '';
let providerId = '';
const PROVIDER_WALLET = `0x${run.replace(/[^0-9a-f]/g, 'a').padEnd(40, 'b').slice(0, 40)}`;
const transferIds: string[] = [];

/** One fresh set of fakes per test. `calls` records every side effect in order. */
function makeWorld() {
  const calls: string[] = [];
  const postedRefs = new Set<string>();
  const sagaJobs: { transferId: string; step: string; tag?: string; delayMs?: number }[] = [];
  const chainJobs: { address: string; job: ChainJobData }[] = [];
  const receipts = new Map<string, 'PENDING' | 'CONFIRMED' | 'FAILED'>();
  const opts = {
    gate: { outcome: 'PASS' } as any,
    insufficient: false,
    matchFails: false,
    payout: 'ok' as 'ok' | 'hard' | 'transient',
    defaultReceipt: 'CONFIRMED' as 'PENDING' | 'CONFIRMED' | 'FAILED',
  };

  // Ledger fake: idempotent by reference exactly like the real postEntry.
  const post = (ref: string) => {
    if (postedRefs.has(ref)) return { duplicate: true } as any;
    postedRefs.add(ref);
    calls.push(`post ${ref.split(':')[1]}`);
    return { duplicate: false } as any;
  };
  const postings: any = {
    reserve: async (t: string) => {
      if (opts.insufficient) throw new DomainError('INSUFFICIENT_FUNDS', 'short', false);
      return post(`${t}:RESERVE`);
    },
    release: async (t: string) => post(`${t}:RELEASE`),
    chainConfirmed: async (t: string) => post(`${t}:CHAIN_CONFIRMED`),
    chainReturned: async (t: string) => post(`${t}:CHAIN_RETURNED`),
    payoutNgn: async (t: string) => post(`${t}:PAYOUT_NGN`),
    payoutUsd: async (t: string) => post(`${t}:PAYOUT_USD`),
  };

  // Chain fake: saves the chain_transactions row first, never sends twice per (transfer, kind).
  const settlement: any = {
    pickTreasuryWallet: async () => TREASURY,
    sendTokens: async (p: any) => {
      const existing = await prisma.chainTransaction.findUnique({ where: { transferId_kind: { transferId: p.transferId, kind: p.kind } } });
      if (existing) return { txHash: existing.txHash, nonce: existing.nonce, duplicate: true };
      const txHash = `0x${ulid().toLowerCase()}${p.kind === 'SEND' ? 'a' : 'b'}`;
      await prisma.chainTransaction.create({
        data: { id: `ct_${ulid()}`, transferId: p.transferId, kind: p.kind, fromAddress: p.from, toAddress: p.to, tokenAmount: p.usdCents * 10_000n, txHash, nonce: 0 },
      });
      calls.push(`send ${p.kind} ${p.from === TREASURY ? 'treasury->provider' : 'provider->treasury'}`);
      return { txHash, nonce: 0, duplicate: false };
    },
    checkReceipt: async (h: string) => ({ status: receipts.get(h) ?? opts.defaultReceipt, confirmations: 1, blockNumber: 1n }),
  };

  const compliance: any = { runTransferGates: async () => opts.gate };

  // Liquidity fake: one payout order per transfer, on the test provider.
  const liquidity: any = {
    match: async (t: string, usd: bigint) => {
      if (opts.matchFails) throw new DomainError('NO_PROVIDER_CAPACITY', 'none', false);
      const existing = await prisma.payoutOrder.findUnique({ where: { transferId: t } });
      if (!existing) {
        await prisma.payoutOrder.create({ data: { id: `po_${ulid()}`, transferId: t, providerId, usdAmount: usd, rate: '1580.00', score: 0.9 } });
        calls.push('match');
      }
      return { providerId, name: 'test', rate: '1580.00', score: 0.9, walletAddress: PROVIDER_WALLET };
    },
    unmatch: async (t: string) => {
      const r = await prisma.payoutOrder.updateMany({ where: { transferId: t, status: { not: 'CANCELLED' } }, data: { status: 'CANCELLED' } });
      if (r.count) calls.push('unmatch');
    },
    partnerFor: () => ({
      name: 'SIMULATED',
      payout: async () => {
        calls.push(`payout ${opts.payout}`);
        if (opts.payout === 'hard') return { ok: false, hard: true, reason: 'bank rejected' };
        if (opts.payout === 'transient') return { ok: false, hard: false, reason: 'try later' };
        return { ok: true, externalRef: 'SIM-1' };
      },
    }),
  };

  const webhook: any = { notifyTransfer: async (_t: string, e: string) => { calls.push(`webhook ${e}`); } };

  const ctx: SagaContext = {
    prisma: prisma as any,
    sagaQueue: { enqueueStep: async (transferId: string, step: string, o: any = {}) => { sagaJobs.push({ transferId, step, tag: o.retryTag, delayMs: o.delayMs }); } } as any,
    postings, settlement, compliance, liquidity, webhook,
    enqueueChainJob: async (address, job) => { chainJobs.push({ address, job }); },
  };

  /** Plays the queues: runs saga jobs and chain jobs until none are left. Transient errors are retried up to 5 times. */
  async function drain(max = 60) {
    for (let i = 0; i < max; i++) {
      const chain = chainJobs.shift();
      const saga = chain ? undefined : sagaJobs.shift();
      if (!chain && !saga) return;
      for (let attempt = 1; attempt <= 5; attempt++) {
        try {
          if (chain) await processChainJob(ctx, chain.job);
          else await processSagaJob(ctx, { transferId: saga!.transferId, step: saga!.step }, saga!.tag);
          break;
        } catch (e) {
          if (attempt === 5) throw e;
        }
      }
    }
    throw new Error('saga did not settle');
  }

  return { ctx, calls, opts, sagaJobs, chainJobs, receipts, drain, postedRefs };
}

async function makeTransfer() {
  const qid = `qt_${ulid()}`;
  await prisma.quote.create({ data: { id: qid, smeId, usdAmount: 100_000n, rate: '1580.00', principalNgn: 158_000_000n, feeNgn: 750_000n, totalNgn: 158_750_000n, expiresAt: new Date(Date.now() + 60_000) } });
  const id = `tr_${ulid()}`;
  await prisma.transfer.create({
    data: { id, reference: `HSG-SAGA-${ulid()}`, smeId, beneficiaryId, quoteId: qid, purpose: 'test', travelRule: {}, idempotencyKey: id, requestHash: 'x', usdAmount: 100_000n, rate: '1580.00', principalNgn: 158_000_000n, feeNgn: 750_000n, totalNgn: 158_750_000n },
  });
  transferIds.push(id);
  return id;
}
const transfer = (id: string) => prisma.transfer.findUniqueOrThrow({ where: { id } });
const steps = (id: string) => prisma.sagaStep.findMany({ where: { transferId: id }, orderBy: { startedAt: 'asc' } });

beforeAll(async () => {
  smeId = `sme_${ulid()}`;
  await prisma.smeAccount.create({ data: { id: smeId, legalName: `Saga Test ${run}`, address: 'Lagos', kybStatus: 'VERIFIED' } });
  beneficiaryId = `bn_${ulid()}`;
  await prisma.beneficiary.create({ data: { id: beneficiaryId, smeId, name: 'Test Supplier', country: 'CN', bankName: 'Bank', accountNumber: '123456789', address: 'Shenzhen', screeningStatus: 'CLEARED' } });
  providerId = `lp_${ulid()}`;
  // capacity 0 + inactive: never picked by real matching in other suites.
  await prisma.liquidityProvider.create({ data: { id: providerId, name: `saga-test-${run}`, rate: '1580.00', capacityUsd: 0n, reliability: 1, walletAddress: PROVIDER_WALLET, active: false } });
});

afterAll(async () => {
  const where = { transferId: { in: transferIds } };
  await prisma.sagaStep.deleteMany({ where });
  await prisma.chainTransaction.deleteMany({ where });
  await prisma.payoutOrder.deleteMany({ where });
  await prisma.transfer.deleteMany({ where: { id: { in: transferIds } } });
  await prisma.quote.deleteMany({ where: { smeId } });
  await prisma.beneficiary.deleteMany({ where: { smeId } });
  await prisma.liquidityProvider.deleteMany({ where: { id: providerId } });
  await prisma.smeAccount.deleteMany({ where: { id: smeId } });
  await prisma.$disconnect();
});

describe('saga happy path (TC07)', () => {
  it('runs SCREEN..FINALISE to COMPLETED, posting each entry once, with timestamps', async () => {
    const w = makeWorld();
    const id = await makeTransfer();
    w.sagaJobs.push({ transferId: id, step: 'SCREEN' });
    await w.drain();

    const t = await transfer(id);
    expect(t.status).toBe('COMPLETED');
    expect(t.treasuryWallet).toBe(TREASURY);
    for (const k of ['screeningAt', 'reservedAt', 'onchainPendingAt', 'onchainConfirmedAt', 'payoutPendingAt', 'completedAt'] as const) expect(t[k]).toBeInstanceOf(Date);
    expect(w.calls).toEqual([
      'post RESERVE', 'match', 'send SEND treasury->provider', 'post CHAIN_CONFIRMED', 'payout ok', 'post PAYOUT_NGN', 'post PAYOUT_USD', 'webhook transfer.completed',
    ]);
    expect((await steps(id)).map((s) => `${s.step}:${s.status}`)).toEqual([
      'SCREEN:COMPLETED', 'RESERVE:COMPLETED', 'MATCH:COMPLETED', 'CHAIN_SEND:COMPLETED', 'CHAIN_CONFIRM:COMPLETED', 'PAYOUT:COMPLETED', 'FINALISE:COMPLETED',
    ]);
    const order = await prisma.payoutOrder.findUniqueOrThrow({ where: { transferId: id } });
    expect(order.status).toBe('PAID');
    expect(order.externalRef).toBe('SIM-1');
  });
});

describe('step idempotency', () => {
  it('running RESERVE twice posts once and records one COMPLETED row', async () => {
    const w = makeWorld();
    const id = await makeTransfer();
    await runReserve(w.ctx, id);
    await runReserve(w.ctx, id);
    expect(w.calls.filter((c) => c === 'post RESERVE')).toHaveLength(1);
    const rows = await prisma.sagaStep.findMany({ where: { transferId: id, step: 'RESERVE' } });
    expect(rows).toHaveLength(1);
    expect(rows[0].status).toBe('COMPLETED');
    // The second run only re-queued the next step (de-duplicated by job id in BullMQ).
    expect(w.sagaJobs.map((j) => j.step)).toEqual(['MATCH', 'MATCH']);
  });

  it('replaying every step of a completed transfer changes nothing (TC10-style duplicate delivery)', async () => {
    const w = makeWorld();
    const id = await makeTransfer();
    w.sagaJobs.push({ transferId: id, step: 'SCREEN' });
    await w.drain();
    const before = [...w.calls];
    for (const step of ['SCREEN', 'RESERVE', 'MATCH', 'CHAIN_SEND', 'CHAIN_CONFIRM', 'PAYOUT', 'FINALISE']) w.sagaJobs.push({ transferId: id, step, tag: 'replay' });
    await w.drain();
    expect(w.calls).toEqual(before);
    expect(await prisma.chainTransaction.count({ where: { transferId: id } })).toBe(1);
  });

  it('a crash after broadcast but before COMPLETED never broadcasts twice', async () => {
    const w = makeWorld();
    const id = await makeTransfer();
    w.sagaJobs.push({ transferId: id, step: 'SCREEN' });
    // Run up to MATCH only.
    for (let i = 0; i < 3; i++) { const j = w.sagaJobs.shift()!; await processSagaJob(w.ctx, j); }
    await w.ctx.prisma.transfer.update({ where: { id }, data: { treasuryWallet: TREASURY } });
    // Simulate: the send happened (hash saved) but the step died before marking COMPLETED.
    await w.ctx.settlement.sendTokens({ transferId: id, kind: 'SEND', from: TREASURY, to: PROVIDER_WALLET as any, usdCents: 100_000n });
    await w.drain();
    expect(w.calls.filter((c) => c.startsWith('send SEND'))).toHaveLength(1);
    expect((await transfer(id)).status).toBe('COMPLETED');
  });
});

describe('SCREEN and RESERVE outcomes', () => {
  it('HELD stops the saga with held_rule; a replayed SCREEN does not move it on', async () => {
    const w = makeWorld();
    w.opts.gate = { outcome: 'HELD', rule: 'VELOCITY', reason: 'more than 5 in 10 minutes' };
    const id = await makeTransfer();
    w.sagaJobs.push({ transferId: id, step: 'SCREEN' });
    await w.drain();
    let t = await transfer(id);
    expect(t.status).toBe('HELD');
    expect(t.heldRule).toBe('VELOCITY');
    expect(t.heldAt).toBeInstanceOf(Date);
    w.sagaJobs.push({ transferId: id, step: 'SCREEN', tag: 'again' });
    await w.drain();
    expect(w.calls).toEqual([]);

    // Operator approval enqueues RESERVE: the saga resumes and completes.
    w.sagaJobs.push({ transferId: id, step: 'RESERVE' });
    await w.drain();
    t = await transfer(id);
    expect(t.status).toBe('COMPLETED');
  });

  it('DECLINED (TC06) sets a plain reason and moves nothing', async () => {
    const w = makeWorld();
    w.opts.gate = { outcome: 'DECLINED', rule: 'SANCTIONS', reason: 'matched watchlist entry X' };
    const id = await makeTransfer();
    w.sagaJobs.push({ transferId: id, step: 'SCREEN' });
    await w.drain();
    const t = await transfer(id);
    expect(t.status).toBe('DECLINED');
    expect(t.declinedAt).toBeInstanceOf(Date);
    expect(t.failureReason).not.toMatch(/watchlist|sanction/i);
    expect(w.calls).toEqual([]);
    expect(await prisma.chainTransaction.count({ where: { transferId: id } })).toBe(0);
  });

  it('INSUFFICIENT_FUNDS at RESERVE declines without compensation', async () => {
    const w = makeWorld();
    w.opts.insufficient = true;
    const id = await makeTransfer();
    w.sagaJobs.push({ transferId: id, step: 'SCREEN' });
    await w.drain();
    const t = await transfer(id);
    expect(t.status).toBe('DECLINED');
    expect(t.failureReason).toMatch(/balance/);
    expect(w.calls).toEqual([]);
  });
});

describe('CHAIN_CONFIRM polling (TC09)', () => {
  it('a pending receipt re-queues the step with a delay instead of burning retries', async () => {
    const w = makeWorld();
    w.opts.defaultReceipt = 'PENDING';
    const id = await makeTransfer();
    w.sagaJobs.push({ transferId: id, step: 'SCREEN' });
    // Run until the first CHAIN_CONFIRM check has happened.
    for (let i = 0; i < 10 && !(await prisma.sagaStep.count({ where: { transferId: id, step: 'CHAIN_CONFIRM' } })); i++) {
      const chain = w.chainJobs.shift();
      if (chain) await processChainJob(w.ctx, chain.job);
      else { const j = w.sagaJobs.shift()!; await processSagaJob(w.ctx, j, j.tag); }
    }
    expect(w.sagaJobs).toEqual([{ transferId: id, step: 'CHAIN_CONFIRM', tag: 'poll1', delayMs: 5000 }]);
    // Two more pending polls, then the receipt confirms.
    for (let i = 0; i < 2; i++) { const j = w.sagaJobs.shift()!; await processSagaJob(w.ctx, j, j.tag); }
    w.opts.defaultReceipt = 'CONFIRMED';
    await w.drain();
    expect((await transfer(id)).status).toBe('COMPLETED');
    const confirms = await prisma.sagaStep.findMany({ where: { transferId: id, step: 'CHAIN_CONFIRM' }, orderBy: { attempt: 'asc' } });
    expect(confirms.map((s) => `${s.attempt}:${s.status}`)).toEqual(['1:FAILED', '2:FAILED', '3:FAILED', '4:COMPLETED']);
    expect(await prisma.chainTransaction.count({ where: { transferId: id } })).toBe(1);
  });
});

describe('compensation', () => {
  it('TC14: payout hard fail after the chain leg returns tokens, then unmatches, then releases, in that order', async () => {
    const w = makeWorld();
    w.opts.payout = 'hard';
    const id = await makeTransfer();
    w.sagaJobs.push({ transferId: id, step: 'SCREEN' });
    await w.drain();

    const t = await transfer(id);
    expect(t.status).toBe('REVERSED');
    expect(t.reversingAt).toBeInstanceOf(Date);
    expect(t.reversedAt).toBeInstanceOf(Date);
    expect(t.failureReason).toBe(REASON_BANK_REJECTED);
    expect(w.calls).toEqual([
      'post RESERVE', 'match', 'send SEND treasury->provider', 'post CHAIN_CONFIRMED', 'payout hard',
      // compensation, reverse order:
      'send RETURN provider->treasury', 'post CHAIN_RETURNED', 'unmatch', 'post RELEASE', 'webhook transfer.reversed',
    ]);
    const comp = (await steps(id)).filter((s) => s.step.startsWith('COMP_') && s.status === 'COMPLETED').map((s) => s.step);
    expect(comp).toEqual(['COMP_CHAIN_SEND', 'COMP_CHAIN_CONFIRM', 'COMP_MATCH', 'COMP_RESERVE']);
    expect(await prisma.chainTransaction.count({ where: { transferId: id } })).toBe(2);
    // Running compensation again does nothing more.
    w.sagaJobs.push({ transferId: id, step: 'COMPENSATE', tag: 'again' });
    await w.drain();
    expect(w.calls.filter((c) => c === 'post RELEASE')).toHaveLength(1);
  });

  it('TC08: no provider capacity at MATCH releases the hold only (no chain return)', async () => {
    const w = makeWorld();
    w.opts.matchFails = true;
    const id = await makeTransfer();
    w.sagaJobs.push({ transferId: id, step: 'SCREEN' });
    await w.drain();
    const t = await transfer(id);
    expect(t.status).toBe('REVERSED');
    expect(t.failureReason).toBe(REASON_GENERIC);
    expect(w.calls).toEqual(['post RESERVE', 'post RELEASE', 'webhook transfer.reversed']);
  });

  it('transient payout failures are retried and then succeed', async () => {
    const w = makeWorld();
    w.opts.payout = 'transient';
    const id = await makeTransfer();
    w.sagaJobs.push({ transferId: id, step: 'SCREEN' });
    // Drive manually so we can flip the provider back after two failures.
    let failures = 0;
    for (let i = 0; i < 40; i++) {
      const chain = w.chainJobs.shift();
      const saga = chain ? undefined : w.sagaJobs.shift();
      if (!chain && !saga) break;
      try {
        if (chain) await processChainJob(w.ctx, chain.job);
        else await processSagaJob(w.ctx, saga!, saga!.tag);
      } catch {
        failures++;
        if (failures === 2) w.opts.payout = 'ok';
        if (saga) w.sagaJobs.unshift(saga); // BullMQ would retry the same job
      }
    }
    expect(failures).toBe(2);
    expect((await transfer(id)).status).toBe('COMPLETED');
    const payouts = await prisma.sagaStep.findMany({ where: { transferId: id, step: 'PAYOUT' }, orderBy: { attempt: 'asc' } });
    expect(payouts.map((s) => s.status)).toEqual(['FAILED', 'FAILED', 'COMPLETED']);
  });

  it('a send that failed on chain is not returned; the hold is still released', async () => {
    const w = makeWorld();
    w.opts.defaultReceipt = 'FAILED';
    const id = await makeTransfer();
    w.sagaJobs.push({ transferId: id, step: 'SCREEN' });
    await w.drain();
    expect((await transfer(id)).status).toBe('REVERSED');
    expect(w.calls).toEqual(['post RESERVE', 'match', 'send SEND treasury->provider', 'unmatch', 'post RELEASE', 'webhook transfer.reversed']);
  });
});
