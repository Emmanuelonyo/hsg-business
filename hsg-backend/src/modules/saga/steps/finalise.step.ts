import { SagaContext, completeStep, findCompletedStep, isStopped, loadTransfer, startStep } from '../saga-context';

/**
 * Step 7: FINALISE. Posts the two payout entries, sets COMPLETED and fires the webhook.
 *   naira side:  Dr 2100-sme held (total) / Cr 3000 FX position NGN (principal), Cr 4000 fee income (fee)
 *   dollar side: Dr 3100 FX position USD / Cr 1200 provider receivable
 * Compensation: not applicable (this is the end).
 */
export async function runFinalise(ctx: SagaContext, transferId: string): Promise<void> {
  const transfer = await loadTransfer(ctx, transferId);
  // (0) Already COMPLETED (or being reversed): nothing to do.
  if (isStopped('FINALISE', transfer.status)) return;

  // (1) Already finalised? There is no next step.
  if (await findCompletedStep(ctx, transferId, 'FINALISE')) return;

  // (2) Record the attempt.
  const row = await startStep(ctx, transferId, 'FINALISE');

  // (3) The work: both entries are idempotent by reference (`:PAYOUT_NGN`, `:PAYOUT_USD`),
  // so if the second one failed last time, the retry re-posts nothing for the first.
  await ctx.postings.payoutNgn(transferId, transfer.smeId, transfer.principalNgn, transfer.feeNgn);
  await ctx.postings.payoutUsd(transferId, transfer.usdAmount);

  // (4) Mark done: the transfer is COMPLETED.
  await completeStep(ctx, row.id, transferId, { status: 'COMPLETED', completedAt: new Date() });

  // (5) No next step: tell the SME's system. WebhookService never throws, but guard anyway.
  try { await ctx.webhook.notifyTransfer(transferId, 'transfer.completed'); } catch { /* best effort */ }
}
