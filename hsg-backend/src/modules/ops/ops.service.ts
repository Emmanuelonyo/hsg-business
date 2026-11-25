import { Injectable } from '@nestjs/common';
import { Prisma, TransferState } from '@prisma/client';
import { createPublicClient, http } from 'viem';
import { PrismaService } from '../../common/prisma.service';
import { ApiError } from '../../common/errors';
import { ENV } from '../../common/config';
import { ACCT } from '../../common/accounts';
import { LedgerService } from '../ledger/ledger.service';
import { SettlementService } from '../settlement/settlement.service';

/**
 * Operator read models (O1 overview, O2 transfer list + detail).
 * Read-only: nothing here writes to the database. Money stays bigint and is
 * serialised as a string by installBigIntJson().
 */

const ALL_STATES: TransferState[] = [
  'CREATED', 'SCREENING', 'HELD', 'RESERVED', 'ONCHAIN_PENDING', 'ONCHAIN_CONFIRMED',
  'PAYOUT_PENDING', 'COMPLETED', 'REVERSING', 'REVERSED', 'DECLINED',
];

/** Midnight (server local time) of the current day. "Today" for the overview counters. */
function startOfToday(): Date {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d;
}

/** Seconds between two dates, 1 decimal place; null if not finished. */
function secondsBetween(from: Date, to: Date | null): number | null {
  if (!to) return null;
  return Math.round((to.getTime() - from.getTime()) / 100) / 10;
}

@Injectable()
export class OpsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly ledger: LedgerService,
    private readonly settlement: SettlementService,
  ) {}

  // ---------------------------------------------------------------- O1 overview
  async overview() {
    const today = startOfToday();

    // 1. Count of transfers created today, per state (every state present, zero if none).
    const grouped = await this.prisma.transfer.groupBy({
      by: ['status'],
      where: { createdAt: { gte: today } },
      _count: { _all: true },
    });
    const counts_today: Record<string, number> = {};
    for (const s of ALL_STATES) counts_today[s] = 0;
    for (const g of grouped) counts_today[g.status] = g._count._all;

    // 2. p95 settlement time over transfers completed today, computed by Postgres.
    const p95Rows = await this.prisma.$queryRaw<{ p95: number | null }[]>(Prisma.sql`
      SELECT percentile_cont(0.95) WITHIN GROUP (
               ORDER BY EXTRACT(EPOCH FROM (completed_at - created_at))
             )::float8 AS p95
        FROM transfers
       WHERE status = 'COMPLETED'
         -- columns are UTC timestamp(3) without zone; compare in UTC regardless of session TimeZone
         AND completed_at >= (${today.toISOString()}::timestamptz AT TIME ZONE 'UTC')`);
    const p95 = p95Rows[0]?.p95;
    const p95_settlement_seconds = p95 == null ? null : Math.round(Number(p95) * 10) / 10;

    const completed_today = await this.prisma.transfer.count({
      where: { status: 'COMPLETED', completedAt: { gte: today } },
    });

    // 3. Naira returned to SMEs today (sum of total_ngn on transfers reversed today).
    const reversed = await this.prisma.transfer.aggregate({
      where: { status: 'REVERSED', reversedAt: { gte: today } },
      _sum: { totalNgn: true },
    });
    const total_reversed_ngn = reversed._sum.totalNgn ?? 0n;

    // 4. Treasury: on-chain balance vs ledger account 1100. Each side is fetched
    //    independently so the page still renders if the chain or ledger is down.
    let onchain: bigint | null = null;
    let ledger1100: bigint | null = null;
    try { onchain = await this.settlement.treasuryOnchainCents(); } catch { onchain = null; }
    try { ledger1100 = await this.ledger.assetBalance(ACCT.STABLECOIN_RESERVE); } catch { ledger1100 = null; }
    const treasury = {
      onchain_cents: onchain,
      ledger_1100_cents: ledger1100,
      variance_cents: onchain != null && ledger1100 != null ? onchain - ledger1100 : null,
    };

    return { counts_today, p95_settlement_seconds, completed_today, total_reversed_ngn, treasury };
  }

  // ---------------------------------------------------------------- O4 treasury tab

  /**
   * Live token balances of every wallet the gateway controls, read from the chain now,
   * set against ledger account 1100 (which should equal the TREASURY total).
   * Provider wallets are shown for context (tokens in flight / returned in TC14); they are not part of 1100.
   */
  async treasury() {
    // TREASURY sorts before PROVIDER (enum declaration order).
    const wallets = await this.prisma.wallet.findMany({ orderBy: [{ kind: 'asc' }, { keyIndex: 'asc' }] });
    const providers = await this.prisma.liquidityProvider.findMany({ select: { name: true, walletAddress: true } });
    const providerName = new Map(providers.map((p) => [p.walletAddress.toLowerCase(), p.name]));
    let chainError: string | null = null;
    const rows = await Promise.all(
      wallets.map(async (w) => {
        let balance: bigint | null = null;
        try {
          balance = await this.settlement.tokenBalanceCents(w.address as `0x${string}`);
        } catch (e: any) {
          chainError = e?.shortMessage ?? e?.message ?? 'chain unreachable';
        }
        const [sent, received] = await Promise.all([
          this.prisma.chainTransaction.count({ where: { fromAddress: { equals: w.address, mode: 'insensitive' } } }),
          this.prisma.chainTransaction.count({ where: { toAddress: { equals: w.address, mode: 'insensitive' } } }),
        ]);
        return {
          label: w.label,
          kind: w.kind,
          address: w.address,
          provider_name: w.kind === 'PROVIDER' ? providerName.get(w.address.toLowerCase()) ?? null : null,
          balance_cents: balance === null ? null : balance.toString(),
          tx_sent: sent,
          tx_received: received,
        };
      }),
    );
    const onchain = rows
      .filter((r) => r.kind === 'TREASURY' && r.balance_cents !== null)
      .reduce((s, r) => s + BigInt(r.balance_cents!), 0n);
    const ledger1100 = await this.ledger.assetBalance(ACCT.STABLECOIN_RESERVE);
    return {
      wallets: rows,
      treasury_onchain_cents: onchain.toString(),
      ledger_1100_cents: ledger1100.toString(),
      variance_cents: chainError ? null : (onchain - ledger1100).toString(),
      token: (() => { try { return this.settlement.tokenAddress(); } catch { return null; } })(),
      chain_error: chainError,
      read_at: new Date().toISOString(),
    };
  }

  // ---------------------------------------------------------------- O2 list
  async listTransfers(q: { state?: string; q?: string; limit?: string; since?: string }) {
    const where: Prisma.TransferWhereInput = {};

    if (q.state) {
      const states = q.state.split(',').map((s) => s.trim().toUpperCase());
      for (const s of states) {
        if (!ALL_STATES.includes(s as TransferState)) throw new ApiError('VALIDATION_ERROR', `Unknown state ${s}`);
      }
      where.status = { in: states as TransferState[] };
    }
    if (q.q && q.q.trim()) {
      const term = q.q.trim();
      where.OR = [
        { reference: { contains: term, mode: 'insensitive' } },
        { id: term },
        { sme: { legalName: { contains: term, mode: 'insensitive' } } },
        { beneficiary: { name: { contains: term, mode: 'insensitive' } } },
      ];
    }
    if (q.since) {
      const since = new Date(q.since);
      if (Number.isNaN(since.getTime())) throw new ApiError('VALIDATION_ERROR', 'since must be an ISO date');
      where.createdAt = { gte: since };
    }
    // Default 100, hard cap 1000 (the load test reads a whole 500-transfer run in one call).
    const limit = Math.min(Math.max(Number(q.limit) || 100, 1), 1000);

    const rows = await this.prisma.transfer.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: limit,
      include: {
        sme: { select: { id: true, legalName: true } },
        beneficiary: { select: { name: true } },
        payoutOrder: { select: { provider: { select: { name: true } } } },
      },
    });

    return {
      items: rows.map((t) => ({
        id: t.id,
        reference: t.reference,
        state: t.status,
        sme: { id: t.sme.id, legal_name: t.sme.legalName },
        beneficiary_name: t.beneficiary.name,
        usd_amount: t.usdAmount,
        total_ngn: t.totalNgn,
        rate: t.rate,
        provider_name: t.payoutOrder?.provider.name ?? null,
        current_step: t.currentStep,
        created_at: t.createdAt,
        completed_at: t.completedAt,
        settlement_seconds: secondsBetween(t.createdAt, t.completedAt),
      })),
    };
  }

  // ---------------------------------------------------------------- O2 detail
  async transferDetail(id: string) {
    const t = await this.prisma.transfer.findUnique({
      where: { id },
      include: {
        sme: { select: { id: true, legalName: true, kybStatus: true } },
        beneficiary: true,
        quote: true,
        sagaSteps: { orderBy: [{ startedAt: 'asc' }, { attempt: 'asc' }] },
        complianceChecks: { orderBy: { createdAt: 'asc' } },
        chainTransactions: { orderBy: { createdAt: 'asc' } },
        payoutOrder: { include: { provider: { select: { id: true, name: true, adapter: true } } } },
      },
    });
    if (!t) throw new ApiError('NOT_FOUND', 'Transfer not found');

    // Journal entries for this transfer: linked by transfer_id, or by the `{id}:{EVENT}` reference convention.
    const entries = await this.prisma.journalEntry.findMany({
      where: { OR: [{ transferId: id }, { reference: { startsWith: `${id}:` } }] },
      include: { lines: true },
      orderBy: { seq: 'asc' },
    });

    // Confirmations need the current block height; best effort, null if the chain is unreachable.
    const head = t.chainTransactions.length ? await this.currentBlock() : null;

    return {
      transfer: {
        id: t.id,
        reference: t.reference,
        state: t.status,
        current_step: t.currentStep,
        failure_reason: t.failureReason,
        held_rule: t.heldRule,
        purpose: t.purpose,
        travel_rule: t.travelRule,
        usd_amount: t.usdAmount,
        principal_ngn: t.principalNgn,
        fee_ngn: t.feeNgn,
        total_ngn: t.totalNgn,
        rate: t.rate,
        treasury_wallet: t.treasuryWallet,
        timestamps: {
          created_at: t.createdAt,
          screening_at: t.screeningAt,
          held_at: t.heldAt,
          reserved_at: t.reservedAt,
          onchain_pending_at: t.onchainPendingAt,
          onchain_confirmed_at: t.onchainConfirmedAt,
          payout_pending_at: t.payoutPendingAt,
          completed_at: t.completedAt,
          reversing_at: t.reversingAt,
          reversed_at: t.reversedAt,
          declined_at: t.declinedAt,
        },
      },
      sme: { id: t.sme.id, legal_name: t.sme.legalName, kyb_status: t.sme.kybStatus },
      beneficiary: {
        id: t.beneficiary.id,
        name: t.beneficiary.name,
        country: t.beneficiary.country,
        bank_name: t.beneficiary.bankName,
        account_number: t.beneficiary.accountNumber,
        swift_bic: t.beneficiary.swiftBic,
        address: t.beneficiary.address,
        screening_status: t.beneficiary.screeningStatus,
      },
      quote: {
        id: t.quote.id,
        rate: t.quote.rate,
        reference_rate: t.quote.referenceRate,
        expires_at: t.quote.expiresAt,
      },
      saga_steps: t.sagaSteps.map((s) => ({
        id: s.id, step: s.step, attempt: s.attempt, status: s.status,
        started_at: s.startedAt, ended_at: s.endedAt, error: s.error,
      })),
      compliance_checks: t.complianceChecks.map((c) => ({
        id: c.id, gate: c.gate, result: c.result, detail: c.detail, created_at: c.createdAt,
      })),
      journal_entries: entries.map((e) => ({
        seq: e.seq,
        reference: e.reference,
        event: e.event,
        created_at: e.createdAt,
        entry_hash: e.entryHash,
        prev_hash: e.prevHash,
        lines: e.lines.map((l) => ({ account_code: l.accountCode, side: l.side, amount: l.amount, currency: l.currency })),
      })),
      chain_transactions: t.chainTransactions.map((c) => ({
        id: c.id,
        kind: c.kind,
        from_address: c.fromAddress,
        to_address: c.toAddress,
        token_amount: c.tokenAmount,
        tx_hash: c.txHash,
        explorer_url: this.safeExplorerUrl(c.txHash),
        nonce: c.nonce,
        status: c.status,
        block_number: c.blockNumber,
        confirmations: head != null && c.blockNumber != null ? Number(head - c.blockNumber + 1n) : 0,
        gas_used: c.gasUsed,
        created_at: c.createdAt,
        confirmed_at: c.confirmedAt,
      })),
      payout_order: t.payoutOrder
        ? {
            id: t.payoutOrder.id,
            provider: t.payoutOrder.provider,
            usd_amount: t.payoutOrder.usdAmount,
            rate: t.payoutOrder.rate,
            score: t.payoutOrder.score,
            status: t.payoutOrder.status,
            external_ref: t.payoutOrder.externalRef,
            failure: t.payoutOrder.failure,
            created_at: t.payoutOrder.createdAt,
            paid_at: t.payoutOrder.paidAt,
          }
        : null,
    };
  }

  private safeExplorerUrl(txHash: string): string | null {
    try { return this.settlement.explorerUrl(txHash); } catch { return null; }
  }

  private async currentBlock(): Promise<bigint | null> {
    try {
      const client = createPublicClient({ transport: http(ENV.rpcUrl, { timeout: 1500, retryCount: 0 }) });
      return await client.getBlockNumber();
    } catch {
      return null;
    }
  }
}
