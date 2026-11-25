import { Controller, Get, Param, Query } from '@nestjs/common';
import { Roles } from '../auth/auth.guard';
import { OpsService } from './ops.service';

/** Operator read models: O1 overview and O2 transfer list/detail. OPERATOR only. */
@Controller('ops')
@Roles('OPERATOR')
export class OpsController {
  constructor(private readonly ops: OpsService) {}

  /** GET /api/ops/overview */
  @Get('overview')
  overview() {
    return this.ops.overview();
  }

  /** GET /api/ops/treasury — live on-chain balances of treasury + provider wallets vs ledger 1100. */
  @Get('treasury')
  treasury() {
    return this.ops.treasury();
  }

  /** GET /api/ops/transfers?state=COMPLETED&q=HSG-...&limit=100&since=ISO */
  @Get('transfers')
  list(
    @Query('state') state?: string,
    @Query('q') q?: string,
    @Query('limit') limit?: string,
    @Query('since') since?: string,
  ) {
    return this.ops.listTransfers({ state, q, limit, since });
  }

  /** GET /api/ops/transfers/:id */
  @Get('transfers/:id')
  detail(@Param('id') id: string) {
    return this.ops.transferDetail(id);
  }
}
