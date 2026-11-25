import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../common/prisma.service';
import { FaultsService } from '../../common/faults.service';
import { DomainError } from '../../common/errors';
import { newId } from '../../common/ids';
import { rankProviders } from './scoring';
import { PayoutPartner } from './payout-partner';
import { SimulatedAdapter } from './simulated-adapter';
import { BridgeAdapter } from './bridge-adapter';

export interface ProviderChoice { providerId: string; name: string; rate: string; score: number; walletAddress: `0x${string}`; }

/** CONTRACT (owned by the Saga agent). */
@Injectable()
export class LiquidityService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly faults: FaultsService,
    private readonly simulated: SimulatedAdapter,
    private readonly bridge: BridgeAdapter,
  ) {}

  /** Best quoting rate across active providers with capacity for `usdCents` (used by POST /quotes). Honors the providersOutOfCapacity fault. Returns null if none. */
  async bestRate(usdCents: bigint): Promise<string | null> {
    if ((await this.faults.get()).providersOutOfCapacity) return null;
    const providers = await this.prisma.liquidityProvider.findMany({ where: { active: true, capacityUsd: { gte: usdCents } } });
    if (providers.length === 0) return null;
    // Lowest NGN-per-USD is the best rate for the SME.
    providers.sort((a, b) => Number(a.rate) - Number(b.rate));
    return providers[0].rate;
  }

  /** MATCH: weighted score of rate, reliability, headroom; atomically decrements capacity; creates payout_orders row. Idempotent per transfer. Throws DomainError('NO_PROVIDER_CAPACITY') (hard) if none. */
  async match(transferId: string, usdCents: bigint): Promise<ProviderChoice> {
    // 1. Idempotency: a transfer is matched at most once. A retried MATCH returns the same order.
    const existing = await this.findChoice(transferId);
    if (existing) return existing;

    // 2. Fault switch (TC08 second run): behave as if every provider had zero capacity.
    if ((await this.faults.get()).providersOutOfCapacity) {
      throw new DomainError('NO_PROVIDER_CAPACITY', 'No liquidity provider has capacity for this payment', false);
    }

    try {
      return await this.prisma.$transaction(async (tx) => {
        // 3. Candidates: active providers that can cover the whole amount, ranked by score.
        const candidates = await tx.liquidityProvider.findMany({ where: { active: true, capacityUsd: { gte: usdCents } } });
        const ranked = rankProviders(candidates, usdCents);

        for (const { provider, score } of ranked) {
          // 4. Lock the chosen provider row so two transfers cannot spend the same capacity.
          const locked = await tx.$queryRaw<{ capacity_usd: bigint; active: boolean }[]>`
            SELECT capacity_usd, active FROM liquidity_providers WHERE id = ${provider.id} FOR UPDATE`;
          // Re-check under the lock: another transfer may have taken the capacity since we read it.
          if (!locked.length || !locked[0].active || BigInt(locked[0].capacity_usd) < usdCents) continue;

          // 5. Spend the capacity and create the payout order, in the same transaction.
          await tx.liquidityProvider.update({ where: { id: provider.id }, data: { capacityUsd: { decrement: usdCents } } });
          await tx.payoutOrder.create({
            data: { id: newId('po'), transferId, providerId: provider.id, usdAmount: usdCents, rate: provider.rate, score, status: 'CREATED' },
          });
          return { providerId: provider.id, name: provider.name, rate: provider.rate, score, walletAddress: provider.walletAddress as `0x${string}` };
        }
        // 6. Nobody can pay this amount: a hard failure, the saga compensates (releases the hold).
        throw new DomainError('NO_PROVIDER_CAPACITY', 'No liquidity provider has capacity for this payment', false);
      });
    } catch (e: any) {
      // A concurrent MATCH for the same transfer won the unique(transfer_id) race: return its order.
      if (e?.code === 'P2002') {
        const won = await this.findChoice(transferId);
        if (won) return won;
      }
      throw e;
    }
  }

  /** Compensation for MATCH: restore capacity, set order CANCELLED. Idempotent. */
  async unmatch(transferId: string): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      const order = await tx.payoutOrder.findUnique({ where: { transferId } });
      if (!order) return; // never matched: nothing to undo
      // Flip the order to CANCELLED only if it is not already CANCELLED (or PAID, which is final).
      // updateMany locks the row, so a concurrent unmatch sees count = 0 and does nothing.
      const changed = await tx.payoutOrder.updateMany({
        where: { id: order.id, status: { in: ['CREATED', 'SUBMITTED', 'FAILED'] } },
        data: { status: 'CANCELLED' },
      });
      if (changed.count === 0) return;
      // Give the capacity back exactly once.
      await tx.liquidityProvider.update({ where: { id: order.providerId }, data: { capacityUsd: { increment: order.usdAmount } } });
    });
  }

  /** Which PayoutPartner pays out for a provider (liquidity_providers.adapter). */
  partnerFor(adapter: string): PayoutPartner {
    return adapter === 'BRIDGE' ? this.bridge : this.simulated;
  }

  private async findChoice(transferId: string): Promise<ProviderChoice | null> {
    const order = await this.prisma.payoutOrder.findUnique({ where: { transferId }, include: { provider: true } });
    if (!order) return null;
    return { providerId: order.providerId, name: order.provider.name, rate: order.rate, score: order.score ?? 0, walletAddress: order.provider.walletAddress as `0x${string}` };
  }
}
