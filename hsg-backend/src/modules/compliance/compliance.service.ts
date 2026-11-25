import { Injectable } from '@nestjs/common';
import { CheckResult } from '@prisma/client';
import { PrismaService } from '../../common/prisma.service';
import { CONFIG } from '../../common/config';
import { newId } from '../../common/ids';
import { formatMinor } from '../../common/money';
import { nameMatch, sameCountry } from './screening';

export interface ScreenResult { status: 'CLEARED' | 'BLOCKED'; matched?: { name: string; country: string; method: 'exact' | 'token_set' } | null; }
export type GateOutcome = { outcome: 'PASS' } | { outcome: 'HELD'; rule: string; reason: string } | { outcome: 'DECLINED'; rule: string; reason: string };

/** The five transfer gates, in the order SCREEN evaluates them. */
export const TRANSFER_GATES = ['KYB', 'SANCTIONS', 'TRAVEL_RULE', 'THRESHOLD', 'VELOCITY'] as const;

/** One evaluated gate, before it is written to compliance_checks. */
interface GateRow { gate: string; result: CheckResult; detail: Record<string, unknown>; }

/**
 * Plain-language reasons. DECLINED reasons end up in transfers.failure_reason (shown to the SME),
 * so they use banking words only.
 */
const REASONS = {
  KYB: 'Your business verification is not complete, so this payment cannot be sent.',
  SANCTIONS: 'The beneficiary did not pass our compliance screening, so this payment was declined.',
  TRAVEL_RULE: 'Sender or beneficiary details are incomplete (name, account and address are required).',
  THRESHOLD: `Amount is above the USD ${formatMinor(CONFIG.THRESHOLD_USD_CENTS)} single-transfer review threshold.`,
  VELOCITY: `More than ${CONFIG.VELOCITY_MAX} transfers from this business within ${CONFIG.VELOCITY_WINDOW_MIN} minutes.`,
};

/** CONTRACT (owned by the Fiat+Compliance agent). */
@Injectable()
export class ComplianceService {
  constructor(private readonly prisma: PrismaService) {}

  /** Sanctions match of a name+country against watchlist: case-insensitive, exact or token-set match. */
  async screenName(name: string, country: string): Promise<ScreenResult> {
    // The watchlist is small (tens of rows), so compare in memory with the same rule for every row.
    // Filter by country in SQL first (case-insensitive) since a match requires the same country.
    const rows = await this.prisma.watchlist.findMany({
      where: { country: { equals: country.trim(), mode: 'insensitive' } },
    });
    // Prefer an exact match if there is one; otherwise the first token-set match.
    let best: ScreenResult['matched'] = null;
    for (const row of rows) {
      if (!sameCountry(row.country, country)) continue;
      const method = nameMatch(name, row.name);
      if (method === 'exact') return { status: 'BLOCKED', matched: { name: row.name, country: row.country, method } };
      if (method && !best) best = { name: row.name, country: row.country, method };
    }
    return best ? { status: 'BLOCKED', matched: best } : { status: 'CLEARED', matched: null };
  }

  /**
   * SCREEN step: runs KYB, SANCTIONS, TRAVEL_RULE, THRESHOLD, VELOCITY in order and writes one
   * compliance_checks row per gate evaluated. Stops after a DECLINED gate. Does NOT change the
   * transfer status (the saga's SCREEN step does that from the returned outcome).
   * Idempotent: if gate rows already exist for this transfer, the recorded outcome is returned.
   */
  async runTransferGates(transferId: string): Promise<GateOutcome> {
    // 1. Idempotency: a retried SCREEN job must not write a second set of rows.
    const recorded = await this.recordedOutcome(transferId);
    if (recorded) return recorded;

    const t = await this.prisma.transfer.findUniqueOrThrow({
      where: { id: transferId },
      include: { sme: true, beneficiary: true },
    });

    // 2. Evaluate the gates in order. Rows are collected first and written together below,
    //    so a crash part-way through never leaves a half-written set.
    const rows: GateRow[] = [];

    // KYB: the sending business must be VERIFIED.
    const kybOk = t.sme.kybStatus === 'VERIFIED';
    rows.push({ gate: 'KYB', result: kybOk ? 'PASS' : 'FAIL', detail: { rule: 'KYB', value: t.sme.kybStatus, ...(kybOk ? {} : { reason: REASONS.KYB }) } });

    // SANCTIONS: beneficiary name + country against the watchlist.
    if (kybOk) {
      const screen = await this.screenName(t.beneficiary.name, t.beneficiary.country);
      const clean = screen.status === 'CLEARED';
      rows.push({
        gate: 'SANCTIONS',
        result: clean ? 'PASS' : 'FAIL',
        detail: { rule: 'SANCTIONS', value: { name: t.beneficiary.name, country: t.beneficiary.country }, matched: screen.matched ?? null, ...(clean ? {} : { reason: REASONS.SANCTIONS }) },
      });
    }

    // TRAVEL_RULE: originator and beneficiary name, account and address all present.
    if (rows.every((r) => r.result !== 'FAIL')) {
      const tr = (t.travelRule ?? {}) as any;
      const missing: string[] = [];
      for (const party of ['originator', 'beneficiary']) {
        for (const field of ['name', 'account', 'address']) {
          const v = tr?.[party]?.[field];
          if (typeof v !== 'string' || v.trim() === '') missing.push(`${party}.${field}`);
        }
      }
      const ok = missing.length === 0;
      rows.push({ gate: 'TRAVEL_RULE', result: ok ? 'PASS' : 'FAIL', detail: { rule: 'TRAVEL_RULE', missing, ...(ok ? {} : { reason: REASONS.TRAVEL_RULE }) } });
    }

    if (rows.every((r) => r.result !== 'FAIL')) {
      // THRESHOLD: a single transfer above the limit is HELD for review.
      const over = t.usdAmount > CONFIG.THRESHOLD_USD_CENTS;
      rows.push({
        gate: 'THRESHOLD',
        result: over ? 'HOLD' : 'PASS',
        detail: { rule: 'THRESHOLD', value: t.usdAmount.toString(), limit: CONFIG.THRESHOLD_USD_CENTS.toString(), ...(over ? { reason: REASONS.THRESHOLD } : {}) },
      });

      // VELOCITY: count the SME's OTHER transfers created in the window ending at this transfer's creation.
      // If VELOCITY_MAX others already exist, this one is number VELOCITY_MAX+1 ("more than 5") -> HELD.
      const windowStart = new Date(t.createdAt.getTime() - CONFIG.VELOCITY_WINDOW_MIN * 60_000);
      const others = await this.prisma.transfer.count({
        where: { smeId: t.smeId, id: { not: t.id }, createdAt: { gte: windowStart, lte: t.createdAt } },
      });
      const tooMany = others >= CONFIG.VELOCITY_MAX;
      rows.push({
        gate: 'VELOCITY',
        result: tooMany ? 'HOLD' : 'PASS',
        detail: { rule: 'VELOCITY', value: others + 1, limit: CONFIG.VELOCITY_MAX, window_min: CONFIG.VELOCITY_WINDOW_MIN, ...(tooMany ? { reason: REASONS.VELOCITY } : {}) },
      });
    }

    // 3. Write all rows in one statement.
    await this.prisma.complianceCheck.createMany({
      data: rows.map((r) => ({
        id: newId('cc'), transferId, smeId: t.smeId, subject: 'TRANSFER', gate: r.gate, result: r.result, detail: r.detail as any,
      })),
    });
    return this.outcomeFrom(rows);
  }

  /** Outcome from the recorded gate rows for a transfer, or null if SCREEN has not run yet. */
  private async recordedOutcome(transferId: string): Promise<GateOutcome | null> {
    const existing = await this.prisma.complianceCheck.findMany({
      where: { transferId, subject: 'TRANSFER', gate: { in: [...TRANSFER_GATES] } },
    });
    if (existing.length === 0) return null;
    // Keep gate order so the first failing / holding gate is the one reported.
    existing.sort((a, b) => TRANSFER_GATES.indexOf(a.gate as any) - TRANSFER_GATES.indexOf(b.gate as any));
    return this.outcomeFrom(existing.map((c) => ({ gate: c.gate, result: c.result, detail: (c.detail ?? {}) as any })));
  }

  /** First FAIL -> DECLINED; else first HOLD -> HELD; else PASS. */
  private outcomeFrom(rows: GateRow[]): GateOutcome {
    const fail = rows.find((r) => r.result === 'FAIL');
    if (fail) return { outcome: 'DECLINED', rule: fail.gate, reason: String(fail.detail.reason ?? REASONS[fail.gate as keyof typeof REASONS] ?? 'Declined by compliance checks') };
    const hold = rows.find((r) => r.result === 'HOLD');
    if (hold) return { outcome: 'HELD', rule: hold.gate, reason: String(hold.detail.reason ?? REASONS[hold.gate as keyof typeof REASONS] ?? 'Held for review') };
    return { outcome: 'PASS' };
  }
}
