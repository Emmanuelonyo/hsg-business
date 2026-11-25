import { DomainError } from '../../../common/errors';
import { SagaContext, completeStep, enqueueNext, findCompletedStep, isStopped, loadTransfer, startStep } from '../saga-context';

/**
 * Step 4: CHAIN_SEND. Sends the tokens from a treasury wallet to the matched provider's wallet.
 * Compensation: the provider wallet sends a RETURN transfer back (see compensation.ts).
 *
 * It runs in two hops so that nonces can never collide:
 *  a) routeChainSend runs on the shared saga queue: chooses the treasury wallet for this transfer
 *     and forwards the job to THAT wallet's own queue.
 *  b) runChainSend runs on the wallet's queue, which has concurrency 1: only one send per wallet
 *     is ever in flight, so the Redis nonce counter for that wallet is used strictly in order.
 */
export async function routeChainSend(ctx: SagaContext, transferId: string, tag: string): Promise<void> {
  const transfer = await loadTransfer(ctx, transferId);
  if (isStopped('CHAIN_SEND', transfer.status)) return;
  if (await findCompletedStep(ctx, transferId, 'CHAIN_SEND')) {
    await enqueueNext(ctx, transferId, 'CHAIN_CONFIRM');
    return;
  }
  // Choose the treasury wallet once and keep it (a retry must use the same wallet).
  let wallet = transfer.treasuryWallet;
  if (!wallet) {
    wallet = await ctx.settlement.pickTreasuryWallet(transferId);
    await ctx.prisma.transfer.update({ where: { id: transferId }, data: { treasuryWallet: wallet } });
  }
  // Hand over to the wallet's queue. `tag` keeps an operator retry distinct from the first try.
  await ctx.enqueueChainJob(wallet, { transferId, step: 'CHAIN_SEND', tag });
}

export async function runChainSend(ctx: SagaContext, transferId: string): Promise<void> {
  const transfer = await loadTransfer(ctx, transferId);
  // (0) Stop if the transfer is finished, held or being reversed.
  if (isStopped('CHAIN_SEND', transfer.status)) return;

  // (1) Already sent? Queue the confirmation and leave.
  if (await findCompletedStep(ctx, transferId, 'CHAIN_SEND')) {
    await enqueueNext(ctx, transferId, 'CHAIN_CONFIRM');
    return;
  }

  // (2) Record the attempt.
  const row = await startStep(ctx, transferId, 'CHAIN_SEND');

  // (3) The work. Where to: the wallet of the provider chosen in MATCH.
  const order = await ctx.prisma.payoutOrder.findUnique({ where: { transferId }, include: { provider: true } });
  if (!order || !transfer.treasuryWallet) {
    throw new DomainError('CHAIN_SEND_PRECONDITION', 'No payout order or treasury wallet for this transfer', false);
  }
  // sendTokens is idempotent per (transfer, SEND): it saves the tx hash BEFORE returning, and on a
  // retry it finds the saved hash and returns it instead of broadcasting a second time.
  const sent = await ctx.settlement.sendTokens({
    transferId,
    kind: 'SEND',
    from: transfer.treasuryWallet as `0x${string}`,
    to: order.provider.walletAddress as `0x${string}`,
    usdCents: transfer.usdAmount,
  });

  // (4) Mark done: the transaction is broadcast, so the transfer is ONCHAIN_PENDING.
  await completeStep(ctx, row.id, transferId, { status: 'ONCHAIN_PENDING', onchainPendingAt: new Date() },
    `tx ${sent.txHash} nonce ${sent.nonce}${sent.duplicate ? ' (already broadcast)' : ''}`);

  // (5) Next: wait for the receipt.
  await enqueueNext(ctx, transferId, 'CHAIN_CONFIRM');
}
