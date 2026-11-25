import { Injectable } from '@nestjs/common';
import { RedisService } from './redis.service';

/** Fault switches live in Redis so API (sets them) and worker (reads them) agree instantly. */
export interface Faults {
  /** Provider simulator: payout always fails hard (TC14). */
  payoutHardFail: boolean;
  /** Seconds added before a chain receipt is accepted (TC09). 0 = off. */
  chainDelaySeconds: number;
  /** Convenience switch: treat every provider as capacity 0 (TC08 second run). Per-provider capacity is edited in DB. */
  providersOutOfCapacity: boolean;
}
export const DEFAULT_FAULTS: Faults = { payoutHardFail: false, chainDelaySeconds: 0, providersOutOfCapacity: false };
const KEY = 'hsg:faults';

@Injectable()
export class FaultsService {
  constructor(private readonly redis: RedisService) {}
  async get(): Promise<Faults> {
    const raw = await this.redis.client.get(KEY);
    return { ...DEFAULT_FAULTS, ...(raw ? JSON.parse(raw) : {}) };
  }
  async set(patch: Partial<Faults>): Promise<Faults> {
    const next = { ...(await this.get()), ...patch };
    await this.redis.client.set(KEY, JSON.stringify(next));
    return next;
  }
}
