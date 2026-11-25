import { DomainError } from '../../common/errors';
import {
  CONFIRM_POLL_MS, SagaContext, completeStep, enqueueNext, failStep, loadTransfer, startStep,
} from './saga-context';

/** Plain-English reasons the SME sees on a reversed transfer. */
export const REASON_BANK_REJECTED = 'The receiving bank could not accept this payment. Your naira has been returned.';
export const REASON_GENERIC = 'We could not complete this payment right now. Your naira has been returned.';

export function reversalReason(failedStep: string, err: unknown): string {
  if (failedStep === 'PAYOUT' || (err instanceof DomainError && err.code === 'PAYOUT_FAILED')) return REASON_BANK_REJECTED;
  return REASON_GENERIC; // NO_PROVIDER_CAPACITY, chain failure, retries exhausted, ...
}

/**
 * Called by the runner when a forward step fails hard, or runs out of its 5 attempts.
 * Moves the transfer to REVERSING and queues the COMPENSATE job, which undoes completed work.
 */
export async function beginCompensation(ctx: SagaContext, transferId: string, failedStep: string, err: unknown): Promise<void> {
  const transfer = await ctx.prisma.transfer.findUnique({ where: { id: transferId } });
  if (!transfer) return;
  // Finished transfers are never reversed; a reversal already under way is just resumed.
  if (['COMPLETED', 'REVERSED', 'DECLINED'].includes(transfer.status)) return;

  // A paid order is final: the beneficiary has the money. Never pull the tokens back after that;
  // the operator retries FINALISE instead (POST /ops/transfers/:id/retry).
  const order = await ctx.prisma.payoutOrder.findUnique({ where: { transferId } });
  if (order?.status === 'PAID') return;

  if (transfer.status !== 'REVERSING') {
    await ctx.prisma.transfer.update({
      where: { id: transferId },
      data: { status: 'REVERSING', reversingAt: new Date(), failureReason: reversalReason(failedStep, err), currentStep: 'COMPENSATE' },
    });
  }
  await enqueueNext(ctx, transferId, 'COMPENSATE', { tag: 'start' });
}

/** Re-run COMPENSATE later (waiting on a receipt). Each re-run is a new job. */
async function compensateAgainLater(ctx: SagaContext, transferId: string) {
  await enqueueNext(ctx, transferId, 'COMPENSATE', { delayMs: CONFIRM_POLL_MS, tag: `w${Date.now()}` });
}

/**
 * COMPENSATE: undoes the forward steps in REVERSE order. It may run several times (it re-queues
 * itself while a receipt is pending); every undo is recorded as a COMP_<STEP> saga_steps row and is
 * skipped once that row is COMPLETED, so running it again never undoes anything twice.
 *
 *   steps 4+5  tokens at the provider?   -> COMP_CHAIN_SEND: provider wallet sends them back
 *                                        -> COMP_CHAIN_CONFIRM: wait for the return, post Dr 1100 / Cr 1200
 *   step 3     payout order exists?      -> COMP_MATCH: restore capacity, cancel the order
 *   step 2     RESERVE completed?        -> COMP_RESERVE: post the release Dr 2100 / Cr 2000
 *   then       REVERSED + webhook transfer.reversed
 */
export async function runCompensation(ctx: SagaContext, transferId: string): Promise<void> {
  const transfer = await loadTransfer(ctx, transferId);
  if (transfer.status !== 'REVERSING') return; // only after beginCompensation; REVERSED = done

  const done = new Set(
    (await ctx.prisma.sagaStep.findMany({ where: { transferId, status: 'COMPLETED' }, select: { step: true } })).map((r) => r.step),
  );

  // ---- Undo CHAIN_SEND / CHAIN_CONFIRM: decided by what is on chain, not only by the step log.
  const sendTx = await ctx.prisma.chainTransaction.findUnique({ where: { transferId_kind: { transferId, kind: 'SEND' } } });
  if (sendTx && !done.has('COMP_CHAIN_CONFIRM')) {
    // Where is the original send? A broadcast send must settle before we can return it.
    const sendReceipt = await ctx.settlement.checkReceipt(sendTx.txHash as `0x${string}`);
    if (sendReceipt.status === 'PENDING') {
      await compensateAgainLater(ctx, transferId);
      return;
    }

    if (sendReceipt.status === 'FAILED') {
      // The send reverted: the tokens never left the treasury. Nothing to return.
      const row = await startStep(ctx, transferId, 'COMP_CHAIN_CONFIRM');
      await completeStep(ctx, row.id, transferId, {}, 'original send failed on chain; nothing to return');
    } else {
      // CONFIRMED: the tokens are in the provider wallet. Make sure the ledger says so (no-op if
      // CHAIN_CONFIRM already posted it), because the return entry reverses exactly that entry.
      if (!done.has('CHAIN_CONFIRM')) await ctx.postings.chainConfirmed(transferId, transfer.usdAmount);

      if (!done.has('COMP_CHAIN_SEND')) {
        // Hand the return send to the PROVIDER wallet's own queue (concurrency 1, nonce safety).
        // That job saves the return hash and then re-queues COMPENSATE.
        await ctx.enqueueChainJob(sendTx.toAddress, { transferId, step: 'COMP_CHAIN_SEND', tag: `r${Date.now()}` });
        return;
      }

      // The return is broadcast: wait for its receipt.
      const row = await startStep(ctx, transferId, 'COMP_CHAIN_CONFIRM');
      const returnTx = await ctx.prisma.chainTransaction.findUnique({ where: { transferId_kind: { transferId, kind: 'RETURN' } } });
      if (!returnTx) throw new DomainError('RETURN_NOT_FOUND', 'Return transaction not saved yet', true);
      const r = await ctx.settlement.checkReceipt(returnTx.txHash as `0x${string}`);
      if (r.status === 'PENDING') {
        await failStep(ctx, transferId, 'COMP_CHAIN_CONFIRM', `Return receipt pending; checking again in ${CONFIRM_POLL_MS / 1000} s`);
        await compensateAgainLater(ctx, transferId);
        return;
      }
      if (r.status === 'FAILED') {
        // Needs a human: the transfer stays REVERSING and shows up for the operator.
        throw new DomainError('RETURN_FAILED', `Return transaction ${returnTx.txHash} failed on chain`, false);
      }
      // Tokens are back in the treasury: Dr 1100 stablecoin reserve / Cr 1200 provider receivable.
      await ctx.postings.chainReturned(transferId, transfer.usdAmount);
      await completeStep(ctx, row.id, transferId, {}, `return ${returnTx.txHash} confirmed`);
    }
  }

  // ---- Undo MATCH: give the provider its capacity back and cancel the order.
  if (!done.has('COMP_MATCH')) {
    const order = await ctx.prisma.payoutOrder.findUnique({ where: { transferId } });
    if (order) {
      const row = await startStep(ctx, transferId, 'COMP_MATCH');
      await ctx.liquidity.unmatch(transferId);
      await completeStep(ctx, row.id, transferId);
    }
  }

  // ---- Undo RESERVE: release the held naira back to available.
  if (done.has('RESERVE') && !done.has('COMP_RESERVE')) {
    const row = await startStep(ctx, transferId, 'COMP_RESERVE');
    await ctx.postings.release(transferId, transfer.smeId, transfer.totalNgn);
    await completeStep(ctx, row.id, transferId);
  }

  // ---- Done: REVERSED, and tell the SME's system.
  await ctx.prisma.transfer.update({ where: { id: transferId }, data: { status: 'REVERSED', reversedAt: new Date() } });
  try { await ctx.webhook.notifyTransfer(transferId, 'transfer.reversed'); } catch { /* best effort */ }
}

/**
 * COMP_CHAIN_SEND: runs on the provider wallet's queue. Sends the tokens back to the treasury
 * wallet they came from. sendTokens is idempotent per (transfer, RETURN) and saves the hash first.
 */
export async function runCompChainSend(ctx: SagaContext, transferId: string): Promise<void> {
  const transfer = await loadTransfer(ctx, transferId);
  if (transfer.status !== 'REVERSING') return;

  // (1) Already sent back? Resume the compensation and leave.
  const already = await ctx.prisma.sagaStep.findFirst({ where: { transferId, step: 'COMP_CHAIN_SEND', status: 'COMPLETED' } });
  if (already) { await enqueueNext(ctx, transferId, 'COMPENSATE', { tag: `s${Date.now()}` }); return; }

  // (2) Record the attempt.
  const row = await startStep(ctx, transferId, 'COMP_CHAIN_SEND');

  // (3) The work: reverse the original send (provider wallet -> the same treasury wallet).
  const sendTx = await ctx.prisma.chainTransaction.findUnique({ where: { transferId_kind: { transferId, kind: 'SEND' } } });
  if (!sendTx) throw new DomainError('SEND_NOT_FOUND', 'Nothing was sent, so nothing to return', false);
  const sent = await ctx.settlement.sendTokens({
    transferId,
    kind: 'RETURN',
    from: sendTx.toAddress as `0x${string}`,
    to: sendTx.fromAddress as `0x${string}`,
    usdCents: transfer.usdAmount,
  });

  // (4) Mark done.
  await completeStep(ctx, row.id, transferId, {}, `return tx ${sent.txHash}`);

  // (5) Back to COMPENSATE, which waits for the return receipt.
  await enqueueNext(ctx, transferId, 'COMPENSATE', { tag: `s${Date.now()}` });
}
