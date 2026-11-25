import { Body, Controller, Get, Headers, HttpCode, Param, Post, Query } from '@nestjs/common';
import { AuthUser, CurrentUser, Roles } from '../auth/auth.guard';
import { CreateTransferDto, ListTransfersQuery } from './dto';
import { FiatService } from './fiat.service';

@Roles('SME')
@Controller('transfers')
export class TransfersController {
  constructor(private readonly fiat: FiatService) {}

  /** 202 Accepted: the transfer is created and the saga starts asynchronously. Idempotency-Key required. */
  @Post()
  @HttpCode(202)
  create(@CurrentUser() u: AuthUser, @Headers('idempotency-key') key: string | undefined, @Body() body: CreateTransferDto) {
    return this.fiat.createTransfer(u.userId, u.smeId!, key, body);
  }

  /** ?status=Processing|Under review|Completed|Reversed|Declined&limit=50, newest first. */
  @Get()
  list(@CurrentUser() u: AuthUser, @Query() q: ListTransfersQuery) {
    return this.fiat.listTransfers(u.smeId!, q.status, q.limit ?? 50);
  }

  @Get(':id')
  get(@CurrentUser() u: AuthUser, @Param('id') id: string) {
    return this.fiat.getTransfer(u.smeId!, id);
  }
}
