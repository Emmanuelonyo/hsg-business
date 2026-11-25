import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../common/prisma.service';
import { RedisService } from '../../common/redis.service';

/**
 * Human reference for a transfer: HSG-YYYYMMDD-NNNNNN (UTC date, 6-digit counter).
 *
 * Counter source, in order of preference:
 *  1. Postgres sequence `transfer_ref_seq` (created lazily; needs CREATE on schema public).
 *  2. Redis INCR on `hsg:transfer_ref:{YYYYMMDD}`, initialised from the highest reference already
 *     stored for that day, so it survives a Redis flush. The unique index on transfers.reference is
 *     the final guard: the caller retries with a fresh number on a collision.
 */
@Injectable()
export class TransferReferenceService {
  private readonly log = new Logger(TransferReferenceService.name);
  /** null = not yet tried; true/false = whether the Postgres sequence is usable. */
  private sequenceOk: boolean | null = null;

  constructor(private readonly prisma: PrismaService, private readonly redis: RedisService) {}

  async next(now = new Date()): Promise<string> {
    const day = now.toISOString().slice(0, 10).replace(/-/g, '');
    const n = (await this.fromSequence()) ?? (await this.fromRedis(day));
    return `HSG-${day}-${String(n % 1_000_000).padStart(6, '0')}`;
  }

  private async fromSequence(): Promise<number | null> {
    if (this.sequenceOk === false) return null;
    try {
      if (this.sequenceOk === null) await this.prisma.$executeRawUnsafe('CREATE SEQUENCE IF NOT EXISTS transfer_ref_seq');
      const rows = await this.prisma.$queryRawUnsafe<{ n: bigint }[]>(`SELECT nextval('transfer_ref_seq') AS n`);
      this.sequenceOk = true;
      return Number(rows[0].n);
    } catch (e) {
      this.sequenceOk = false;
      this.log.warn(`transfer_ref_seq unavailable (${(e as Error).message.split('\n')[0]}); using Redis counter`);
      return null;
    }
  }

  private async fromRedis(day: string): Promise<number> {
    const key = `hsg:transfer_ref:${day}`;
    if (!(await this.redis.client.exists(key))) {
      // Start after the highest number already used today (NX: only the first caller sets it).
      const last = await this.prisma.transfer.findFirst({
        where: { reference: { startsWith: `HSG-${day}-` } },
        orderBy: { reference: 'desc' },
        select: { reference: true },
      });
      const start = last ? Number(last.reference.slice(-6)) : 0;
      await this.redis.client.set(key, String(start), 'EX', 3 * 86_400, 'NX');
    }
    return this.redis.client.incr(key);
  }
}
