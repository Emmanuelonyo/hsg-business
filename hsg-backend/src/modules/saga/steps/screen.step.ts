import { SagaContext, completeStep, enqueueNext, findCompletedStep, isStopped, loadTransfer, startStep } from '../saga-context';

/** Plain-English decline reasons per gate. The SME sees these, so no internal rule detail. */
const DECLINE_REASONS: Record<string, string> = {
  KYB: 'Your business verification is not complete, so this payment could not be sent.',
  SANCTIONS: 'We are unable to send payments to this beneficiary.',
  TRAVEL_RULE: 'Some sender or beneficiary details are missing, so this payment could not be sent.',
};

/**
 * Step 1: SCREEN. Runs the compliance gates (KYB, sanctions, travel rule, threshold, velocity).
 * PASS -> RESERVE. HELD -> stop and wait for an operator. DECLINED -> stop for good.
 * Compensation: none. Nothing has moved yet.
 */
export async function runScreen(ctx: SagaContext, transferId: string): Promise<void> {
  const transfer = await loadTransfer(ctx, transferId);
  // (0) A held, declined, finished or reversing transfer must not be screened again.
  if (isStopped('SCREEN', transfer.status)) return;

  // (1) Already screened and passed? Just make sure the next step is queued.
  if (await findCompletedStep(ctx, transferId, 'SCREEN')) {
    await enqueueNext(ctx, transferId, 'RESERVE');
    return;
  }

  // (2) Record the attempt and move the transfer to SCREENING.
  const row = await startStep(ctx, transferId, 'SCREEN', { status: 'SCREENING', screeningAt: transfer.screeningAt ?? new Date() });

  // (3) The work: the compliance service runs the five gates and writes one compliance_checks row each.
  const result = await ctx.compliance.runTransferGates(transferId);

  // (4) Record the outcome.
  if (result.outcome === 'HELD') {
    // Held for review. The operator's approval enqueues RESERVE; rejection declines it.
    await completeStep(ctx, row.id, transferId, { status: 'HELD', heldRule: result.rule, heldAt: new Date() }, `HELD by ${result.rule}: ${result.reason}`);
    return;
  }
  if (result.outcome === 'DECLINED') {
    await completeStep(ctx, row.id, transferId, {
      status: 'DECLINED',
      failureReason: DECLINE_REASONS[result.rule] ?? 'This payment could not be sent.',
      declinedAt: new Date(),
    }, `DECLINED by ${result.rule}: ${result.reason}`);
    return;
  }
  await completeStep(ctx, row.id, transferId);

  // (5) Passed: hold the naira next.
  await enqueueNext(ctx, transferId, 'RESERVE');
}
