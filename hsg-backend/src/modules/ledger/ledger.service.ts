import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { createHash } from 'crypto';
import { PrismaService } from '../../common/prisma.service';
import { canonicalJson } from '../../common/json';
import { DomainError } from '../../common/errors';
import { newId } from '../../common/ids';
import { AccountBalance, LineInput, PostEntryOptions, PostedEntry, TrialBalance, VerifyResult } from './ledger.types';

/** The hash the chain starts from: 64 zeros (seeded into ledger_head by the ledger_guards migration). */
export const GENESIS_HASH = '0'.repeat(64);

/** Either the main Prisma client or a transaction client: both can run queries. */
type Db = Prisma.TransactionClient | PrismaService;

/** A journal line in the exact shape that goes into the hash (snake_case, amount as string). */
interface HashLine { account_code: string; side: string; amount: string; currency: string; }

/**
 * Sort lines into one fixed order so the hash never depends on the order the caller passed them in:
 * by account code, then side (CREDIT before DEBIT alphabetically), then amount.
 */
function sortLinesForHash(lines: HashLine[]): HashLine[] {
  return [...lines].sort((a, b) => {
    if (a.account_code !== b.account_code) return a.account_code < b.account_code ? -1 : 1;
    if (a.side !== b.side) return a.side < b.side ? -1 : 1;
    const x = BigInt(a.amount), y = BigInt(b.amount);
    return x < y ? -1 : x > y ? 1 : 0;
  });
}

/**
 * entry_hash = SHA-256( prev_hash + canonicalJson({seq, reference, created_at, lines}) )
 * Used both when posting and when verifying, so both sides compute it identically.
 */
export function computeEntryHash(prevHash: string, seq: bigint, reference: string, createdAt: Date, lines: HashLine[]): string {
  const body = canonicalJson({
    seq: seq.toString(),
    reference,
    created_at: createdAt.toISOString(),
    lines: sortLinesForHash(lines),
  });
  return createHash('sha256').update(prevHash + body).digest('hex');
}

/**
 * CONTRACT (owned by the Ledger agent). Signatures are fixed; other modules call these.
 * postEntry is the ONLY write path to journal_entries/journal_lines.
 */
@Injectable()
export class LedgerService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Post one balanced, hash-chained journal entry. Idempotent by `reference`.
   *
   * Steps:
   *  1. Validate the lines (outside the transaction: cheap, no locks needed).
   *  2. In ONE database transaction:
   *     a. lock the single ledger_head row (every posting queues here, one at a time)
   *     b. if this reference was already posted, return that entry (duplicate: true)
   *     c. check every account exists and its currency matches the line
   *     d. run the caller's guard (e.g. "SME has enough available balance")
   *     e. seq = last_seq + 1, compute the hash from the previous hash
   *     f. insert the entry and its lines, move the head forward
   *  3. Commit. If anything threw, nothing was written.
   */
  async postEntry(reference: string, lines: LineInput[], opts: PostEntryOptions): Promise<PostedEntry> {
    // ---------- 1. Validation ----------
    if (!reference) throw new DomainError('LEDGER_INVALID', 'reference is required');

    // A double-entry posting needs at least one debit and one credit.
    if (!lines || lines.length < 2) throw new DomainError('LEDGER_INVALID', 'an entry needs at least two lines');

    // Every amount must be a positive whole number of minor units (kobo / cents), as a bigint.
    for (const line of lines) {
      if (typeof line.amount !== 'bigint') throw new DomainError('LEDGER_INVALID', `amount on ${line.accountCode} must be a bigint`);
      if (line.amount <= 0n) throw new DomainError('LEDGER_INVALID', `amount on ${line.accountCode} must be positive`);
      if (line.side !== 'DEBIT' && line.side !== 'CREDIT') throw new DomainError('LEDGER_INVALID', `bad side ${line.side}`);
    }

    // Balanced: within each currency, total debits must equal total credits.
    // (An entry may touch two currencies only if each one balances on its own;
    //  the FX position accounts 3000/3100 carry the conversion.)
    const debitsByCurrency: Record<string, bigint> = {};
    const creditsByCurrency: Record<string, bigint> = {};
    for (const line of lines) {
      debitsByCurrency[line.currency] ??= 0n;
      creditsByCurrency[line.currency] ??= 0n;
      if (line.side === 'DEBIT') debitsByCurrency[line.currency] += line.amount;
      else creditsByCurrency[line.currency] += line.amount;
    }
    for (const currency of Object.keys(debitsByCurrency)) {
      if (debitsByCurrency[currency] !== creditsByCurrency[currency]) {
        throw new DomainError('LEDGER_UNBALANCED',
          `entry ${reference} does not balance in ${currency}: debits ${debitsByCurrency[currency]} != credits ${creditsByCurrency[currency]}`);
      }
    }

    // ---------- 2. One transaction ----------
    try {
      return await this.prisma.$transaction(async (tx) => {
        // 2a. Lock the head row. Any other postEntry now waits here until we commit,
        //     so sequence numbers are gapless and every entry sees the true previous hash.
        const heads = await tx.$queryRaw<{ last_seq: bigint; last_hash: string }[]>`
          SELECT last_seq, last_hash FROM ledger_head WHERE id = 1 FOR UPDATE`;
        if (heads.length === 0) throw new Error('ledger_head row is missing (run the ledger_guards migration)');
        const head = heads[0];

        // 2b. Idempotency: checked AFTER taking the lock, so two concurrent calls with the
        //     same reference cannot both pass this check.
        const existing = await tx.journalEntry.findUnique({ where: { reference } });
        if (existing) return this.toPosted(existing, true);

        // 2c. Every account must exist, and the line currency must match the account currency.
        const codes = [...new Set(lines.map((l) => l.accountCode))];
        const accounts = await tx.ledgerAccount.findMany({ where: { code: { in: codes } } });
        for (const line of lines) {
          const account = accounts.find((a) => a.code === line.accountCode);
          if (!account) throw new DomainError('LEDGER_INVALID', `unknown ledger account ${line.accountCode}`);
          if (account.currency !== line.currency) {
            throw new DomainError('LEDGER_INVALID', `account ${line.accountCode} is ${account.currency}, line is ${line.currency}`);
          }
        }

        // 2d. Caller's guard runs under the lock (e.g. the overdraft check in reserve()).
        //     Throwing here rolls the whole transaction back.
        if (opts.guard) await opts.guard(tx);

        // 2e. Next sequence number and the hash that links this entry to the previous one.
        const seq = head.last_seq + 1n;
        const prevHash = head.last_hash;
        // created_at is part of the hash. A JS Date has millisecond precision, the same as the
        // TIMESTAMP(3) column, so the value read back later is identical to the one hashed now.
        const createdAt = new Date();
        const hashLines: HashLine[] = lines.map((l) => ({
          account_code: l.accountCode, side: l.side, amount: l.amount.toString(), currency: l.currency,
        }));
        const entryHash = computeEntryHash(prevHash, seq, reference, createdAt, hashLines);

        // 2f. Insert the entry, then its lines.
        const entry = await tx.journalEntry.create({
          data: {
            id: newId('je'),
            seq,
            reference,
            event: opts.event,
            transferId: opts.transferId ?? null,
            memo: opts.memo ?? null,
            prevHash,
            entryHash,
            createdAt,
          },
        });
        await tx.journalLine.createMany({
          data: lines.map((l) => ({
            id: newId('jl'),
            entryId: entry.id,
            accountCode: l.accountCode,
            side: l.side,
            amount: l.amount,
            currency: l.currency,
          })),
        });

        // Move the head forward. The next posting will chain from this entry.
        await tx.ledgerHead.update({ where: { id: 1 }, data: { lastSeq: seq, lastHash: entryHash } });

        return this.toPosted(entry, false);
      }, { timeout: 15000, maxWait: 15000 });
    } catch (err) {
      // Safety net: if a unique index on reference fired anyway (should not happen under the
      // lock), the entry exists, so behave exactly like the idempotent path.
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        const existing = await this.prisma.journalEntry.findUnique({ where: { reference } });
        if (existing) return this.toPosted(existing, true);
      }
      throw err;
    }
  }

  /** Map a journal_entries row to the PostedEntry shape callers receive. */
  private toPosted(e: { id: string; seq: bigint; reference: string; entryHash: string; prevHash: string; createdAt: Date }, duplicate: boolean): PostedEntry {
    return { id: e.id, seq: e.seq, reference: e.reference, entryHash: e.entryHash, prevHash: e.prevHash, createdAt: e.createdAt, duplicate };
  }

  /** Sum of debits and credits on one account, straight from journal_lines (balances are never stored). */
  private async sums(accountCode: string, db: Db): Promise<{ debit: bigint; credit: bigint }> {
    const rows = await db.$queryRaw<{ debit: bigint; credit: bigint }[]>`
      SELECT COALESCE(SUM(amount) FILTER (WHERE side = 'DEBIT'), 0)::bigint  AS debit,
             COALESCE(SUM(amount) FILTER (WHERE side = 'CREDIT'), 0)::bigint AS credit
      FROM journal_lines WHERE account_code = ${accountCode}`;
    return { debit: BigInt(rows[0].debit), credit: BigInt(rows[0].credit) };
  }

  /** Net credit balance of a liability account (credits - debits), in minor units. */
  async liabilityBalance(accountCode: string, tx?: Prisma.TransactionClient): Promise<bigint> {
    const s = await this.sums(accountCode, tx ?? this.prisma);
    return s.credit - s.debit;
  }

  /** Net debit balance of an asset account (debits - credits). */
  async assetBalance(accountCode: string, tx?: Prisma.TransactionClient): Promise<bigint> {
    const s = await this.sums(accountCode, tx ?? this.prisma);
    return s.debit - s.credit;
  }

  /** SME balances in kobo, derived from 2000-{sme} and 2100-{sme}. Never stored. */
  async smeBalances(smeId: string): Promise<{ available: bigint; held: bigint }> {
    const available = await this.liabilityBalance(`2000-${smeId}`);
    const held = await this.liabilityBalance(`2100-${smeId}`);
    return { available, held };
  }

  /** Creates 2000-{sme} and 2100-{sme} ledger_accounts rows if missing. */
  async ensureSmeAccounts(smeId: string, tx?: Prisma.TransactionClient): Promise<void> {
    const db = tx ?? this.prisma;
    const wanted = [
      { code: `2000-${smeId}`, name: `SME available (${smeId})` },
      { code: `2100-${smeId}`, name: `SME held (${smeId})` },
    ];
    for (const a of wanted) {
      // skipDuplicates makes this safe to call repeatedly and concurrently (unique code).
      await db.ledgerAccount.createMany({
        data: [{ id: newId('la'), code: a.code, name: a.name, type: 'LIABILITY', currency: 'NGN', ownerSmeId: smeId }],
        skipDuplicates: true,
      });
    }
  }

  /**
   * Walk every entry in seq order and recompute its hash.
   * Breaks at the first entry where: seq is not the next number, prev_hash is not the previous
   * entry's hash, or the stored entry_hash does not match the recomputed one (a row was altered).
   */
  async verifyChain(): Promise<VerifyResult> {
    let expectedSeq = 1n;
    let expectedPrev = GENESIS_HASH;
    let checked = 0;
    const pageSize = 500;

    while (true) {
      const entries = await this.prisma.journalEntry.findMany({
        where: { seq: { gte: expectedSeq } },
        orderBy: { seq: 'asc' },
        take: pageSize,
        include: { lines: true },
      });
      if (entries.length === 0) break;

      for (const e of entries) {
        const hashLines: HashLine[] = e.lines.map((l) => ({
          account_code: l.accountCode, side: l.side, amount: l.amount.toString(), currency: l.currency,
        }));
        const recomputed = computeEntryHash(e.prevHash, e.seq, e.reference, e.createdAt, hashLines);
        const ok = e.seq === expectedSeq && e.prevHash === expectedPrev && e.entryHash === recomputed;
        if (!ok) return { ok: false, broken_at: e.seq.toString(), checked };
        checked++;
        expectedSeq = e.seq + 1n;
        expectedPrev = e.entryHash;
      }
      if (entries.length < pageSize) break;
    }
    return { ok: true, broken_at: null, checked };
  }

  /** Debits minus credits per currency across the whole journal. Each must be zero. */
  async trialBalance(): Promise<TrialBalance> {
    const rows = await this.prisma.$queryRaw<{ currency: string; net: bigint }[]>`
      SELECT currency,
             COALESCE(SUM(CASE WHEN side = 'DEBIT' THEN amount ELSE -amount END), 0)::bigint AS net
      FROM journal_lines GROUP BY currency`;
    const result: TrialBalance = { NGN: 0n, USD: 0n, ok: true };
    for (const r of rows) {
      if (r.currency === 'NGN' || r.currency === 'USD') result[r.currency] = BigInt(r.net);
      else if (BigInt(r.net) !== 0n) result.ok = false;
    }
    result.ok = result.ok && result.NGN === 0n && result.USD === 0n;
    return result;
  }

  /** Debit/credit totals per account. With aggregateSme, all 2000-* and 2100-* fold into "2000"/"2100". */
  async accountBalances(opts?: { aggregateSme?: boolean }): Promise<AccountBalance[]> {
    const rows = await this.prisma.$queryRaw<{ code: string; name: string; type: string; currency: string; debit: bigint; credit: bigint }[]>`
      SELECT a.code, a.name, a.type::text AS type, a.currency,
             COALESCE(SUM(l.amount) FILTER (WHERE l.side = 'DEBIT'), 0)::bigint  AS debit,
             COALESCE(SUM(l.amount) FILTER (WHERE l.side = 'CREDIT'), 0)::bigint AS credit
      FROM ledger_accounts a
      LEFT JOIN journal_lines l ON l.account_code = a.code
      GROUP BY a.code, a.name, a.type, a.currency
      ORDER BY a.code`;

    const out: AccountBalance[] = [];
    const folded: Record<string, AccountBalance> = {};
    for (const r of rows) {
      const debit = BigInt(r.debit), credit = BigInt(r.credit);
      const smePrefix = r.code.startsWith('2000-') ? '2000' : r.code.startsWith('2100-') ? '2100' : null;
      if (opts?.aggregateSme && smePrefix) {
        folded[smePrefix] ??= {
          code: smePrefix, name: smePrefix === '2000' ? 'SME available (all SMEs)' : 'SME held (all SMEs)',
          type: r.type, currency: r.currency, debit: 0n, credit: 0n, net: 0n,
        };
        folded[smePrefix].debit += debit;
        folded[smePrefix].credit += credit;
        folded[smePrefix].net = folded[smePrefix].debit - folded[smePrefix].credit;
      } else {
        out.push({ code: r.code, name: r.name, type: r.type, currency: r.currency, debit, credit, net: debit - credit });
      }
    }
    out.push(...Object.values(folded));
    return out.sort((a, b) => (a.code < b.code ? -1 : a.code > b.code ? 1 : 0));
  }

  /** Latest entries (newest first) with their lines, in API (snake_case) shape. */
  async recentEntries(limit = 50): Promise<any[]> {
    const entries = await this.prisma.journalEntry.findMany({
      orderBy: { seq: 'desc' },
      take: limit,
      include: { lines: true },
    });
    return entries.map((e) => this.toApiEntry(e));
  }

  /**
   * One page of the journal, newest first. Optional `q` matches the reference (case-insensitive),
   * e.g. a transfer id or "INFLOW". Read-only: pagination never touches the hash chain.
   */
  async entriesPage(opts: { page?: number; pageSize?: number; q?: string }) {
    const pageSize = Math.min(Math.max(Math.trunc(opts.pageSize ?? 25) || 25, 1), 200);
    const page = Math.max(Math.trunc(opts.page ?? 1) || 1, 1);
    const q = opts.q?.trim();
    const where: Prisma.JournalEntryWhereInput = q ? { reference: { contains: q, mode: 'insensitive' } } : {};
    const [total, rows] = await Promise.all([
      this.prisma.journalEntry.count({ where }),
      this.prisma.journalEntry.findMany({
        where,
        orderBy: { seq: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
        include: { lines: true },
      }),
    ]);
    return {
      items: rows.map((e) => this.toApiEntry(e)),
      total,
      page,
      page_size: pageSize,
      total_pages: Math.max(Math.ceil(total / pageSize), 1),
    };
  }

  private toApiEntry(e: Prisma.JournalEntryGetPayload<{ include: { lines: true } }>) {
    return ({
      id: e.id,
      seq: e.seq.toString(),
      reference: e.reference,
      event: e.event,
      transfer_id: e.transferId,
      memo: e.memo,
      created_at: e.createdAt.toISOString(),
      prev_hash: e.prevHash,
      entry_hash: e.entryHash,
      lines: e.lines.map((l) => ({ account_code: l.accountCode, side: l.side, amount: l.amount.toString(), currency: l.currency })),
    });
  }

  /** Number of journal entries (used by the ops ledger view). */
  async entryCount(): Promise<number> {
    return this.prisma.journalEntry.count();
  }
}
