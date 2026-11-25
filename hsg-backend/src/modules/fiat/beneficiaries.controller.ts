import { Body, Controller, Get, Post } from '@nestjs/common';
import { AuthUser, CurrentUser, Roles } from '../auth/auth.guard';
import { CreateBeneficiaryDto } from './dto';
import { FiatService } from './fiat.service';

@Roles('SME')
@Controller('beneficiaries')
export class BeneficiariesController {
  constructor(private readonly fiat: FiatService) {}

  @Get()
  list(@CurrentUser() u: AuthUser) {
    return this.fiat.listBeneficiaries(u.smeId!);
  }

  /** 201 with screening_status CLEARED | BLOCKED (screened synchronously). */
  @Post()
  create(@CurrentUser() u: AuthUser, @Body() body: CreateBeneficiaryDto) {
    return this.fiat.createBeneficiary(u.userId, u.smeId!, body);
  }
}
