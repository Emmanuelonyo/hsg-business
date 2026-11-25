import { Controller, Get } from '@nestjs/common';
import { AuthUser, CurrentUser, Roles } from '../auth/auth.guard';
import { PrismaService } from '../../common/prisma.service';
import { ApiError } from '../../common/errors';
import { LedgerService } from '../ledger/ledger.service';
import { serializeBalance, serializeMe } from './sme-serializer';

@Controller('')
export class MeController {
  constructor(private readonly prisma: PrismaService, private readonly ledger: LedgerService) {}

  /** GET /api/me — any signed-in user. Operators get sme/virtual_account = null. */
  @Get('me')
  async me(@CurrentUser() u: AuthUser) {
    const user = await this.prisma.user.findUnique({
      where: { id: u.userId },
      include: { sme: { include: { virtualAccount: true } } },
    });
    if (!user) throw new ApiError('UNAUTHORIZED', 'Session expired, sign in again');
    return serializeMe(user, user.sme ?? null, user.sme?.virtualAccount ?? null);
  }

  /** GET /api/balance — derived from ledger accounts 2000-{sme} / 2100-{sme}, never stored. */
  @Roles('SME')
  @Get('balance')
  async balance(@CurrentUser() u: AuthUser) {
    return serializeBalance(await this.ledger.smeBalances(u.smeId!));
  }
}
