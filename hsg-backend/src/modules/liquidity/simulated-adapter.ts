import { Injectable } from '@nestjs/common';
import { ulid } from 'ulid';
import { PrismaService } from '../../common/prisma.service';
import { FaultsService } from '../../common/faults.service';
import { PayoutPartner, PayoutRequest, PayoutResult } from './payout-partner';

/**
 * Liquidity provider simulator (PRD "Simulators"). Stands in for a real payout partner behind the
 * same PayoutPartner interface the Bridge adapter implements.
 *
 * Behaviour:
 *  1. waits the provider's configured payout delay (payout_delay_ms),
 *  2. if the `payoutHardFail` fault switch is on, fails HARD (TC14: the saga must compensate),
 *  3. otherwise fails TRANSIENTLY with probability (1 - reliability): the saga retries it with
 *     exponential backoff (5 attempts), so a 0.9-reliable provider almost always pays in the end,
 *  4. otherwise succeeds and returns an external reference "SIM-<ulid>".
 */
@Injectable()
export class SimulatedAdapter implements PayoutPartner {
  readonly name = 'SIMULATED' as const;
  /** Replaceable in tests to make the reliability roll deterministic. */
  random: () => number = Math.random;
  /** Replaceable in tests to skip the payout delay. */
  sleep: (ms: number) => Promise<void> = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

  constructor(private readonly prisma: PrismaService, private readonly faults: FaultsService) {}

  async payout(req: PayoutRequest): Promise<PayoutResult> {
    const provider = await this.prisma.liquidityProvider.findUnique({ where: { id: req.providerId } });
    if (!provider) return { ok: false, hard: true, reason: `Unknown provider ${req.providerId}` };

    // 1. The provider takes some time to pay the beneficiary's bank.
    if (provider.payoutDelayMs > 0) await this.sleep(provider.payoutDelayMs);

    // 2. Fault switch: the receiving bank rejects the payment outright.
    const faults = await this.faults.get();
    if (faults.payoutHardFail) {
      return { ok: false, hard: true, reason: `${provider.name}: beneficiary bank rejected the payout (payoutHardFail switch on)` };
    }

    // 3. Random temporary failure according to the provider's reliability score.
    if (this.random() > provider.reliability) {
      return { ok: false, hard: false, reason: `${provider.name}: temporary payout failure (reliability ${provider.reliability})` };
    }

    // 4. Paid.
    return { ok: true, externalRef: `SIM-${ulid()}` };
  }
}
