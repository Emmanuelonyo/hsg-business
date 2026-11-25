import { Body, Controller, Get, HttpCode, Logger, Param, Post } from '@nestjs/common';
import { IsIn, IsOptional, IsString, MaxLength } from 'class-validator';
import { AuthUser, CurrentUser, Roles } from '../auth/auth.guard';
import { PrismaService } from '../../common/prisma.service';
import { AuditService } from '../../common/audit.service';
import { SagaQueue } from '../../common/saga-queue';
import { ApiError } from '../../common/errors';
import { newId } from '../../common/ids';
import { LedgerService } from '../ledger/ledger.service';
import { ComplianceService } from './compliance.service';

export class ReviewDecisionDto {
  @IsIn(['approve', 'reject']) decision: 'approve' | 'reject';
  @IsOptional() @IsString() @MaxLength(500) reason?: string;
}

/** SME-facing text for a transfer the operator rejects (the operator's own reason stays in compliance_checks). */
const REVIEW_DECLINED_REASON = 'This payment was declined after a compliance review. No money was taken from your balance.';

/** Operator review queue: held transfers and KYB-pending businesses. */
@Roles('OPERATOR')
@Controller('ops/review')
export class ReviewController {
  private readonly log = new Logger(ReviewController.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly compliance: ComplianceService,
    private readonly saga: SagaQueue,
    private readonly audit: AuditService,
    private readonly ledger: LedgerService,
  ) {}

  @Get()
  async queue() {
    const held = await this.prisma.transfer.findMany({
      where: { status: 'HELD' },
      include: { sme: true, beneficiary: true, complianceChecks: { where: { result: 'HOLD' }, orderBy: { createdAt: 'asc' } } },
      orderBy: { heldAt: 'asc' },
    });
    const pending = await this.prisma.smeAccount.findMany({ where: { kybStatus: 'PENDING' }, orderBy: { createdAt: 'asc' } });

    return {
      held_transfers: held.map((t) => {
        // The first HOLD row in gate order is the one that parked the transfer.
        const hold = t.complianceChecks.find((c) => c.gate === t.heldRule) ?? t.complianceChecks[0];
        return {
          id: t.id,
          reference: t.reference,
          sme: { id: t.sme.id, legal_name: t.sme.legalName },
          beneficiary: { name: t.beneficiary.name, country: t.beneficiary.country },
          usd_amount: t.usdAmount.toString(),
          rule: t.heldRule ?? hold?.gate ?? null,
          reason: ((hold?.detail as any)?.reason as string | undefined) ?? null,
          travel_rule: t.travelRule,
          held_at: t.heldAt?.toISOString() ?? null,
        };
      }),
      kyb_pending: pending.map((s) => ({
        id: s.id, legal_name: s.legalName, rc_number: s.rcNumber, country: s.country, address: s.address, created_at: s.createdAt.toISOString(),
      })),
    };
  }

  /** `:id` is a transfer id (tr_...) or an SME id (sme_...). */
  @Post(':id/decision')
  @HttpCode(200)
  async decide(@CurrentUser() op: AuthUser, @Param('id') id: string, @Body() body: ReviewDecisionDto) {
    const transfer = await this.prisma.transfer.findUnique({ where: { id } });
    if (transfer) return this.decideTransfer(op, transfer.id, transfer.status, body);
    const sme = await this.prisma.smeAccount.findUnique({ where: { id } });
    if (sme) return this.decideSme(op, sme.id, sme.kybStatus, sme.legalName, sme.country, body);
    throw new ApiError('NOT_FOUND', 'Nothing to review with that id');
  }

  /**
   * Held transfer.
   * approve -> REVIEW PASS row, then enqueue RESERVE (the saga's RESERVE step accepts HELD transfers and moves the state on).
   * reject  -> REVIEW FAIL row, status DECLINED. Nothing was held yet, so there is no journal entry.
   */
  private async decideTransfer(op: AuthUser, id: string, status: string, body: ReviewDecisionDto) {
    if (status !== 'HELD') throw new ApiError('CONFLICT', `Transfer is ${status}, not held for review`);
    const detail = { rule: 'REVIEW', decision: body.decision, reason: body.reason ?? null, reviewer: op.email };

    if (body.decision === 'approve') {
      await this.prisma.complianceCheck.create({ data: { id: newId('cc'), transferId: id, subject: 'TRANSFER', gate: 'REVIEW', result: 'PASS', detail } });
      await this.saga.enqueueStep(id, 'RESERVE');
      await this.audit.log(op.userId, 'review.transfer.approve', 'transfer', id, detail);
      return { ok: true, result: 'APPROVED' };
    }

    // Reject: only move it if it is still HELD (guards against a double click racing an approve).
    const now = new Date();
    const moved = await this.prisma.$transaction(async (tx) => {
      const u = await tx.transfer.updateMany({
        where: { id, status: 'HELD' },
        data: { status: 'DECLINED', declinedAt: now, failureReason: REVIEW_DECLINED_REASON, currentStep: null },
      });
      if (u.count === 1) {
        await tx.complianceCheck.create({ data: { id: newId('cc'), transferId: id, subject: 'TRANSFER', gate: 'REVIEW', result: 'FAIL', detail } });
      }
      return u.count === 1;
    });
    if (!moved) throw new ApiError('CONFLICT', 'Transfer is no longer held for review');
    await this.audit.log(op.userId, 'review.transfer.reject', 'transfer', id, detail);
    return { ok: true, result: 'DECLINED' };
  }

  /**
   * KYB-pending SME (TC01 / TC02).
   * approve -> screen legal name + country: clean -> VERIFIED + KYB PASS; watchlist hit -> REJECTED + KYB FAIL.
   * reject  -> REJECTED + KYB FAIL with the operator's reason.
   */
  private async decideSme(op: AuthUser, smeId: string, kyb: string, legalName: string, country: string, body: ReviewDecisionDto) {
    if (kyb !== 'PENDING') throw new ApiError('CONFLICT', `Business is already ${kyb}`);

    let verified: boolean;
    let detail: Record<string, unknown>;
    if (body.decision === 'approve') {
      const screen = await this.compliance.screenName(legalName, country);
      verified = screen.status === 'CLEARED';
      detail = {
        rule: 'KYB', decision: 'approve', reviewer: op.email, reason: body.reason ?? null,
        screening: { value: { name: legalName, country }, matched: screen.matched ?? null },
        ...(verified ? {} : { reason: 'Legal name matches the sanctions watchlist' }),
      };
    } else {
      verified = false;
      detail = { rule: 'KYB', decision: 'reject', reviewer: op.email, reason: body.reason ?? 'Rejected by operator' };
    }

    await this.prisma.$transaction([
      this.prisma.smeAccount.update({ where: { id: smeId }, data: { kybStatus: verified ? 'VERIFIED' : 'REJECTED' } }),
      this.prisma.complianceCheck.create({ data: { id: newId('cc'), smeId, subject: 'SME', gate: 'KYB', result: verified ? 'PASS' : 'FAIL', detail: detail as any } }),
    ]);
    if (verified) {
      // Make sure the SME's ledger accounts exist so inflows and holds can post.
      try { await this.ledger.ensureSmeAccounts(smeId); } catch (e) { this.log.warn(`ensureSmeAccounts(${smeId}) failed: ${(e as Error).message}`); }
    }
    await this.audit.log(op.userId, `review.sme.${body.decision}`, 'sme', smeId, { ...detail, result: verified ? 'VERIFIED' : 'REJECTED' });
    return { ok: true, result: verified ? 'VERIFIED' : 'REJECTED' };
  }
}
