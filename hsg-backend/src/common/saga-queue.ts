import { Injectable, OnModuleDestroy } from '@nestjs/common';
import { Queue } from 'bullmq';
import { RedisService } from './redis.service';
import { CONFIG } from './config';

/** Forward saga steps, in order. Compensation steps are named `COMP_<STEP>`. */
export const SAGA_STEPS = ['SCREEN', 'RESERVE', 'MATCH', 'CHAIN_SEND', 'CHAIN_CONFIRM', 'PAYOUT', 'FINALISE'] as const;
export type SagaStepName = (typeof SAGA_STEPS)[number];
export const SAGA_QUEUE = 'saga';
/** CHAIN_SEND jobs for one treasury wallet run on their own queue with concurrency 1 (nonce safety). */
export const chainQueueName = (walletAddress: string) => `chain-${walletAddress.toLowerCase()}`;

export interface SagaJobData { transferId: string; step: string; }

/**
 * The ONE way anything outside the saga module starts or resumes a transfer.
 * API (POST /transfers) enqueues SCREEN; review approval enqueues RESERVE; ops retry re-enqueues the current step.
 * The saga module owns the processors (worker) and may enqueue to per-wallet chain queues itself.
 */
@Injectable()
export class SagaQueue implements OnModuleDestroy {
  readonly queue: Queue<SagaJobData>;
  constructor(redis: RedisService) {
    this.queue = new Queue<SagaJobData>(SAGA_QUEUE, { connection: redis.client });
  }
  async enqueueStep(transferId: string, step: string, opts: { delayMs?: number; retryTag?: string } = {}) {
    // jobId makes enqueue idempotent per (transfer, step); retryTag lets ops force a fresh job.
    // BullMQ forbids ':' in custom job ids, so parts are joined with '__'.
    const jobId = `${transferId}__${step}${opts.retryTag ? `__${opts.retryTag}` : ''}`;
    await this.queue.add(step, { transferId, step }, {
      jobId,
      delay: opts.delayMs,
      attempts: CONFIG.SAGA_ATTEMPTS,
      backoff: { type: 'exponential', delay: CONFIG.SAGA_BACKOFF_MS },
      removeOnComplete: 1000,
      removeOnFail: 5000,
    });
  }
  async onModuleDestroy() { await this.queue.close(); }
}
