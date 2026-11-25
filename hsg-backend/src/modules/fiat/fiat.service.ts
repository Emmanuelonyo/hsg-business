import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { createHash } from 'crypto';
import { PrismaService } from '../../common/prisma.service';
import { AuditService } from '../../common/audit.service';
import { SagaQueue } from '../../common/saga-queue';
import { CONFIG } from '../../common/config';
import { ApiError } from '../../common/errors';
import { newId } from '../../common/ids';
import { canonicalJson } from '../../common/json';
import { basisToRate, rateToBasis, usdCentsToKobo } from '../../common/money';
import { SME_STATUS_TO_STATES, SmeStatus } from '../../common/status-map';
import { LedgerService } from '../ledger/ledger.service';
import { LiquidityService } from '../liquidity/liquidity.service';
import { ComplianceService } from '../compliance/compliance.service';
import { CreateBeneficiaryDto, CreateTransferDto } from './dto';
import { serializeBeneficiary, serializeQuote, serializeTransfer, serializeTransferAccepted } from './sme-serializer';
import { TransferReferenceService } from './transfer-reference';

/** Used when no live market rate is available (liquidity not wired yet / no capacity), so quoting still works. */
export const FALLBACK_REFERENCE_RATE = '1580.00';

/** Quoted rate = reference rate x (1 + margin), rounded half-up to 2dp. Integer math on "basis" (rate x 100). */
export function applyMargin(referenceRate: string, margin: number = CONFIG.QUOTE_MARGIN): string {
  const ppm = BigInt(Math.round(margin * 1_000_000)); // 0.005 -> 5000 parts per million
  const basis = rateToBasis(referenceRate);
  return basisToRate((basis * (1_000_000n + ppm) + 500_000n) / 1_000_000n);
}

/** sha256 of the canonical request body: the idempotency fingerprint. */
export function requestHash(body: CreateTransferDto): string {
  const canonical = canonicalJson({ quote_id: body.quote_id, beneficiary_id: body.beneficiary_id, purpose: body.purpose });
  return createHash('sha256').update(canonical).digest('hex');
}

@Injectable()
export class FiatService {
  private readonly log = new Logger(FiatService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly ledger: LedgerService,
    private readonly liquidity: LiquidityService,
    private readonly compliance: ComplianceService,
    private readonly saga: SagaQueue,
    private readonly audit: AuditService,
    private readonly refs: TransferReferenceService,
  ) {}

  // ---------------------------------------------------------------- beneficiaries

  async listBeneficiaries(smeId: string) {
    const rows = await this.prisma.beneficiary.findMany({ where: { smeId }, orderBy: { createdAt: 'desc' } });
    return { items: rows.map(serializeBeneficiary) };
  }

  /** Create + screen synchronously. A watchlist hit still creates the row, as BLOCKED. */
  async createBeneficiary(userId: string, smeId: string, dto: CreateBeneficiaryDto) {
    const screen = await this.compliance.screenName(dto.name, dto.country);
    const id = newId('bn');
    const detail = { rule: 'SANCTIONS', value: { name: dto.name, country: dto.country }, matched: screen.matched ?? null, screened_at: new Date().toISOString() };

    const [b] = await this.prisma.$transaction([
      this.prisma.beneficiary.create({
        data: {
          id, smeId, name: dto.name, country: dto.country, bankName: dto.bank_name, accountNumber: dto.account_number,
          swiftBic: dto.swift_bic ?? null, address: dto.address, currency: dto.currency ?? 'USD',
          screeningStatus: screen.status, screeningDetail: detail as any,
        },
      }),
      this.prisma.complianceCheck.create({
        data: { id: newId('cc'), smeId, subject: 'BENEFICIARY', gate: 'SANCTIONS', result: screen.status === 'CLEARED' ? 'PASS' : 'FAIL', detail: { ...detail, beneficiary_id: id } as any },
      }),
    ]);
    await this.audit.log(userId, 'beneficiary.create', 'beneficiary', id, { screening_status: screen.status });
    return serializeBeneficiary(b);
  }

  // ---------------------------------------------------------------- quotes

  async createQuote(smeId: string, usdAmount: string) {
    const sme = await this.prisma.smeAccount.findUniqueOrThrow({ where: { id: smeId } });
    if (sme.kybStatus !== 'VERIFIED') throw new ApiError('KYB_NOT_VERIFIED', 'Your business verification is not complete yet');

    const usd = BigInt(usdAmount);
    const referenceRate = await this.referenceRate(usd);
    const rate = applyMargin(referenceRate);
    const principal = usdCentsToKobo(usd, rate);
    const fee = CONFIG.FEE_NGN_KOBO;
    const now = new Date();

    const q = await this.prisma.quote.create({
      data: {
        id: newId('qt'), smeId, usdAmount: usd, rate, principalNgn: principal, feeNgn: fee, totalNgn: principal + fee,
        referenceRate, createdAt: now, expiresAt: new Date(now.getTime() + CONFIG.QUOTE_TTL_SECONDS * 1000),
      },
    });
    return serializeQuote(q);
  }

  /** Best market rate from liquidity, or the fallback constant if liquidity is unavailable. */
  private async referenceRate(usd: bigint): Promise<string> {
    try {
      const best = await this.liquidity.bestRate(usd);
      if (best) return best;
    } catch (e) {
      this.log.warn(`bestRate unavailable (${(e as Error).message}); using fallback rate`);
    }
    return FALLBACK_REFERENCE_RATE;
  }

  // ---------------------------------------------------------------- transfers

  /**
   * POST /transfers. Order of checks is fixed by the API contract:
   *  idempotency replay/conflict -> quote (NOT_FOUND) -> QUOTE_EXPIRED -> BENEFICIARY_NOT_CLEARED
   *  -> KYB_NOT_VERIFIED -> INSUFFICIENT_FUNDS -> create (CREATED), mark quote used, enqueue SCREEN.
   * Nothing is posted to the ledger here: the hold is the saga's RESERVE step.
   */
  async createTransfer(userId: string, smeId: string, idempotencyKey: string | undefined, dto: CreateTransferDto) {
    const key = (idempotencyKey ?? '').trim();
    if (!key) throw new ApiError('VALIDATION_ERROR', 'Idempotency-Key header is required');
    if (key.length > 200) throw new ApiError('VALIDATION_ERROR', 'Idempotency-Key is too long');
    const hash = requestHash(dto);

    // 1. Same key seen before for this SME? Replay or conflict.
    const replay = await this.replayOrConflict(smeId, key, hash);
    if (replay) return replay;

    // 2. Quote must belong to this SME and be unused.
    const quote = await this.prisma.quote.findFirst({ where: { id: dto.quote_id, smeId, usedAt: null } });
    if (!quote) {
      // A concurrent request with the same key may have just consumed this quote: replay it if so.
      const r = await this.replayOrConflict(smeId, key, hash);
      if (r) return r;
      throw new ApiError('NOT_FOUND', 'Quote not found or already used');
    }

    // 3. Quote still inside its 60 s window.
    const now = new Date();
    if (quote.expiresAt <= now) throw new ApiError('QUOTE_EXPIRED', 'This quote has expired. Get a new quote to continue.');

    // 4. Beneficiary belongs to this SME and passed screening.
    const beneficiary = await this.prisma.beneficiary.findFirst({ where: { id: dto.beneficiary_id, smeId } });
    if (!beneficiary) throw new ApiError('NOT_FOUND', 'Beneficiary not found');
    if (beneficiary.screeningStatus !== 'CLEARED') throw new ApiError('BENEFICIARY_NOT_CLEARED', 'This beneficiary has not been cleared to receive payments');

    // 5. Business verified.
    const sme = await this.prisma.smeAccount.findUniqueOrThrow({ where: { id: smeId }, include: { virtualAccount: true } });
    if (sme.kybStatus !== 'VERIFIED') throw new ApiError('KYB_NOT_VERIFIED', 'Your business verification is not complete yet');

    // 6. Enough available naira (advisory here; RESERVE re-checks under the ledger lock).
    const { available } = await this.ledger.smeBalances(smeId);
    if (available < quote.totalNgn) throw new ApiError('INSUFFICIENT_FUNDS', 'Your available balance is not enough for this payment');

    // 7. Travel Rule record: originator (the SME) and beneficiary identity, frozen at creation.
    const travelRule = {
      originator: { name: sme.legalName, account: sme.virtualAccount?.accountNumber ?? '', address: sme.address, country: sme.country },
      beneficiary: { name: beneficiary.name, account: beneficiary.accountNumber, address: beneficiary.address, country: beneficiary.country, bank_name: beneficiary.bankName, swift_bic: beneficiary.swiftBic },
    };

    // 8. Create the transfer and consume the quote atomically. Retry only on a reference collision.
    const id = newId('tr');
    for (let attempt = 1; ; attempt++) {
      const reference = await this.refs.next(now);
      try {
        await this.prisma.$transaction(async (tx) => {
          const used = await tx.quote.updateMany({ where: { id: quote.id, usedAt: null }, data: { usedAt: now } });
          if (used.count !== 1) throw new ApiError('NOT_FOUND', 'Quote not found or already used');
          await tx.transfer.create({
            data: {
              id, reference, smeId, beneficiaryId: beneficiary.id, quoteId: quote.id, status: 'CREATED', purpose: dto.purpose,
              travelRule: travelRule as any, idempotencyKey: key, requestHash: hash,
              usdAmount: quote.usdAmount, rate: quote.rate, principalNgn: quote.principalNgn, feeNgn: quote.feeNgn, totalNgn: quote.totalNgn,
              currentStep: 'SCREEN', createdAt: now,
            },
          });
        });
        break;
      } catch (e) {
        if (e instanceof ApiError) {
          const r = await this.replayOrConflict(smeId, key, hash);
          if (r) return r;
          throw e;
        }
        if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
          const target = String((e.meta as any)?.target ?? '');
          // A concurrent request with the same Idempotency-Key won the race: replay its result.
          if (target.includes('idempotency_key') || target.includes('idempotencyKey')) {
            const r = await this.replayOrConflict(smeId, key, hash);
            if (r) return r;
          }
          // The quote was taken by a concurrent request with a different key.
          if (target.includes('quote_id') || target.includes('quoteId')) throw new ApiError('NOT_FOUND', 'Quote not found or already used');
          if (target.includes('reference') && attempt < 5) continue;
        }
        throw e;
      }
    }

    // 9. Start the saga. Enqueue is idempotent per (transfer, step) via the job id.
    await this.saga.enqueueStep(id, 'SCREEN');
    await this.audit.log(userId, 'transfer.create', 'transfer', id, { quote_id: quote.id, idempotency_key: key });

    const created = await this.prisma.transfer.findUniqueOrThrow({ where: { id }, include: { beneficiary: true } });
    return serializeTransferAccepted(created);
  }

  /** Existing transfer for (sme, key): same body -> original 202 body; different body -> 409. */
  private async replayOrConflict(smeId: string, key: string, hash: string) {
    const existing = await this.prisma.transfer.findUnique({
      where: { smeId_idempotencyKey: { smeId, idempotencyKey: key } },
      include: { beneficiary: true },
    });
    if (!existing) return null;
    if (existing.requestHash !== hash) throw new ApiError('IDEMPOTENCY_CONFLICT', 'This Idempotency-Key was already used with a different request');
    return serializeTransferAccepted(existing);
  }

  async listTransfers(smeId: string, status: SmeStatus | undefined, limit = 50) {
    const rows = await this.prisma.transfer.findMany({
      where: { smeId, ...(status ? { status: { in: SME_STATUS_TO_STATES[status] } } : {}) },
      include: { beneficiary: true },
      orderBy: { createdAt: 'desc' },
      take: limit,
    });
    return { items: rows.map(serializeTransfer) };
  }

  async getTransfer(smeId: string, id: string) {
    const t = await this.prisma.transfer.findFirst({ where: { id, smeId }, include: { beneficiary: true } });
    if (!t) throw new ApiError('NOT_FOUND', 'Transfer not found');
    return serializeTransfer(t);
  }
}
