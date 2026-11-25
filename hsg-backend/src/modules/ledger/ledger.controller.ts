import { Controller, Get, HttpCode, Post, Query } from '@nestjs/common';
import { Roles } from '../auth/auth.guard';
import { LedgerService } from './ledger.service';

/** Operator ledger views (docs/API-CONTRACT.md: GET /ops/ledger, POST /ops/ledger/verify). */
@Controller('ops')
@Roles('OPERATOR')
export class LedgerController {
  constructor(private readonly ledger: LedgerService) {}

  /** Trial balance, account balances (SME accounts folded into 2000/2100), last 50 entries, entry count. */
  @Get('ledger')
  async overview() {
    const [trial_balance, accounts, entries, entry_count] = await Promise.all([
      this.ledger.trialBalance(),
      this.ledger.accountBalances({ aggregateSme: true }),
      this.ledger.recentEntries(50),
      this.ledger.entryCount(),
    ]);
    return { trial_balance, accounts, entries, entry_count };
  }

  /** GET /ops/ledger/entries?page=1&page_size=25&q=INFLOW — paginated journal, newest first. */
  @Get('ledger/entries')
  entries(@Query('page') page?: string, @Query('page_size') pageSize?: string, @Query('q') q?: string) {
    return this.ledger.entriesPage({ page: Number(page ?? 1), pageSize: Number(pageSize ?? 25), q });
  }

  /** Recompute every hash in seq order. {ok, broken_at, checked} */
  @Post('ledger/verify')
  @HttpCode(200)
  async verify() {
    return this.ledger.verifyChain();
  }
}
