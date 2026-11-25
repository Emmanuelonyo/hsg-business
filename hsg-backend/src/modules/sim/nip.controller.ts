import { Body, Controller, Get, HttpCode, Post } from '@nestjs/common';
import { IsNotEmpty, IsOptional, IsString, Matches, MaxLength } from 'class-validator';
import { AuthUser, CurrentUser, Roles } from '../auth/auth.guard';
import { PrismaService } from '../../common/prisma.service';
import { AuditService } from '../../common/audit.service';
import { ApiError } from '../../common/errors';
import { newId } from '../../common/ids';
import { LedgerService } from '../ledger/ledger.service';
import { PostingsService } from '../ledger/postings.service';

export class NipInflowDto {
  @IsString() @Matches(/^[0-9]{10}$/, { message: 'account_number must be 10 digits' }) account_number: string;
  /** kobo, as a string */
  @IsString() @Matches(/^[1-9][0-9]{0,15}$/, { message: 'amount must be a positive whole number of kobo' }) amount: string;
  @IsString() @IsNotEmpty() @MaxLength(200) sender_name: string;
  @IsOptional() @IsString() @MaxLength(100) session_id?: string;
}

/** NIP inflow simulator: an incoming naira transfer to an SME's virtual account (TC03). */
@Roles('OPERATOR')
@Controller('sim')
export class NipSimController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly postings: PostingsService,
    private readonly ledger: LedgerService,
    private readonly audit: AuditService,
  ) {}

  /** Dr 1000 / Cr 2000-{sme}. Reference `inflow:{session_id}`, so a repeated session id is a no-op. */
  @Post('nip-inflow')
  @HttpCode(200)
  async inflow(@CurrentUser() op: AuthUser, @Body() body: NipInflowDto) {
    const va = await this.prisma.virtualAccount.findUnique({ where: { accountNumber: body.account_number } });
    if (!va) throw new ApiError('NOT_FOUND', 'No virtual account with that number');

    const sessionId = body.session_id?.trim() || newId('nip');
    const entry = await this.postings.inflow(va.smeId, sessionId, BigInt(body.amount));
    const balance = await this.ledger.smeBalances(va.smeId);
    await this.audit.log(op.userId, 'sim.nip_inflow', 'sme', va.smeId, {
      account_number: body.account_number, amount: body.amount, sender_name: body.sender_name, session_id: sessionId, duplicate: entry.duplicate,
    });
    return {
      ok: true,
      duplicate: entry.duplicate,
      entry: { seq: entry.seq.toString(), reference: entry.reference },
      balance: { available: balance.available.toString(), held: balance.held.toString() },
    };
  }

  /** Picker for the fund form. */
  @Get('smes')
  async smes() {
    const rows = await this.prisma.smeAccount.findMany({ include: { virtualAccount: true }, orderBy: { legalName: 'asc' } });
    return {
      items: rows.map((s) => ({ id: s.id, legal_name: s.legalName, kyb_status: s.kybStatus, account_number: s.virtualAccount?.accountNumber ?? null })),
    };
  }
}
