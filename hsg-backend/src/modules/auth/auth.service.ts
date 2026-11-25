import { Injectable } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Prisma } from '@prisma/client';
import { compare, hash } from 'bcryptjs';
import { PrismaService } from '../../common/prisma.service';
import { AuditService } from '../../common/audit.service';
import { ApiError } from '../../common/errors';
import { newId } from '../../common/ids';
import { LedgerService } from '../ledger/ledger.service';
import { RegisterDto } from './register.dto';

export interface LoginResult {
  token: string;
  role: 'SME' | 'OPERATOR';
  user: { id: string; email: string; smeId: string | null };
}

/** Partner bank that issues the SME virtual accounts (matches the seed). */
const VIRTUAL_ACCOUNT_BANK = 'Providus Bank';

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
    private readonly ledger: LedgerService,
    private readonly audit: AuditService,
  ) {}

  /** Email + password -> signed JWT {sub, role, smeId, email}. Same message for unknown email and wrong password. */
  async login(email: string, password: string): Promise<LoginResult> {
    const user = await this.prisma.user.findUnique({ where: { email: email.trim().toLowerCase() } });
    const ok = user ? await compare(password, user.passwordHash) : false;
    if (!user || !ok) throw new ApiError('UNAUTHORIZED', "That email and password don't match");
    return this.issue(user.id, user.role, user.smeId ?? null, user.email);
  }

  /**
   * Self-service onboarding. In one transaction: SME (KYB PENDING), its SME user, and a virtual account
   * number; then its ledger accounts 2000-{sme}/2100-{sme}. The business can sign in and fund its account
   * straight away, but the KYB gate blocks sending until an operator approves it in the review queue
   * (approval screens the legal name against the watchlist: TC01/TC02).
   */
  async register(dto: RegisterDto): Promise<LoginResult> {
    if (await this.prisma.user.findUnique({ where: { email: dto.email } })) {
      throw new ApiError('CONFLICT', 'An account with this email already exists. Sign in instead.');
    }
    const passwordHash = await hash(dto.password, 10);
    const smeId = newId('sme');
    const userId = newId('usr');

    // The virtual account number is the next free 95xxxxxxxx number. Two sign-ups racing for the same
    // number hit the unique index; we simply retry with the next one.
    for (let attempt = 1; ; attempt++) {
      try {
        await this.prisma.$transaction(async (tx) => {
          await tx.smeAccount.create({
            data: { id: smeId, legalName: dto.legal_name, country: 'NG', address: dto.address, rcNumber: dto.rc_number, kybStatus: 'PENDING' },
          });
          await tx.user.create({ data: { id: userId, email: dto.email, passwordHash, role: 'SME', smeId } });
          await tx.virtualAccount.create({
            data: { id: newId('va'), smeId, accountNumber: await this.nextAccountNumber(tx), bankName: VIRTUAL_ACCOUNT_BANK, accountName: dto.legal_name },
          });
        });
        break;
      } catch (e) {
        const unique = e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002';
        const target = String((e as any)?.meta?.target ?? '');
        if (unique && target.includes('email')) throw new ApiError('CONFLICT', 'An account with this email already exists. Sign in instead.');
        if (unique && attempt < 5) continue; // account number collision: try the next number
        throw e;
      }
    }
    await this.ledger.ensureSmeAccounts(smeId);
    await this.audit.log(userId, 'SME_REGISTERED', 'sme_account', smeId, { legal_name: dto.legal_name, rc_number: dto.rc_number, contact_name: dto.contact_name });
    return this.issue(userId, 'SME', smeId, dto.email);
  }

  private async nextAccountNumber(tx: Prisma.TransactionClient): Promise<string> {
    const last = await tx.virtualAccount.findFirst({ where: { accountNumber: { startsWith: '95' } }, orderBy: { accountNumber: 'desc' } });
    const next = last ? BigInt(last.accountNumber) + 1n : 9500000001n;
    return next.toString();
  }

  private async issue(userId: string, role: 'SME' | 'OPERATOR', smeId: string | null, email: string): Promise<LoginResult> {
    const token = await this.jwt.signAsync({ sub: userId, role, smeId, email });
    return { token, role, user: { id: userId, email, smeId } };
  }
}
