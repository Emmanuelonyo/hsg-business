import { Body, Controller, Get, Param, Put } from '@nestjs/common';
import { LiquidityProvider } from '@prisma/client';
import { Roles } from '../auth/auth.guard';
import { PrismaService } from '../../common/prisma.service';
import { FaultsService, Faults } from '../../common/faults.service';
import { ApiError } from '../../common/errors';

/** Liquidity provider simulator + fault switches (operator console O5). */
@Controller('sim')
@Roles('OPERATOR')
export class ProvidersSimController {
  constructor(private readonly prisma: PrismaService, private readonly faults: FaultsService) {}

  /** GET /sim/providers */
  @Get('providers')
  async list() {
    const rows = await this.prisma.liquidityProvider.findMany({ orderBy: { name: 'asc' } });
    return { items: rows.map(view) };
  }

  /** PUT /sim/providers/:id {rate?, capacity_usd?, reliability?, payout_delay_ms?, active?} */
  @Put('providers/:id')
  async update(@Param('id') id: string, @Body() body: any) {
    const existing = await this.prisma.liquidityProvider.findUnique({ where: { id } });
    if (!existing) throw new ApiError('NOT_FOUND', 'Provider not found');
    const data: Record<string, unknown> = {};
    if (body?.rate !== undefined) {
      if (!/^\d+(\.\d{1,2})?$/.test(String(body.rate))) throw new ApiError('VALIDATION_ERROR', 'rate must be a decimal like "1580.00"');
      data.rate = Number(body.rate).toFixed(2);
    }
    if (body?.capacity_usd !== undefined) {
      if (!/^\d+$/.test(String(body.capacity_usd))) throw new ApiError('VALIDATION_ERROR', 'capacity_usd must be a whole number of cents');
      data.capacityUsd = BigInt(body.capacity_usd);
    }
    if (body?.reliability !== undefined) {
      const r = Number(body.reliability);
      if (!Number.isFinite(r) || r < 0 || r > 1) throw new ApiError('VALIDATION_ERROR', 'reliability must be between 0 and 1');
      data.reliability = r;
    }
    if (body?.payout_delay_ms !== undefined) {
      const d = Number(body.payout_delay_ms);
      if (!Number.isInteger(d) || d < 0) throw new ApiError('VALIDATION_ERROR', 'payout_delay_ms must be a non-negative integer');
      data.payoutDelayMs = d;
    }
    if (body?.active !== undefined) {
      if (typeof body.active !== 'boolean') throw new ApiError('VALIDATION_ERROR', 'active must be true or false');
      data.active = body.active;
    }
    const row = await this.prisma.liquidityProvider.update({ where: { id }, data });
    return view(row);
  }

  /** GET /sim/faults */
  @Get('faults')
  getFaults() { return this.faults.get(); }

  /** PUT /sim/faults (partial) */
  @Put('faults')
  async setFaults(@Body() body: any) {
    const patch: Partial<Faults> = {};
    if (body?.payoutHardFail !== undefined) {
      if (typeof body.payoutHardFail !== 'boolean') throw new ApiError('VALIDATION_ERROR', 'payoutHardFail must be true or false');
      patch.payoutHardFail = body.payoutHardFail;
    }
    if (body?.providersOutOfCapacity !== undefined) {
      if (typeof body.providersOutOfCapacity !== 'boolean') throw new ApiError('VALIDATION_ERROR', 'providersOutOfCapacity must be true or false');
      patch.providersOutOfCapacity = body.providersOutOfCapacity;
    }
    if (body?.chainDelaySeconds !== undefined) {
      const s = Number(body.chainDelaySeconds);
      if (!Number.isFinite(s) || s < 0 || s > 3600) throw new ApiError('VALIDATION_ERROR', 'chainDelaySeconds must be 0 to 3600');
      patch.chainDelaySeconds = s;
    }
    return this.faults.set(patch);
  }
}

function view(p: LiquidityProvider) {
  return {
    id: p.id, name: p.name, rate: p.rate, capacity_usd: p.capacityUsd.toString(), reliability: p.reliability,
    payout_delay_ms: p.payoutDelayMs, adapter: p.adapter, active: p.active, wallet_address: p.walletAddress,
  };
}
