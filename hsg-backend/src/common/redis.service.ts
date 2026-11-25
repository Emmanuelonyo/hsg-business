import { Injectable, OnModuleDestroy } from '@nestjs/common';
import IORedis from 'ioredis';
import { ENV } from './config';

/** Shared Redis connection (nonce counters, fault switches). BullMQ needs maxRetriesPerRequest=null. */
@Injectable()
export class RedisService implements OnModuleDestroy {
  readonly client = new IORedis(ENV.redisUrl, { maxRetriesPerRequest: null });
  async onModuleDestroy() { await this.client.quit(); }
}
