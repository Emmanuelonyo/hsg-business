import { Injectable, OnModuleDestroy } from '@nestjs/common';
import IORedis from 'ioredis';
import { ENV } from './config';

/** Shared Redis connection (nonce counters, fault switches). BullMQ needs maxRetriesPerRequest=null. */
@Injectable()
export class RedisService implements OnModuleDestroy {
  // family: 0 resolves IPv4 and IPv6, needed on IPv6-only private networks (e.g. Railway).
  readonly client = new IORedis(ENV.redisUrl, { maxRetriesPerRequest: null, family: 0 });
  async onModuleDestroy() { await this.client.quit(); }
}
