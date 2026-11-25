import { DomainError } from '../../../common/errors';
import { SagaContext, completeStep, enqueueNext, findCompletedStep, isStopped, loadTransfer, startStep } from '../saga-context';

/**
 * Step 6: PAYOUT. Asks the matched provider (through its PayoutPartner adapter) to pay the
 * beneficiary's bank. Success -> order PAID. A temporary failure is retried with backoff; a hard
 * failure (TC14: payoutHardFail switch) starts compensation, which returns the tokens.
 * Compensation: none. A paid order is final.
 */
export async function runPayout(ctx: SagaContext, transferId: string): Promise<void> {
  const transfer = await loadTransfer(ctx, transferId);
  // (0) Stop if the transfer is finished, held or being reversed.
  if (isStopped('PAYOUT', transfer.status)) return;

  // (1) Already paid out? Queue FINALISE and leave.
  if (await findCompletedStep(ctx, transferId, 'PAYOUT')) {
    await enqueueNext(ctx, transferId, 'FINALISE');
    return;
  }

  // (2) Record the attempt; the transfer is now PAYOUT_PENDING.
  const row = await startStep(ctx, transferId, 'PAYOUT', { status: 'PAYOUT_PENDING', payoutPendingAt: transfer.payoutPendingAt ?? new Date() });

  // (3) The work.
  const order = await ctx.prisma.payoutOrder.findUnique({ where: { transferId }, include: { provider: true } });
  if (!order) throw new DomainError('PAYOUT_PRECONDITION', 'No payout order for this transfer', false);

  // Guard against paying twice: if an earlier attempt already got paid, skip the call.
  if (order.status !== 'PAID') {
    await ctx.prisma.payoutOrder.update({ where: { id: order.id }, data: { status: 'SUBMITTED' } });
    const beneficiary = await ctx.prisma.beneficiary.findUniqueOrThrow({ where: { id: transfer.beneficiaryId } });
    const partner = ctx.liquidity.partnerFor(order.provider.adapter);
    const result = await partner.payout({
      orderId: order.id,
      transferId,
      providerId: order.providerId,
      usdCents: order.usdAmount,
      beneficiary: { name: beneficiary.name, accountNumber: beneficiary.accountNumber, bankName: beneficiary.bankName, country: beneficiary.country, swiftBic: beneficiary.swiftBic },
      fromAddress: transfer.treasuryWallet,
      currency: beneficiary.currency,
      paymentRail: beneficiary.payoutRail,
    });

    if (!result.ok) {
      // Record why on the order, then throw: transient -> BullMQ retries; hard -> compensation.
      await ctx.prisma.payoutOrder.update({ where: { id: order.id }, data: { status: result.hard ? 'FAILED' : 'SUBMITTED', failure: result.reason } });
      throw new DomainError(result.hard ? 'PAYOUT_FAILED' : 'PAYOUT_RETRY', result.reason, !result.hard);
    }
    await ctx.prisma.payoutOrder.update({ where: { id: order.id }, data: { status: 'PAID', paidAt: new Date(), externalRef: result.externalRef, failure: null } });
  }

  // (4) Mark done. The state stays PAYOUT_PENDING until FINALISE posts the entries.
  await completeStep(ctx, row.id, transferId);

  // (5) Next: post the payout entries and complete.
  await enqueueNext(ctx, transferId, 'FINALISE');
}
