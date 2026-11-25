/**
 * TC13 reconciliation variance: moves tokens OUT of a treasury wallet with NO ledger entry.
 *   ts-node scripts/chain-drain.ts [usd=500] [treasuryLabel=treasury-1]
 * Afterwards POST /ops/reconcile reports variance_cents = -(usd * 100).
 */
import { privateKeyToAccount, generatePrivateKey } from 'viem/accounts';
import { loadChainConfig } from '../src/modules/settlement/chain-config';
import { makeSettlement, waitConfirmed } from './chain-common';

async function main() {
  const usd = BigInt(process.argv[2] ?? '500');
  const label = process.argv[3] ?? 'treasury-1';
  const cfg = loadChainConfig();
  const wallet = cfg.treasury.find((t) => t.label === label);
  if (!wallet) throw new Error(`unknown treasury label ${label}`);
  const sink = privateKeyToAccount(generatePrivateKey()).address; // random address nobody controls
  const { settlement, close } = makeSettlement();
  try {
    const sent = await settlement.sendAdjustment({ from: wallet.address, to: sink, usdCents: usd * 100n });
    const r = await waitConfirmed(settlement, sent.txHash);
    console.log(`drained USD ${usd}.00 from ${label} ${wallet.address} to ${sink}`);
    console.log(`hash ${sent.txHash} ${r.status} block ${r.blockNumber}`);
    console.log(`${label} balance now ${await settlement.tokenBalanceCents(wallet.address)} cents; run POST /ops/reconcile to see the variance`);
  } finally {
    await close();
  }
}
main().catch((e) => { console.error(e); process.exit(1); });
