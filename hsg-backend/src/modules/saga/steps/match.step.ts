import { SagaContext, completeStep, enqueueNext, findCompletedStep, isStopped, loadTransfer, startStep } from '../saga-context';

/**
 * Step 3: MATCH. Picks the liquidity provider with the best weighted score (rate 0.5, reliability
 * 0.3, headroom 0.2) that can cover the amount, decrements its capacity and creates the payout order.
 * No provider -> DomainError NO_PROVIDER_CAPACITY (hard) -> the runner starts compensation (release).
 * Compensation: restore the capacity, cancel the order.
 */
export async function runMatch(ctx: SagaContext, transferId: string): Promise<void> {
  const transfer = await loadTransfer(ctx, transferId);
  // (0) Stop if the transfer is finished, held or being reversed.
  if (isStopped('MATCH', transfer.status)) return;

  // (1) Already matched? Queue the next step and leave.
  if (await findCompletedStep(ctx, transferId, 'MATCH')) {
    await enqueueNext(ctx, transferId, 'CHAIN_SEND');
    return;
  }

  // (2) Record the attempt.
  const row = await startStep(ctx, transferId, 'MATCH');

  // (3) The work. LiquidityService.match is itself idempotent per transfer (one payout order max).
  const choice = await ctx.liquidity.match(transferId, transfer.usdAmount);

  // (4) Mark done. The transfer stays RESERVED; the provider is recorded on the payout order.
  await completeStep(ctx, row.id, transferId, {}, `matched ${choice.name} (score ${choice.score})`);

  // (5) Next: send the stablecoin leg to the provider's wallet.
  await enqueueNext(ctx, transferId, 'CHAIN_SEND');
}
