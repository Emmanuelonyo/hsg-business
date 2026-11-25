import { Prisma, PrismaClient, Transfer, TransferState } from '@prisma/client';
import { SagaQueue } from '../../common/saga-queue';
import { DomainError } from '../../common/errors';
import { newId } from '../../common/ids';
import { PostingsService } from '../ledger/postings.service';
import { SettlementService } from '../settlement/settlement.service';
import { ComplianceService } from '../compliance/compliance.service';
import { LiquidityService } from '../liquidity/liquidity.service';
import { WebhookService } from '../sim/webhook.service';

/**
 * Everything a step processor needs, passed in as one object. The worker builds it from the Nest
 * services; the tests build it from hand-written fakes. Processors are plain async functions.
 */
export interface SagaContext {
  prisma: PrismaClient;
  sagaQueue: Pick<SagaQueue, 'enqueueStep'>;
  postings: PostingsService;
  settlement: SettlementService;
  compliance: ComplianceService;
  liquidity: LiquidityService;
  webhook: WebhookService;
  /** Puts a job on a wallet's own chain queue (concurrency 1, so one nonce in flight per wallet). */
  enqueueChainJob(walletAddress: string, job: ChainJobData): Promise<void>;
}

/** Job on a per-wallet chain queue: the forward send (treasury wallet) or the return (provider wallet). */
export interface ChainJobData { transferId: string; step: 'CHAIN_SEND' | 'COMP_CHAIN_SEND'; tag: string; }

/** How often CHAIN_CONFIRM / compensation re-check a pending receipt, and for how long CHAIN_CONFIRM waits. */
export const CONFIRM_POLL_MS = 5_000;
export const CONFIRM_MAX_WAIT_MS = 5 * 60_000; // covers TC09's 120 s chain delay with room to spare

/**
 * Enqueue a saga step through the shared SagaQueue. The job id is `${transferId}__${step}`, so
 * enqueueing the same next step twice still creates only one job. A `tag` (e.g. `poll3`) makes a
 * deliberately new job: used for receipt re-checks and compensation re-runs.
 */
export async function enqueueNext(ctx: SagaContext, transferId: string, step: string, opts: { delayMs?: number; tag?: string } = {}) {
  await ctx.sagaQueue.enqueueStep(transferId, step, { delayMs: opts.delayMs, retryTag: opts.tag });
}

export async function loadTransfer(ctx: SagaContext, transferId: string): Promise<Transfer> {
  const t = await ctx.prisma.transfer.findUnique({ where: { id: transferId } });
  // A job for a transfer that does not exist can never succeed: hard failure, nothing to undo.
  if (!t) throw new DomainError('TRANSFER_NOT_FOUND', `Transfer ${transferId} not found`, false);
  return t;
}

/**
 * Forward steps must not run once a transfer is finished, held for review, or being reversed.
 * RESERVE is the one exception for HELD: an operator approving the review enqueues RESERVE.
 */
const STOPPED: TransferState[] = ['HELD', 'DECLINED', 'REVERSING', 'REVERSED', 'COMPLETED'];
export function isStopped(step: string, status: TransferState): boolean {
  if (step === 'RESERVE' && status === 'HELD') return false;
  return STOPPED.includes(status);
}

/** (1) of every processor: has this step already completed for this transfer? */
export async function findCompletedStep(ctx: SagaContext, transferId: string, step: string) {
  return ctx.prisma.sagaStep.findFirst({ where: { transferId, step, status: 'COMPLETED' } });
}

/**
 * (2) of every processor: record a RUNNING row and point transfer.current_step at it.
 * attempt = how many times this step has been tried for this transfer (BullMQ retries, chain
 * confirmation polls and operator retries all count), so the ops "Saga steps" tab shows every try.
 */
export async function startStep(ctx: SagaContext, transferId: string, step: string, transferPatch: Prisma.TransferUpdateInput = {}) {
  const previous = await ctx.prisma.sagaStep.count({ where: { transferId, step } });
  const id = newId('ss');
  const attempt = previous + 1;
  await ctx.prisma.$transaction([
    ctx.prisma.sagaStep.create({ data: { id, transferId, step, attempt, status: 'RUNNING' } }),
    // Compensation sub-steps report as COMPENSATE so an operator retry resumes the whole compensation.
    ctx.prisma.transfer.update({ where: { id: transferId }, data: { currentStep: step.startsWith('COMP_') ? 'COMPENSATE' : step, ...transferPatch } }),
  ]);
  return { id, attempt };
}

/** (4) of every processor: mark the row COMPLETED and move the transfer, in one transaction. */
export async function completeStep(ctx: SagaContext, rowId: string, transferId: string, transferPatch: Prisma.TransferUpdateInput = {}, note?: string) {
  await ctx.prisma.$transaction([
    ctx.prisma.sagaStep.update({ where: { id: rowId }, data: { status: 'COMPLETED', endedAt: new Date(), error: note ?? null } }),
    ctx.prisma.transfer.update({ where: { id: transferId }, data: transferPatch }),
  ]);
}

/** Marks this step's RUNNING row(s) FAILED with the error text (used before a retry or compensation). */
export async function failStep(ctx: SagaContext, transferId: string, step: string, error: string) {
  await ctx.prisma.sagaStep.updateMany({
    where: { transferId, step, status: 'RUNNING' },
    data: { status: 'FAILED', endedAt: new Date(), error: error.slice(0, 1000) },
  });
}

/**
 * Transient = worth retrying (network blips, a pending receipt, a provider hiccup, any unexpected
 * error). Hard = retrying cannot help (DomainError with transient=false): start compensation.
 */
export function isTransient(err: unknown): boolean {
  if (err instanceof DomainError) return err.transient;
  return true;
}

export function errorText(err: unknown): string {
  if (err instanceof DomainError) return `${err.code}: ${err.message}`;
  return err instanceof Error ? err.message : String(err);
}
