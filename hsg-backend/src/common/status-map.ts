import { TransferState } from '@prisma/client';

/** The SME sees five words only (PRD "Users and the core flow"). */
export type SmeStatus = 'Processing' | 'Under review' | 'Completed' | 'Reversed' | 'Declined';
export function toSmeStatus(s: TransferState): SmeStatus {
  switch (s) {
    case 'HELD': return 'Under review';
    case 'COMPLETED': return 'Completed';
    case 'REVERSED': return 'Reversed';
    case 'DECLINED': return 'Declined';
    default: return 'Processing';
  }
}
export const SME_STATUS_TO_STATES: Record<SmeStatus, TransferState[]> = {
  'Processing': ['CREATED', 'SCREENING', 'RESERVED', 'ONCHAIN_PENDING', 'ONCHAIN_CONFIRMED', 'PAYOUT_PENDING', 'REVERSING'],
  'Under review': ['HELD'],
  'Completed': ['COMPLETED'],
  'Reversed': ['REVERSED'],
  'Declined': ['DECLINED'],
};
export const TERMINAL_STATES: TransferState[] = ['COMPLETED', 'REVERSED', 'DECLINED'];
