/**
 * Chain smoke test: proves send + confirm end-to-end through SettlementService.
 *   ts-node scripts/chain-smoke.ts
 * Sends USD 1.00 of mUSD treasury-1 -> provider-1, waits for the receipt, then sends it back,
 * so the treasury (and reconcile) end where they started. Rows are kind ADJUSTMENT (no transfer, no ledger entry).
 */
import { loadChainConfig } from '../src/modules/settlement/chain-config';
import { makeSettlement, waitConfirmed } from './chain-common';

async function main() {
  const cfg = loadChainConfig();
  const { settlement, close } = makeSettlement();
  const treasury = cfg.treasury[0].address;
  const provider = cfg.providers[0].address;
  try {
    console.log(`token ${cfg.token.address}`);
    console.log(`treasury-1 before: ${await settlement.tokenBalanceCents(treasury)} cents`);
    for (const [label, from, to] of [['send', treasury, provider], ['return', provider, treasury]] as const) {
      const sent = await settlement.sendAdjustment({ from, to, usdCents: 100n });
      const r = await waitConfirmed(settlement, sent.txHash);
      console.log(`${label}: hash ${sent.txHash} nonce ${sent.nonce} -> ${r.status} block ${r.blockNumber} gas ${r.gasUsed} confirmations ${r.confirmations} in ${r.ms} ms`);
      if (r.status !== 'CONFIRMED') throw new Error(`${label} not confirmed`);
    }
    console.log(`treasury-1 after:  ${await settlement.tokenBalanceCents(treasury)} cents`);
    console.log(`treasury on-chain total: ${await settlement.treasuryOnchainCents()} cents`);
  } finally {
    await close();
  }
}
main().catch((e) => { console.error(e); process.exit(1); });
