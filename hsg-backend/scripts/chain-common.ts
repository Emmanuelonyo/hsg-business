/** Shared bootstrap for chain-*.ts scripts: builds SettlementService without Nest. */
import { PrismaService } from '../src/common/prisma.service';
import { RedisService } from '../src/common/redis.service';
import { FaultsService } from '../src/common/faults.service';
import { SettlementService } from '../src/modules/settlement/settlement.service';

export function makeSettlement() {
  const prisma = new PrismaService();
  const redis = new RedisService();
  const faults = new FaultsService(redis);
  const settlement = new SettlementService(prisma, redis, faults);
  const close = async () => { await prisma.$disconnect(); await redis.client.quit(); };
  return { prisma, redis, faults, settlement, close };
}

/** Poll checkReceipt until the tx is no longer PENDING (or timeout). */
export async function waitConfirmed(settlement: SettlementService, hash: `0x${string}`, timeoutMs = 60_000) {
  const t0 = Date.now();
  for (;;) {
    const r = await settlement.checkReceipt(hash);
    if (r.status !== 'PENDING') return { ...r, ms: Date.now() - t0 };
    if (Date.now() - t0 > timeoutMs) throw new Error(`timeout waiting for ${hash}`);
    await new Promise((res) => setTimeout(res, 250));
  }
}
