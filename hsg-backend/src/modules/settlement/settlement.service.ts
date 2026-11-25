import { Injectable } from '@nestjs/common';
import { createHash } from 'crypto';
import {
  BaseError, Chain, PublicClient, TransactionReceiptNotFoundError,
  createPublicClient, encodeFunctionData, getAddress, http, keccak256,
} from 'viem';
import { ChainTxKind } from '@prisma/client';
import { CONFIG, ENV } from '../../common/config';
import { DomainError } from '../../common/errors';
import { FaultsService } from '../../common/faults.service';
import { newId } from '../../common/ids';
import { PrismaService } from '../../common/prisma.service';
import { RedisService } from '../../common/redis.service';
import { ChainConfig, ERC20_ABI, chainFromEnv, loadChainConfig } from './chain-config';
import { LocalSigner } from './local-signer';
import { Signer } from './signer';

export interface SendResult { txHash: `0x${string}`; nonce: number; duplicate: boolean; }
export interface ReceiptResult { status: 'PENDING' | 'CONFIRMED' | 'FAILED'; blockNumber?: bigint; confirmations: number; gasUsed?: bigint; }

/** Gas limit for an ERC-20 transfer (actual use is ~35-52k). Fixed so signing needs no extra RPC round trip. */
const TRANSFER_GAS_LIMIT = 100_000n;
/** Redis key holding the NEXT nonce to use for an address. */
export const nonceKey = (address: string) => `hsg:nonce:${address.toLowerCase()}`;

/**
 * CONTRACT (owned by the Chain agent).
 * sendTokens MUST be idempotent per (transferId, kind): if a chain_transactions row exists, return its hash, never re-broadcast.
 * It persists the row (with tx_hash) BEFORE returning. Callers guarantee one in-flight send per fromAddress (per-wallet queue).
 */
@Injectable()
export class SettlementService {
  // Loaded lazily so the API boots (and other modules' tests run) even before chain:deploy has been run.
  private cfg?: ChainConfig;
  private client?: PublicClient;
  private chain?: Chain;
  private signer?: Signer;

  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
    private readonly faults: FaultsService,
  ) {}

  // ---------------------------------------------------------------- setup

  private config(): ChainConfig {
    if (!this.cfg) this.cfg = loadChainConfig();
    return this.cfg;
  }
  private rpc(): PublicClient {
    if (!this.client) {
      this.chain = chainFromEnv();
      this.client = createPublicClient({ chain: this.chain, transport: http(ENV.rpcUrl) }) as PublicClient;
    }
    return this.client;
  }
  private keys(): Signer {
    if (!this.signer) this.signer = new LocalSigner(this.config());
    return this.signer;
  }
  /** Test/ops hook: swap the key-custody adapter (e.g. a KmsSigner). */
  useSigner(signer: Signer) { this.signer = signer; }
  tokenAddress(): `0x${string}` { return this.config().token.address; }

  // ---------------------------------------------------------------- wallets

  /** Treasury wallets from the DB (seeded), ordered by key index; falls back to chain.local.json before seeding. */
  async treasuryWallets(): Promise<{ label: string; address: `0x${string}` }[]> {
    const rows = await this.prisma.wallet.findMany({ where: { kind: 'TREASURY' }, orderBy: { keyIndex: 'asc' } });
    if (rows.length) return rows.map((r) => ({ label: r.label, address: getAddress(r.address) }));
    return this.config().treasury.map((t) => ({ label: t.label, address: getAddress(t.address) }));
  }

  /** Pick the treasury wallet for a transfer (stable hash of transferId over the 5 treasury wallets). */
  async pickTreasuryWallet(transferId: string): Promise<`0x${string}`> {
    const wallets = await this.treasuryWallets();
    if (!wallets.length) throw new DomainError('NO_TREASURY_WALLET', 'No treasury wallets configured');
    // First 4 bytes of sha256(transferId) as an unsigned int, mod wallet count: same transfer -> same wallet, every time.
    const n = createHash('sha256').update(transferId).digest().readUInt32BE(0);
    return wallets[n % wallets.length].address;
  }

  // ---------------------------------------------------------------- send

  async sendTokens(p: { transferId: string; kind: 'SEND' | 'RETURN'; from: `0x${string}`; to: `0x${string}`; usdCents: bigint }): Promise<SendResult> {
    return this.send(p.transferId, p.kind, p.from, p.to, p.usdCents);
  }

  /**
   * Token movement with no transfer and no ledger entry (scripts only: smoke test, TC13 drain).
   * Recorded as kind ADJUSTMENT so it still appears in chain_transactions.
   */
  async sendAdjustment(p: { from: `0x${string}`; to: `0x${string}`; usdCents: bigint }): Promise<SendResult> {
    return this.send(null, 'ADJUSTMENT', p.from, p.to, p.usdCents);
  }

  private async send(transferId: string | null, kind: ChainTxKind, fromRaw: `0x${string}`, toRaw: `0x${string}`, usdCents: bigint): Promise<SendResult> {
    const from = getAddress(fromRaw);
    const to = getAddress(toRaw);

    // (a) Idempotency: a row for (transferId, kind) means we already signed and (maybe) broadcast. NEVER broadcast twice.
    if (transferId) {
      const existing = await this.prisma.chainTransaction.findUnique({ where: { transferId_kind: { transferId, kind } } });
      if (existing) return { txHash: existing.txHash as `0x${string}`, nonce: existing.nonce, duplicate: true };
    }

    if (usdCents <= 0n) throw new DomainError('INVALID_AMOUNT', 'Token amount must be positive');
    const units = usdCents * CONFIG.CENTS_TO_TOKEN;
    const client = this.rpc();
    const token = this.tokenAddress();
    const account = await this.keys().accountFor(from);
    if (!account.signTransaction) throw new DomainError('SIGNER_UNSUPPORTED', `Signer for ${from} cannot sign transactions`);

    // Fail hard (no nonce consumed) if the wallet cannot cover the amount: retrying will not help.
    const balance = await client.readContract({ address: token, abi: ERC20_ABI, functionName: 'balanceOf', args: [from] });
    if (balance < units) throw new DomainError('INSUFFICIENT_TOKEN_BALANCE', `Wallet ${from} holds ${balance} units, needs ${units}`);

    // (b) Nonce from Redis. The counter holds the NEXT nonce; initialise from the chain once (SET NX), then INCR.
    const nonce = await this.nextNonce(from);

    // (c) Sign locally, compute the hash, persist the row, THEN broadcast.
    const fees = await client.estimateFeesPerGas();
    const signed = await account.signTransaction({
      type: 'eip1559',
      chainId: ENV.chainId,
      nonce,
      to: token,
      data: encodeFunctionData({ abi: ERC20_ABI, functionName: 'transfer', args: [to, units] }),
      value: 0n,
      gas: TRANSFER_GAS_LIMIT,
      maxFeePerGas: fees.maxFeePerGas,
      maxPriorityFeePerGas: fees.maxPriorityFeePerGas,
    });
    const txHash = keccak256(signed); // the tx hash is keccak256 of the signed serialised tx

    // Row first: if the process dies right after broadcasting, the hash is already saved and a retry returns it.
    try {
      await this.prisma.chainTransaction.create({
        data: { id: newId('ct'), transferId, kind, fromAddress: from, toAddress: to, tokenAmount: units, txHash, nonce, status: 'PENDING' },
      });
    } catch (e: any) {
      // A concurrent duplicate won the unique (transfer_id, kind) race: return its hash, give the nonce back.
      await this.resyncNonce(from);
      if (e?.code === 'P2002' && transferId) {
        const row = await this.prisma.chainTransaction.findUnique({ where: { transferId_kind: { transferId, kind } } });
        if (row) return { txHash: row.txHash as `0x${string}`, nonce: row.nonce, duplicate: true };
      }
      throw e;
    }

    try {
      await client.sendRawTransaction({ serializedTransaction: signed });
    } catch (e) {
      const msg = errorText(e);
      if (/already known/i.test(msg)) return { txHash, nonce, duplicate: false }; // node already has this exact tx
      if (isNodeRejection(e)) {
        // (d) The node refused it, so it will never land: drop the row, resync the counter, let the saga retry.
        await this.prisma.chainTransaction.delete({ where: { txHash } });
        await this.resyncNonce(from);
        const nonceLow = /nonce too low|nonce.*(lower|too low)/i.test(msg);
        throw new DomainError(nonceLow ? 'NONCE_TOO_LOW' : 'BROADCAST_REJECTED', `Broadcast rejected: ${msg.split('\n')[0]}`, true);
      }
      // Network error / timeout: the tx MAY have reached the node. Keep the row; CHAIN_CONFIRM will find out.
      throw new DomainError('BROADCAST_UNCERTAIN', `Broadcast outcome unknown: ${msg.split('\n')[0]}`, true);
    }
    return { txHash, nonce, duplicate: false };
  }

  /** Reserve the next nonce for `address` (atomic INCR, safe across API and worker processes). */
  private async nextNonce(address: `0x${string}`): Promise<number> {
    const key = nonceKey(address);
    const onChain = await this.rpc().getTransactionCount({ address, blockTag: 'pending' });
    await this.redis.client.set(key, String(onChain), 'NX'); // no-op if the counter already exists
    const next = await this.redis.client.incr(key); // returns the value AFTER increment
    return next - 1;
  }

  /** Reset the counter to the chain's pending transaction count (after a rejected or abandoned nonce). */
  async resyncNonce(address: `0x${string}`): Promise<number> {
    const onChain = await this.rpc().getTransactionCount({ address: getAddress(address), blockTag: 'pending' });
    await this.redis.client.set(nonceKey(address), String(onChain));
    return onChain;
  }

  // ---------------------------------------------------------------- confirm

  /** Reads the receipt; updates chain_transactions (status, block, gas, confirmed_at). Honors the chainDelaySeconds fault. */
  async checkReceipt(txHash: `0x${string}`): Promise<ReceiptResult> {
    const row = await this.prisma.chainTransaction.findUnique({ where: { txHash } });

    // TC09 fault: pretend the network is congested until createdAt + delay has passed.
    const { chainDelaySeconds } = await this.faults.get();
    if (row && chainDelaySeconds > 0 && row.createdAt.getTime() + chainDelaySeconds * 1000 > Date.now()) {
      return { status: 'PENDING', confirmations: 0 };
    }

    const client = this.rpc();
    let receipt;
    try {
      receipt = await client.getTransactionReceipt({ hash: txHash });
    } catch (e) {
      if (e instanceof TransactionReceiptNotFoundError) return { status: 'PENDING', confirmations: 0 };
      throw new DomainError('RPC_ERROR', `Receipt lookup failed: ${errorText(e).split('\n')[0]}`, true);
    }

    const current = await client.getBlockNumber({ cacheTime: 0 }); // no cache: must be >= the receipt's block
    const confirmations = Math.max(1, Number(current - receipt.blockNumber + 1n));
    const status = receipt.status === 'success' ? 'CONFIRMED' : 'FAILED';
    if (row && row.status !== status) {
      await this.prisma.chainTransaction.update({
        where: { txHash },
        data: { status, blockNumber: receipt.blockNumber, gasUsed: receipt.gasUsed, confirmedAt: status === 'CONFIRMED' ? new Date() : null },
      });
    }
    return { status, blockNumber: receipt.blockNumber, gasUsed: receipt.gasUsed, confirmations };
  }

  // ---------------------------------------------------------------- balances

  /** Token balance of one address in USD cents (token units / 10,000). */
  async tokenBalanceCents(address: `0x${string}`): Promise<bigint> {
    const units = await this.rpc().readContract({ address: this.tokenAddress(), abi: ERC20_ABI, functionName: 'balanceOf', args: [getAddress(address)] });
    return units / CONFIG.CENTS_TO_TOKEN;
  }

  /** Per-treasury-wallet balances in USD cents (used by reconcile). */
  async treasuryBalances(): Promise<{ label: string; address: `0x${string}`; balanceCents: bigint }[]> {
    const wallets = await this.treasuryWallets();
    return Promise.all(wallets.map(async (w) => ({ ...w, balanceCents: await this.tokenBalanceCents(w.address) })));
  }

  /** Sum of token balances of all TREASURY wallets, in USD cents. */
  async treasuryOnchainCents(): Promise<bigint> {
    return (await this.treasuryBalances()).reduce((s, w) => s + w.balanceCents, 0n);
  }

  explorerUrl(txHash: string): string | null {
    return ENV.explorerTxUrl ? `${ENV.explorerTxUrl}${txHash}` : null;
  }
}

/** Full error text including viem's nested causes. */
function errorText(e: unknown): string {
  if (e instanceof BaseError) return [e.shortMessage, e.details, e.message].filter(Boolean).join(' | ');
  return e instanceof Error ? e.message : String(e);
}

/** True when the node answered with an error (tx definitely NOT accepted), as opposed to a network failure/timeout. */
function isNodeRejection(e: unknown): boolean {
  if (!(e instanceof BaseError)) return false;
  return !!e.walk((err: any) => err?.name === 'RpcRequestError' || typeof err?.code === 'number' && err.code < 0);
}
