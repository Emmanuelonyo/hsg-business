import { Controller, Param, Post } from '@nestjs/common';
import { Roles } from '../auth/auth.guard';
import { PrismaService } from '../../common/prisma.service';
import { SagaQueue } from '../../common/saga-queue';
import { ApiError } from '../../common/errors';

/** Operator tools for the saga. */
@Controller('ops/transfers')
@Roles('OPERATOR')
export class SagaOpsController {
  constructor(private readonly prisma: PrismaService, private readonly sagaQueue: SagaQueue) {}

  /**
   * POST /ops/transfers/:id/retry -> {ok:true, step}
   * Re-enqueues the transfer's current step with a fresh job id. Safe: every step first checks for
   * its own COMPLETED row, so a retry of finished work just moves on.
   */
  @Post(':id/retry')
  async retry(@Param('id') id: string) {
    const t = await this.prisma.transfer.findUnique({ where: { id }, select: { currentStep: true, status: true } });
    if (!t) throw new ApiError('NOT_FOUND', 'Transfer not found');
    let step = t.currentStep ?? 'SCREEN';
    if (step.startsWith('COMP_') || t.status === 'REVERSING') step = 'COMPENSATE';
    await this.sagaQueue.enqueueStep(id, step, { retryTag: `ops${Date.now()}` });
    return { ok: true, step };
  }
}
