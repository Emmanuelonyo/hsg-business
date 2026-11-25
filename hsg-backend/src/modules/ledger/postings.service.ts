import { Injectable } from '@nestjs/common';
import { LedgerService } from './ledger.service';
import { PostedEntry } from './ledger.types';
import { ACCT } from '../../common/accounts';
import { DomainError } from '../../common/errors';

/**
 * CONTRACT (owned by the Ledger agent): one method per posting rule in the PRD table.
 * Reference = `${transferId}:${EVENT}` so a retried saga step can never post twice.
 * Amounts: NGN in kobo, USD in cents.
 */
@Injectable()
export class PostingsService {
  constructor(private readonly ledger: LedgerService) {}

  /** NIP inflow: Dr 1000 / Cr 2000-sme. reference `inflow:{sessionId}` */
  async inflow(smeId: string, sessionId: string, amountKobo: bigint): Promise<PostedEntry> {
    // First money for a new SME: make sure its 2000/2100 accounts exist.
    await this.ledger.ensureSmeAccounts(smeId);
    return this.ledger.postEntry(`inflow:${sessionId}`, [
      { accountCode: ACCT.SETTLEMENT_BANK, side: 'DEBIT', amount: amountKobo, currency: 'NGN' },
      { accountCode: ACCT.smeAvailable(smeId), side: 'CREDIT', amount: amountKobo, currency: 'NGN' },
    ], { event: 'INFLOW', memo: `NIP inflow ${sessionId}` });
  }

  /** Reserve: Dr 2000-sme / Cr 2100-sme, with overdraft guard inside the lock -> DomainError('INSUFFICIENT_FUNDS'). */
  async reserve(transferId: string, smeId: string, totalKobo: bigint): Promise<PostedEntry> {
    await this.ledger.ensureSmeAccounts(smeId);
    return this.ledger.postEntry(`${transferId}:RESERVE`, [
      { accountCode: ACCT.smeAvailable(smeId), side: 'DEBIT', amount: totalKobo, currency: 'NGN' },
      { accountCode: ACCT.smeHeld(smeId), side: 'CREDIT', amount: totalKobo, currency: 'NGN' },
    ], {
      event: 'RESERVE',
      transferId,
      // Runs while ledger_head is locked: no other posting can change the balance between
      // this read and our insert, so two transfers cannot both spend the same naira.
      guard: async (tx) => {
        const available = await this.ledger.liabilityBalance(ACCT.smeAvailable(smeId), tx);
        if (available < totalKobo) {
          throw new DomainError('INSUFFICIENT_FUNDS', `available ${available} kobo is less than ${totalKobo} kobo`, false);
        }
      },
    });
  }

  /** Release (reversal before chain leg, or rejected review): Dr 2100-sme / Cr 2000-sme. event RELEASE */
  async release(transferId: string, smeId: string, totalKobo: bigint): Promise<PostedEntry> {
    await this.ledger.ensureSmeAccounts(smeId);
    return this.ledger.postEntry(`${transferId}:RELEASE`, [
      { accountCode: ACCT.smeHeld(smeId), side: 'DEBIT', amount: totalKobo, currency: 'NGN' },
      { accountCode: ACCT.smeAvailable(smeId), side: 'CREDIT', amount: totalKobo, currency: 'NGN' },
    ], { event: 'RELEASE', transferId });
  }

  /** On-chain leg confirmed: Dr 1200 / Cr 1100 USD. event CHAIN_CONFIRMED */
  async chainConfirmed(transferId: string, usdCents: bigint): Promise<PostedEntry> {
    return this.ledger.postEntry(`${transferId}:CHAIN_CONFIRMED`, [
      { accountCode: ACCT.PROVIDER_RECEIVABLE, side: 'DEBIT', amount: usdCents, currency: 'USD' },
      { accountCode: ACCT.STABLECOIN_RESERVE, side: 'CREDIT', amount: usdCents, currency: 'USD' },
    ], { event: 'CHAIN_CONFIRMED', transferId });
  }

  /** Return tx confirmed: Dr 1100 / Cr 1200 USD. event CHAIN_RETURNED */
  async chainReturned(transferId: string, usdCents: bigint): Promise<PostedEntry> {
    return this.ledger.postEntry(`${transferId}:CHAIN_RETURNED`, [
      { accountCode: ACCT.STABLECOIN_RESERVE, side: 'DEBIT', amount: usdCents, currency: 'USD' },
      { accountCode: ACCT.PROVIDER_RECEIVABLE, side: 'CREDIT', amount: usdCents, currency: 'USD' },
    ], { event: 'CHAIN_RETURNED', transferId });
  }

  /** Payout confirmed NGN side: Dr 2100-sme total / Cr 3000 principal, Cr 4000 fee. event PAYOUT_NGN */
  async payoutNgn(transferId: string, smeId: string, principalKobo: bigint, feeKobo: bigint): Promise<PostedEntry> {
    await this.ledger.ensureSmeAccounts(smeId);
    const lines: Parameters<LedgerService['postEntry']>[1] = [
      { accountCode: ACCT.smeHeld(smeId), side: 'DEBIT', amount: principalKobo + feeKobo, currency: 'NGN' },
      { accountCode: ACCT.FX_POSITION_NGN, side: 'CREDIT', amount: principalKobo, currency: 'NGN' },
    ];
    // A zero fee would be a zero-amount line, which postEntry rejects; just leave it out.
    if (feeKobo > 0n) lines.push({ accountCode: ACCT.FEE_INCOME, side: 'CREDIT', amount: feeKobo, currency: 'NGN' });
    return this.ledger.postEntry(`${transferId}:PAYOUT_NGN`, lines, { event: 'PAYOUT_NGN', transferId });
  }

  /** Payout confirmed USD side: Dr 3100 / Cr 1200. event PAYOUT_USD */
  async payoutUsd(transferId: string, usdCents: bigint): Promise<PostedEntry> {
    return this.ledger.postEntry(`${transferId}:PAYOUT_USD`, [
      { accountCode: ACCT.FX_POSITION_USD, side: 'DEBIT', amount: usdCents, currency: 'USD' },
      { accountCode: ACCT.PROVIDER_RECEIVABLE, side: 'CREDIT', amount: usdCents, currency: 'USD' },
    ], { event: 'PAYOUT_USD', transferId });
  }

  /** Treasury funding at seed time: Dr 1100 / Cr 3100 USD. reference `treasury:{label}` */
  async treasuryFunding(label: string, usdCents: bigint): Promise<PostedEntry> {
    return this.ledger.postEntry(`treasury:${label}`, [
      { accountCode: ACCT.STABLECOIN_RESERVE, side: 'DEBIT', amount: usdCents, currency: 'USD' },
      { accountCode: ACCT.FX_POSITION_USD, side: 'CREDIT', amount: usdCents, currency: 'USD' },
    ], { event: 'TREASURY_FUNDING', memo: `Treasury funding ${label}` });
  }
}
