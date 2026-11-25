import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { Job, Queue, Worker } from 'bullmq';
import { PrismaService } from '../../common/prisma.service';
import { RedisService } from '../../common/redis.service';
import { SagaQueue, SAGA_QUEUE, SagaJobData, chainQueueName } from '../../common/saga-queue';
import { CONFIG } from '../../common/config';
import { PostingsService } from '../ledger/postings.service';
import { SettlementService } from '../settlement/settlement.service';
import { ComplianceService } from '../compliance/compliance.service';
import { LiquidityService } from '../liquidity/liquidity.service';
import { WebhookService } from '../sim/webhook.service';
import { ChainJobData, SagaContext, errorText, failStep, isTransient } from './saga-context';
import { runScreen } from './steps/screen.step';
import { runReserve } from './steps/reserve.step';
import { runMatch } from './steps/match.step';
import { routeChainSend, runChainSend } from './steps/chain-send.step';
import { runChainConfirm } from './steps/chain-confirm.step';
import { runPayout } from './steps/payout.step';
import { runFinalise } from './steps/finalise.step';
import { beginCompensation, runCompChainSend, runCompensation } from './compensation';

const log = new Logger('Saga');

/** Compensation jobs never trigger compensation themselves; a stuck one waits for an operator retry. */
const isCompensationStep = (step: string) => step === 'COMPENSATE' || step.startsWith('COMP_');

/**
 * The retry policy, in one place, wrapped around every processor:
 *  - success                  -> nothing to do (the processor already queued the next step)
 *  - transient error          -> mark the RUNNING row FAILED, rethrow: BullMQ retries with
 *                                exponential backoff (5 attempts, set by SagaQueue)
 *  - hard error (forward step)-> mark FAILED, start compensation, do NOT rethrow (no retry)
 * Running out of attempts is handled by the worker's 'failed' event (see SagaRunner.onFailed).
 */
export async function runWithPolicy(ctx: SagaContext, transferId: string, step: string, work: () => Promise<void>): Promise<void> {
  try {
    await work();
  } catch (err) {
    await failStep(ctx, transferId, step, errorText(err)).catch(() => undefined);
    if (isTransient(err)) throw err;
    if (isCompensationStep(step)) {
      log.error(`${transferId} ${step} failed hard, needs operator: ${errorText(err)}`);
      return;
    }
    log.warn(`${transferId} ${step} failed hard, compensating: ${errorText(err)}`);
    await beginCompensation(ctx, transferId, step, err);
  }
}

/** Saga-queue dispatch: one processor per step name. `tag` distinguishes operator retries. */
export async function processSagaJob(ctx: SagaContext, data: SagaJobData, tag = 'first'): Promise<void> {
  const { transferId } = data;
  // Operator retry of a compensation sub-step resumes the whole compensation.
  const step = isCompensationStep(data.step) ? 'COMPENSATE' : data.step;
  await runWithPolicy(ctx, transferId, step, async () => {
    switch (step) {
      case 'SCREEN': return runScreen(ctx, transferId);
      case 'RESERVE': return runReserve(ctx, transferId);
      case 'MATCH': return runMatch(ctx, transferId);
      case 'CHAIN_SEND': return routeChainSend(ctx, transferId, tag);
      case 'CHAIN_CONFIRM': return runChainConfirm(ctx, transferId);
      case 'PAYOUT': return runPayout(ctx, transferId);
      case 'FINALISE': return runFinalise(ctx, transferId);
      case 'COMPENSATE': return runCompensation(ctx, transferId);
      default: log.error(`Unknown saga step ${step} for ${transferId}`);
    }
  });
}

/** Per-wallet chain-queue dispatch (concurrency 1 per wallet). */
export async function processChainJob(ctx: SagaContext, data: ChainJobData): Promise<void> {
  await runWithPolicy(ctx, data.transferId, data.step, async () => {
    if (data.step === 'CHAIN_SEND') return runChainSend(ctx, data.transferId);
    if (data.step === 'COMP_CHAIN_SEND') return runCompChainSend(ctx, data.transferId);
  });
}

/** Tag from a saga job id `${transferId}__${step}__${tag}` ('first' when there is none). */
const tagOf = (jobId: string | undefined) => (jobId ?? '').split('__').slice(2).join('-') || 'first';

const jobOptions = {
  attempts: CONFIG.SAGA_ATTEMPTS,
  backoff: { type: 'exponential' as const, delay: CONFIG.SAGA_BACKOFF_MS },
  removeOnComplete: 1000,
  removeOnFail: 5000,
};

/**
 * Starts the BullMQ workers in the worker process (src/worker.ts resolves token 'SagaRunner').
 *  - one Worker on the shared saga queue, concurrency 20: SCREEN, RESERVE, MATCH, CHAIN_CONFIRM, ...
 *  - one Worker per wallet on `chain-<address>`, concurrency 1: CHAIN_SEND from treasury wallets,
 *    COMP_CHAIN_SEND (returns) from provider wallets. One send in flight per wallet = no nonce clash.
 * Constructing it does nothing, so the API process can import SagaModule safely.
 */
@Injectable()
export class SagaRunner implements OnModuleDestroy {
  private sagaWorker: Worker<SagaJobData> | null = null;
  private readonly chainQueues = new Map<string, Queue<ChainJobData>>();
  private readonly chainWorkers = new Map<string, Worker<ChainJobData>>();
  private started = false;
  readonly ctx: SagaContext;

  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
    sagaQueue: SagaQueue,
    postings: PostingsService,
    settlement: SettlementService,
    compliance: ComplianceService,
    liquidity: LiquidityService,
    webhook: WebhookService,
  ) {
    this.ctx = {
      prisma, sagaQueue, postings, settlement, compliance, liquidity, webhook,
      enqueueChainJob: (address, job) => this.enqueueChainJob(address, job),
    };
  }

  async start(): Promise<void> {
    if (this.started) return;
    this.started = true;

    this.sagaWorker = new Worker<SagaJobData>(SAGA_QUEUE, (job) => processSagaJob(this.ctx, job.data, tagOf(job.id)), {
      connection: this.redis.client,
      concurrency: 20,
    });
    this.sagaWorker.on('failed', (job, err) => this.onFailed(job, err));
    this.sagaWorker.on('error', (err) => log.error(`saga worker: ${err.message}`));

    // One chain worker per known wallet: treasury and provider wallets, plus provider rows.
    const wallets = await this.prisma.wallet.findMany({ select: { address: true } });
    const providers = await this.prisma.liquidityProvider.findMany({ select: { walletAddress: true } });
    for (const a of [...wallets.map((w) => w.address), ...providers.map((p) => p.walletAddress)]) this.ensureChainWorker(a);
    log.log(`saga worker started; ${this.chainWorkers.size} wallet queues`);
  }

  async stop(): Promise<void> {
    const closing: Promise<unknown>[] = [];
    if (this.sagaWorker) closing.push(this.sagaWorker.close());
    for (const w of this.chainWorkers.values()) closing.push(w.close());
    for (const q of this.chainQueues.values()) closing.push(q.close());
    await Promise.allSettled(closing);
    this.sagaWorker = null;
    this.chainWorkers.clear();
    this.chainQueues.clear();
    this.started = false;
  }

  async onModuleDestroy() { await this.stop(); }

  /** Adds a CHAIN_SEND / COMP_CHAIN_SEND job to the wallet's own queue. Job ids contain no ':'. */
  async enqueueChainJob(address: string, job: ChainJobData): Promise<void> {
    if (this.started) this.ensureChainWorker(address);
    await this.queueFor(address).add(job.step, job, { ...jobOptions, jobId: `${job.transferId}__${job.step}__${job.tag}` });
  }

  private queueFor(address: string): Queue<ChainJobData> {
    const name = chainQueueName(address);
    let q = this.chainQueues.get(name);
    if (!q) {
      q = new Queue<ChainJobData>(name, { connection: this.redis.client });
      this.chainQueues.set(name, q);
    }
    return q;
  }

  private ensureChainWorker(address: string) {
    const name = chainQueueName(address);
    if (this.chainWorkers.has(name)) return;
    const w = new Worker<ChainJobData>(name, (job) => processChainJob(this.ctx, job.data), {
      connection: this.redis.client,
      concurrency: 1, // the nonce rule: one in-flight send per wallet
    });
    w.on('failed', (job, err) => this.onFailed(job, err));
    w.on('error', (err) => log.error(`${name}: ${err.message}`));
    this.chainWorkers.set(name, w);
  }

  /** Last attempt used up on a transient error: treat it as hard and compensate. */
  private onFailed(job: Job<SagaJobData | ChainJobData> | undefined, err: Error) {
    if (!job) return;
    const attempts = job.opts.attempts ?? 1;
    if (job.attemptsMade < attempts) return; // BullMQ will retry
    const { transferId, step } = job.data;
    if (isCompensationStep(step)) {
      log.error(`${transferId} ${step} exhausted retries, needs operator: ${err.message}`);
      return;
    }
    log.warn(`${transferId} ${step} exhausted ${attempts} attempts, compensating: ${err.message}`);
    beginCompensation(this.ctx, transferId, step, err).catch((e) => log.error(`compensation start failed: ${e.message}`));
  }
}
