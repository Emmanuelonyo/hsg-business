import { DomainError } from '../../../common/errors';
import { SagaContext, completeStep, enqueueNext, failStep, findCompletedStep, isStopped, loadTransfer, startStep } from '../saga-context';

/**
 * Step 2: RESERVE. Posts the hold entry (Dr 2000-sme available / Cr 2100-sme held) for the full
 * naira total. The ledger checks the available balance inside its lock (no overdraft).
 * Compensation: post the release entry (Dr 2100 / Cr 2000).
 */
export async function runReserve(ctx: SagaContext, transferId: string): Promise<void> {
  const transfer = await loadTransfer(ctx, transferId);
  // (0) Accepts CREATED / SCREENING / HELD (review approval resumes here). Stops on anything final.
  if (isStopped('RESERVE', transfer.status)) return;

  // (1) Already reserved? Queue the next step and leave.
  if (await findCompletedStep(ctx, transferId, 'RESERVE')) {
    await enqueueNext(ctx, transferId, 'MATCH');
    return;
  }

  // (2) Record the attempt.
  const row = await startStep(ctx, transferId, 'RESERVE');

  // (3) The work: one journal entry, reference `${transferId}:RESERVE`, so a retry can never post twice.
  try {
    await ctx.postings.reserve(transferId, transfer.smeId, transfer.totalNgn);
  } catch (err) {
    if (err instanceof DomainError && err.code === 'INSUFFICIENT_FUNDS') {
      // Not enough naira: decline. Nothing was held, so there is nothing to compensate.
      await failStep(ctx, transferId, 'RESERVE', `${err.code}: ${err.message}`);
      await ctx.prisma.transfer.update({
        where: { id: transferId },
        data: { status: 'DECLINED', failureReason: 'Your available balance was not enough for this payment.', declinedAt: new Date() },
      });
      return;
    }
    throw err; // anything else: let the runner decide (retry or compensate)
  }

  // (4) Mark done and move the transfer to RESERVED.
  await completeStep(ctx, row.id, transferId, { status: 'RESERVED', reservedAt: new Date() });

  // (5) Next: find a liquidity provider.
  await enqueueNext(ctx, transferId, 'MATCH');
}
