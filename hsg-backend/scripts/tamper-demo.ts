/**
 * TC11 Ledger tamper demo.   Run:  npx ts-node scripts/tamper-demo.ts
 *
 *  (a) As the application role (hsg_app): try to UPDATE a journal line  -> rejected.
 *      Also as the owner WITHOUT bypassing triggers                      -> rejected by the trigger.
 *  (b) As the superuser (hsg_owner) on a test database, with session_replication_role = replica
 *      (which skips triggers), alter one amount. verifyChain() then reports broken_at.
 *      The original amount is restored at the end so the database stays usable.
 *
 * Target database: hsg_test by default (never the live dev DB). Override with
 *   TAMPER_APP_URL=postgresql://hsg_app:hsg_app@localhost:5432/<db>
 *   TAMPER_OWNER_URL=postgresql://hsg_owner:hsg_owner@localhost:5432/<db>
 */
import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import { ulid } from 'ulid';

const APP_URL = process.env.TAMPER_APP_URL ?? process.env.TEST_DATABASE_URL ?? 'postgresql://hsg_app:hsg_app@localhost:5432/hsg_test';
const OWNER_URL = process.env.TAMPER_OWNER_URL ?? process.env.TEST_MIGRATE_DATABASE_URL ?? 'postgresql://hsg_owner:hsg_owner@localhost:5432/hsg_test';
// PrismaService reads DATABASE_URL when constructed, so point it at the target DB before importing.
process.env.DATABASE_URL = APP_URL;

const short = (e: unknown) => String((e as any)?.meta?.message ?? (e as any)?.message ?? e).split('\n').filter(Boolean).slice(-1)[0];

async function main() {
  const { PrismaService } = await import('../src/common/prisma.service');
  const { LedgerService } = await import('../src/modules/ledger/ledger.service');
  const app = new PrismaService();
  const owner = new PrismaClient({ datasources: { db: { url: OWNER_URL } } });
  const ledger = new LedgerService(app);

  console.log(`Database: ${APP_URL.replace(/\/\/[^@]+@/, '//***@')}\n`);

  // Make sure there is at least one entry to attack.
  const posted = await ledger.postEntry(`tamper-demo:${ulid()}`, [
    { accountCode: '1000', side: 'DEBIT', amount: 100_00n, currency: 'NGN' },
    { accountCode: '3000', side: 'CREDIT', amount: 100_00n, currency: 'NGN' },
  ], { event: 'TAMPER_DEMO', memo: 'TC11 demo entry' });
  const line = await app.journalLine.findFirstOrThrow({ where: { entryId: posted.id, side: 'DEBIT' } });
  console.log(`Target: entry seq ${posted.seq} (${posted.reference}), line ${line.id}, amount ${line.amount}\n`);

  console.log('--- (a) UPDATE journal_lines as the application role (hsg_app) ---');
  try {
    await app.$executeRaw`UPDATE journal_lines SET amount = 1 WHERE id = ${line.id}`;
    console.log('UNEXPECTED: update succeeded');
  } catch (e) { console.log(`REJECTED: ${short(e)}`); }

  console.log('\n--- (a2) Same UPDATE as the owner, triggers active ---');
  try {
    await owner.$executeRaw`UPDATE journal_lines SET amount = 1 WHERE id = ${line.id}`;
    console.log('UNEXPECTED: update succeeded');
  } catch (e) { console.log(`REJECTED by trigger: ${short(e)}`); }

  console.log('\nverifyChain before tamper:', await ledger.verifyChain());

  console.log('\n--- (b) Superuser bypasses triggers (session_replication_role = replica) and alters the amount ---');
  const setAmount = (amount: bigint) => owner.$transaction([
    owner.$executeRawUnsafe('SET LOCAL session_replication_role = replica'),
    owner.$executeRaw`UPDATE journal_lines SET amount = ${amount} WHERE id = ${line.id}`,
  ]);
  await setAmount(line.amount + 1_000_000_00n);
  console.log(`Altered line ${line.id}: ${line.amount} -> ${line.amount + 1_000_000_00n}`);
  const broken = await ledger.verifyChain();
  console.log('verifyChain after tamper: ', broken);
  console.log(broken.ok ? 'UNEXPECTED: chain still verifies' : `DETECTED: chain broken at seq ${broken.broken_at}`);

  await setAmount(line.amount);
  console.log('\nRestored original amount. verifyChain:', await ledger.verifyChain());

  await app.$disconnect();
  await owner.$disconnect();
}

main().catch((e) => { console.error(e); process.exit(1); });
