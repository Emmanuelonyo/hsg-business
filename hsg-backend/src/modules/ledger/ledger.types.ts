import { Prisma } from '@prisma/client';
import { Currency } from '../../common/accounts';

export interface LineInput { accountCode: string; side: 'DEBIT' | 'CREDIT'; amount: bigint; currency: Currency; }
export interface PostEntryOptions {
  event: string;               // e.g. 'INFLOW', 'RESERVE', 'RELEASE', 'CHAIN_CONFIRMED', 'PAYOUT_NGN', 'PAYOUT_USD', 'CHAIN_RETURNED'
  transferId?: string;
  memo?: string;
  /** Runs INSIDE the locked transaction, after the ledger_head lock, before insert. Throw to abort (e.g. overdraft check). */
  guard?: (tx: Prisma.TransactionClient) => Promise<void>;
}
export interface PostedEntry { id: string; seq: bigint; reference: string; entryHash: string; prevHash: string; createdAt: Date; /** true if the reference already existed and nothing was posted (idempotent replay) */ duplicate: boolean; }
export interface VerifyResult { ok: boolean; broken_at: string | null; checked: number; }
export interface TrialBalance { NGN: bigint; USD: bigint; ok: boolean; }
export interface AccountBalance { code: string; name: string; type: string; currency: string; debit: bigint; credit: bigint; /** debit - credit */ net: bigint; }
