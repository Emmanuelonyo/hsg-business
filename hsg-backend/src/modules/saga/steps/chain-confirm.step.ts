import { DomainError } from '../../../common/errors';
import {
  CONFIRM_MAX_WAIT_MS, CONFIRM_POLL_MS, SagaContext, completeStep, enqueueNext, failStep, findCompletedStep, isStopped, loadTransfer, startStep,
} from '../saga-context';

/**
 * Step 5: CHAIN_CONFIRM. Checks the receipt of the send. When confirmed, posts the USD entry
 * (Dr 1200 provider receivable / Cr 1100 stablecoin reserve).
 *
 * A pending receipt is not an error. Instead of burning the 5 BullMQ attempts, the step re-queues
 * itself every 5 s for up to 5 minutes, so TC09's 120 s chain delay is covered. Each check is one
 * saga_steps row, which is what the "attempts" evidence for TC09 shows.
 * Compensation: once the return transfer confirms, post the reversing USD entry (compensation.ts).
 */
export async function runChainConfirm(ctx: SagaContext, transferId: string): Promise<void> {
  const transfer = await loadTransfer(ctx, transferId);
  // (0) Stop if the transfer is finished, held or being reversed.
  if (isStopped('CHAIN_CONFIRM', transfer.status)) return;

  // (1) Already confirmed? Queue the payout and leave.
  if (await findCompletedStep(ctx, transferId, 'CHAIN_CONFIRM')) {
    await enqueueNext(ctx, transferId, 'PAYOUT');
    return;
  }

  // (2) Record the attempt (one row per receipt check).
  const row = await startStep(ctx, transferId, 'CHAIN_CONFIRM');

  // (3) The work: read the receipt of the transaction CHAIN_SEND saved.
  const sendTx = await ctx.prisma.chainTransaction.findUnique({ where: { transferId_kind: { transferId, kind: 'SEND' } } });
  if (!sendTx) throw new DomainError('SEND_NOT_FOUND', 'No send transaction saved yet', true);
  const receipt = await ctx.settlement.checkReceipt(sendTx.txHash as `0x${string}`);

  if (receipt.status === 'PENDING') {
    // How long have we been waiting since the first check?
    const first = await ctx.prisma.sagaStep.findFirst({ where: { transferId, step: 'CHAIN_CONFIRM' }, orderBy: { startedAt: 'asc' } });
    const waitedMs = Date.now() - (first?.startedAt ?? new Date()).getTime();
    if (waitedMs > CONFIRM_MAX_WAIT_MS) {
      throw new DomainError('CHAIN_CONFIRM_TIMEOUT', `Send not confirmed after ${Math.round(waitedMs / 1000)} s`, false);
    }
    // Not yet: close this check and look again in 5 s with a fresh job.
    await failStep(ctx, transferId, 'CHAIN_CONFIRM', `Receipt pending (${receipt.confirmations} confirmations); checking again in ${CONFIRM_POLL_MS / 1000} s`);
    await enqueueNext(ctx, transferId, 'CHAIN_CONFIRM', { delayMs: CONFIRM_POLL_MS, tag: `poll${row.attempt}` });
    return;
  }
  if (receipt.status === 'FAILED') {
    // Reverted on chain: the tokens never left the treasury. Hard failure -> compensation.
    throw new DomainError('CHAIN_SEND_FAILED', `Send transaction ${sendTx.txHash} failed on chain`, false);
  }

  // CONFIRMED: the tokens are at the provider. Post the USD entry (idempotent by reference).
  await ctx.postings.chainConfirmed(transferId, transfer.usdAmount);

  // (4) Mark done and move the transfer to ONCHAIN_CONFIRMED.
  await completeStep(ctx, row.id, transferId, { status: 'ONCHAIN_CONFIRMED', onchainConfirmedAt: new Date() },
    `block ${receipt.blockNumber ?? '?'}, ${receipt.confirmations} confirmations`);

  // (5) Next: the provider pays the beneficiary.
  await enqueueNext(ctx, transferId, 'PAYOUT');
}
