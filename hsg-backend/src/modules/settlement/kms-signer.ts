import { Account } from 'viem';
import { Signer } from './signer';

/**
 * AWS KMS adapter for the Signer seam: NOT IMPLEMENTED (thesis limitation).
 *
 * The proposal names AWS KMS for key custody. A real adapter would:
 *  1. hold one secp256k1 KMS key (ECC_SECG_P256K1) per treasury/provider wallet, keyed by address;
 *  2. build a viem custom account (`toAccount`) whose signTransaction serialises the tx,
 *     keccak-hashes it, calls KMS Sign (MessageType DIGEST), converts the DER signature to (r, s),
 *     normalises s to the lower half-order and recovers v by trying both recovery ids against the address.
 * The private key never leaves KMS. No AWS account was available for this build, so signing uses
 * LocalSigner (keys from chain.local.json) and this class only documents the seam.
 */
export class KmsSigner implements Signer {
  readonly kind = 'KMS' as const;
  async accountFor(_address: `0x${string}`): Promise<Account> {
    throw new Error('KmsSigner is not implemented: local signing is used (see thesis limitations)');
  }
}
