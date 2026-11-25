import { Account } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { DomainError } from '../../common/errors';
import { ChainConfig } from './chain-config';
import { Signer } from './signer';

/**
 * Local-key adapter for the Signer seam.
 * Private keys come from chain.local.json (deployer, 5 treasury wallets, 3 provider wallets).
 * Keys sit in process memory: acceptable for a test network, recorded as a limitation in the thesis.
 */
export class LocalSigner implements Signer {
  readonly kind = 'LOCAL' as const;
  private readonly accounts = new Map<string, Account>();

  constructor(cfg: ChainConfig) {
    const keys = [cfg.deployer, ...cfg.treasury, ...cfg.providers];
    for (const k of keys) {
      const acct = privateKeyToAccount(k.privateKey);
      this.accounts.set(acct.address.toLowerCase(), acct);
    }
  }

  async accountFor(address: `0x${string}`): Promise<Account> {
    const acct = this.accounts.get(address.toLowerCase());
    if (!acct) throw new DomainError('NO_SIGNING_KEY', `No local signing key for ${address}`);
    return acct;
  }
}
