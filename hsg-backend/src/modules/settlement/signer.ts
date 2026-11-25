import { Account } from 'viem';

/** Key custody seam. LocalKeySigner today; a KmsSigner would implement the same interface (thesis: limitation). */
export interface Signer {
  readonly kind: 'LOCAL' | 'KMS';
  /** viem Account able to sign transactions for `address`. */
  accountFor(address: `0x${string}`): Promise<Account>;
}
