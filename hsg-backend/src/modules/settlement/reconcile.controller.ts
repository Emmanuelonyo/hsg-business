import { Controller, HttpCode, Post } from '@nestjs/common';
import { Roles, CurrentUser, AuthUser } from '../auth/auth.guard';
import { ACCT } from '../../common/accounts';
import { AuditService } from '../../common/audit.service';
import { PrismaService } from '../../common/prisma.service';
import { LedgerService } from '../ledger/ledger.service';
import { SettlementService } from './settlement.service';

/**
 * POST /ops/reconcile (OPERATOR) — TC13.
 * Compares what the ledger says the treasury holds (account 1100, Stablecoin reserve, USD cents)
 * with what the treasury wallets actually hold on chain. variance_cents = onchain - ledger:
 * negative means tokens left the treasury without a ledger entry.
 */
@Controller('ops/reconcile')
@Roles('OPERATOR')
export class ReconcileController {
  constructor(
    private readonly settlement: SettlementService,
    private readonly ledger: LedgerService,
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  @Post()
  @HttpCode(200)
  async reconcile(@CurrentUser() user: AuthUser) {
    const ledgerCents = await this.ledger1100();
    const wallets = await this.settlement.treasuryBalances();
    const onchainCents = wallets.reduce((s, w) => s + w.balanceCents, 0n);
    const result = {
      ledger_1100_cents: ledgerCents.toString(),
      onchain_cents: onchainCents.toString(),
      variance_cents: (onchainCents - ledgerCents).toString(),
      wallets: wallets.map((w) => ({ address: w.address, label: w.label, balance_cents: w.balanceCents.toString() })),
      checked_at: new Date().toISOString(),
    };
    await this.audit.log(user?.userId ?? 'system', 'RECONCILE', 'ledger_account', ACCT.STABLECOIN_RESERVE, result);
    return result;
  }

  /** Ledger balance of 1100 (debits - credits). Uses LedgerService; falls back to a direct SUM if it is not ready. */
  private async ledger1100(): Promise<bigint> {
    try {
      return await this.ledger.assetBalance(ACCT.STABLECOIN_RESERVE);
    } catch {
      const rows = await this.prisma.$queryRaw<{ net: bigint }[]>`
        SELECT COALESCE(SUM(CASE WHEN side = 'DEBIT' THEN amount ELSE -amount END), 0)::bigint AS net
        FROM journal_lines WHERE account_code = ${ACCT.STABLECOIN_RESERVE}`;
      return BigInt(rows[0]?.net ?? 0);
    }
  }
}
