import { Body, Controller, Post } from '@nestjs/common';
import { AuthUser, CurrentUser, Roles } from '../auth/auth.guard';
import { CreateQuoteDto } from './dto';
import { FiatService } from './fiat.service';

@Roles('SME')
@Controller('quotes')
export class QuotesController {
  constructor(private readonly fiat: FiatService) {}

  /** 201 {id, usd_amount, rate, principal_ngn, fee_ngn, total_ngn, expires_at, created_at}; 60 s TTL. */
  @Post()
  create(@CurrentUser() u: AuthUser, @Body() body: CreateQuoteDto) {
    return this.fiat.createQuote(u.smeId!, body.usd_amount);
  }
}
