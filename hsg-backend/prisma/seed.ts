/**
 * Seed script: `npm run db:seed` (ts-node prisma/seed.ts).
 *
 * Assumes a freshly reset database (`npx prisma migrate reset --force --skip-seed`) and a deployed
 * mock token (`npm run chain:deploy` writes chain.local.json). Journal tables are append-only, so a
 * second run against a used database is refused unless SEED_FORCE=1 (then existing rows are skipped,
 * and ledger postings are idempotent by reference anyway).
 *
 * It boots the Nest application context so ledger postings go through the real PostingsService /
 * LedgerService (one write path to the journal), exactly as the running system does.
 */
import 'reflect-metadata';
import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
import * as bcrypt from 'bcryptjs';
import { NestFactory } from '@nestjs/core';
import { createPublicClient, erc20Abi, http } from 'viem';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/common/prisma.service';
import { LedgerService } from '../src/modules/ledger/ledger.service';
import { PostingsService } from '../src/modules/ledger/postings.service';
import { installBigIntJson } from '../src/common/json';
import { newId } from '../src/common/ids';
import { ENV, CONFIG } from '../src/common/config';
import { HOUSE_ACCOUNTS } from '../src/common/accounts';

const PASSWORD = 'Passw0rd!';
const BANK_NAME = 'Providus Bank';
const DEMO_WEBHOOK_URL = process.env.DEMO_WEBHOOK_URL ?? 'http://localhost:4000/api/sim/webhook-sink';
const LOAD_SME_COUNT = 100;
/** NGN 50,000,000.00 in kobo: pre-funding for load-test SMEs only. */
const LOAD_SME_FUNDING_KOBO = 5_000_000_000n;

// ------------------------------------------------------------------ chain.local.json
interface ChainKey { label: string; address: `0x${string}`; privateKey: string }
interface ChainConfig {
  rpcUrl: string; chainId: number;
  token: { address: `0x${string}`; decimals: number; symbol: string };
  treasury: ChainKey[]; providers: ChainKey[];
}

function loadChainConfig(): ChainConfig {
  // Hosted (e.g. Railway): the config arrives as CHAIN_CONFIG_JSON (raw JSON or base64) instead of a file.
  const inline = process.env.CHAIN_CONFIG_JSON?.trim();
  if (inline) return JSON.parse(inline.startsWith('{') ? inline : Buffer.from(inline, 'base64').toString('utf8'));
  const p = path.resolve(process.cwd(), ENV.chainConfigPath);
  if (!fs.existsSync(p)) {
    console.error(`\n✗ ${p} not found: run npm run chain:deploy first\n`);
    process.exit(1);
  }
  return JSON.parse(fs.readFileSync(p, 'utf8'));
}

// ------------------------------------------------------------------ fictional data
/** 20 invented sanctions-list entries. All names are made up for the prototype. */
const WATCHLIST: { name: string; country: string }[] = [
  { name: 'Obsidian Crest Holdings Ltd', country: 'NG' },
  { name: 'Varkov Maritime Logistics LLC', country: 'RU' },
  { name: 'Golden Lotus Commodities FZE', country: 'AE' },
  { name: 'Black Meridian Shipping Co', country: 'PA' },
  { name: 'Zephyr Coast Minerals SARL', country: 'CD' },
  { name: 'Nordhaven Dual-Use Components GmbH', country: 'DE' },
  { name: 'Red Sable Arms Trading', country: 'BY' },
  { name: 'Kestrel Bay Petroleum Ltd', country: 'VE' },
  { name: 'Ironvale Precision Parts Co', country: 'KP' },
  { name: 'Silent Harbor Freight Ltd', country: 'HK' },
  { name: 'Amber Dune General Trading LLC', country: 'IR' },
  { name: 'Tarsus Gate Holdings', country: 'SY' },
  { name: 'Mirelle Offshore Services SA', country: 'CY' },
  { name: 'Corvane Tech Exports Ltd', country: 'CN' },
  { name: 'Halvard Strand Capital', country: 'MM' },
  { name: 'Okoro-Vance Bullion Ltd', country: 'GH' },
  { name: 'Saltmarsh Chemical Trading', country: 'IQ' },
  { name: 'Pale Horizon Aviation Leasing', country: 'LY' },
  { name: 'Duskwater Fisheries Co', country: 'SO' },
  { name: 'Ventrix Global Brokerage', country: 'YE' },
];

const SURNAMES = [
  'Adeyemi', 'Okafor', 'Chukwuemeka', 'Bello', 'Ibrahim', 'Eze', 'Ogunleye', 'Nwosu', 'Abubakar', 'Olaniyan',
  'Okonkwo', 'Danjuma', 'Afolabi', 'Uzor', 'Balogun', 'Obi', 'Lawal', 'Ekwueme', 'Adebisi', 'Musa',
];
const SECTORS = [
  'Imports Ltd', 'Trading Co Ltd', 'Agro Allied Ltd', 'Textiles Ltd', 'Pharma Distributors Ltd',
  'Auto Parts Ltd', 'Electronics Ltd', 'Foods & Beverages Ltd', 'Plastics Industries Ltd', 'Building Materials Ltd',
];
const NG_ADDRESSES = [
  '14 Broad Street, Lagos Island, Lagos', '27 Allen Avenue, Ikeja, Lagos', '5 Upper Iweka Road, Onitsha, Anambra',
  '41 Faulks Road, Aba, Abia', '9 Ahmadu Bello Way, Kaduna', '33 Aminu Kano Crescent, Wuse II, Abuja',
  '18 Trans-Amadi Road, Port Harcourt, Rivers', '62 Ring Road, Ibadan, Oyo', '7 Bompai Road, Kano', '21 Ogui Road, Enugu',
];
/** Clean overseas suppliers: one per load-test SME, chosen round-robin. */
const SUPPLIERS = [
  { name: 'Guangzhou Hengtai Electronics Co.', country: 'CN', bank_name: 'Bank of China, Guangzhou Branch', swift_bic: 'BKCHCNBJ400', address: '88 Tianhe Road, Guangzhou, China' },
  { name: 'Ningbo Seaport Plastics Co.', country: 'CN', bank_name: 'China Construction Bank, Ningbo', swift_bic: 'PCBCCNBJNBX', address: '12 Jiangdong North Road, Ningbo, China' },
  { name: 'Istanbul Textile Mills A.S.', country: 'TR', bank_name: 'Garanti BBVA', swift_bic: 'TGBATRIS', address: 'Merter Mah. 5, Istanbul, Turkey' },
  { name: 'Hamburg Machine Parts GmbH', country: 'DE', bank_name: 'Commerzbank Hamburg', swift_bic: 'COBADEHHXXX', address: 'Ness 7, 20457 Hamburg, Germany' },
  { name: 'Mumbai Pharma Exports Pvt Ltd', country: 'IN', bank_name: 'HDFC Bank', swift_bic: 'HDFCINBB', address: 'Andheri East, Mumbai, India' },
  { name: 'Dubai Auto Spares Trading LLC', country: 'AE', bank_name: 'Emirates NBD', swift_bic: 'EBILAEAD', address: 'Al Quoz Industrial 3, Dubai, UAE' },
  { name: 'Texas Agri Equipment Inc.', country: 'US', bank_name: 'Wells Fargo Bank', swift_bic: 'WFBIUS6S', address: '400 Main St, Houston, TX, USA' },
  { name: 'Leeds Industrial Supplies Ltd', country: 'GB', bank_name: 'Barclays Bank', swift_bic: 'BARCGB22', address: '3 Wellington St, Leeds, UK' },
  { name: 'Sao Paulo Coffee Machines Ltda', country: 'BR', bank_name: 'Banco Itau', swift_bic: 'ITAUBRSP', address: 'Av. Paulista 1000, Sao Paulo, Brazil' },
  { name: 'Shenzhen Brightlink Components Co.', country: 'CN', bank_name: 'Industrial and Commercial Bank of China', swift_bic: 'ICBKCNBJSZN', address: '16 Keji Road, Nanshan, Shenzhen, China' },
];

/** Demo SME's beneficiaries (PRD "Settlement partner: Bridge" examples). */
const DEMO_BENEFICIARIES = [
  { name: 'Shenzhen Ruiqi Machinery Co.', country: 'CN', bank_name: 'Bank of China, Shenzhen Branch', account_number: '7451 0393 6789', swift_bic: 'BKCHCNBJ45A', address: '22 Bao an Avenue, Shenzhen, Guangdong, China', payout_rail: 'wire' },
  { name: 'Rotterdam Agri Supplies B.V.', country: 'NL', bank_name: 'ING Bank N.V.', account_number: 'NL91INGB0001234567', swift_bic: 'INGBNL2A', address: 'Waalhaven 14, 3089 Rotterdam, Netherlands', payout_rail: 'sepa' },
  { name: 'Midlands Tooling Ltd', country: 'GB', bank_name: 'Lloyds Bank', account_number: '30-96-26 12345678', swift_bic: 'LOYDGB2L', address: '8 Tyburn Road, Birmingham B24 8HJ, UK', payout_rail: 'faster_payments' },
];

// ------------------------------------------------------------------ helpers
const pad = (n: number, w: number) => String(n).padStart(w, '0');
/** NUBAN-style 10-digit virtual account number, deterministic per index. */
const accountNumber = (n: number) => `95${pad(n, 8)}`;
const rcNumber = (n: number) => `RC${pad(1_200_000 + n * 37, 7)}`;
const randomAccount = (n: number) => pad((n * 7919 + 104729) % 1_000_000_000, 10);

async function main() {
  installBigIntJson();
  const chain = loadChainConfig();

  const app = await NestFactory.createApplicationContext(AppModule, { logger: ['error', 'warn'] });
  const prisma = app.get(PrismaService);
  const ledger = app.get(LedgerService);
  const postings = app.get(PostingsService);

  try {
    // 0. Refuse to run on a used ledger (journal rows cannot be deleted).
    const existing = await prisma.journalEntry.count();
    if (existing > 0 && process.env.SEED_FORCE !== '1') {
      console.error(
        `\n✗ journal_entries already has ${existing} rows. The journal is append-only, so seed expects a fresh database.\n` +
          `  Reset first:  npx prisma migrate reset --force --skip-seed   (then npm run chain:deploy, npm run db:seed)\n` +
          `  Or re-run on top of existing data (skips what exists): SEED_FORCE=1 npm run db:seed\n`,
      );
      process.exitCode = 1;
      return;
    }

    const passwordHash = await bcrypt.hash(PASSWORD, 10);

    // 1. House ledger accounts (1000, 1100, ...). Upsert so it is harmless if a migration already did it.
    for (const a of HOUSE_ACCOUNTS) {
      await prisma.ledgerAccount.upsert({
        where: { code: a.code },
        update: {},
        create: { id: newId('la'), code: a.code, name: a.name, type: a.type, currency: a.currency },
      });
    }

    // 2. Watchlist (20 fictional names).
    if ((await prisma.watchlist.count()) === 0) {
      await prisma.watchlist.createMany({
        data: WATCHLIST.map((w) => ({ id: newId('wl'), name: w.name, country: w.country, source: 'SEED' })),
      });
    }

    // 3. Operator.
    await prisma.user.upsert({
      where: { email: 'ops@hsg.test' },
      update: {},
      create: { id: newId('usr'), email: 'ops@hsg.test', passwordHash, role: 'OPERATOR' },
    });

    // Creates SME + user + virtual account + ledger accounts. Returns the sme id (existing one if the email is taken).
    let vaCounter = 0;
    const createSme = async (p: {
      email: string; legalName: string; address: string; kyb: 'PENDING' | 'VERIFIED'; webhook?: boolean;
    }): Promise<{ smeId: string; created: boolean }> => {
      vaCounter += 1;
      const found = await prisma.user.findUnique({ where: { email: p.email } });
      if (found?.smeId) return { smeId: found.smeId, created: false };
      const smeId = newId('sme');
      await prisma.$transaction(async (tx) => {
        await tx.smeAccount.create({
          data: {
            id: smeId, legalName: p.legalName, country: 'NG', address: p.address, rcNumber: rcNumber(vaCounter),
            kybStatus: p.kyb,
            webhookUrl: p.webhook ? DEMO_WEBHOOK_URL : null,
            webhookSecret: p.webhook ? `whsec_${crypto.randomBytes(16).toString('hex')}` : null,
          },
        });
        await tx.user.create({ data: { id: newId('usr'), email: p.email, passwordHash, role: 'SME', smeId } });
        await tx.virtualAccount.create({
          data: { id: newId('va'), smeId, accountNumber: accountNumber(vaCounter), bankName: BANK_NAME, accountName: p.legalName },
        });
      });
      await ledger.ensureSmeAccounts(smeId);
      return { smeId, created: true };
    };

    const addBeneficiary = (smeId: string, b: {
      name: string; country: string; bank_name: string; account_number: string; swift_bic?: string; address: string;
      payout_rail?: string; blocked?: { name: string; country: string };
    }) =>
      prisma.beneficiary.create({
        data: {
          id: newId('bn'), smeId, name: b.name, country: b.country, bankName: b.bank_name,
          accountNumber: b.account_number, swiftBic: b.swift_bic ?? null, address: b.address, currency: 'USD',
          payoutRail: b.payout_rail ?? 'wire',
          screeningStatus: b.blocked ? 'BLOCKED' : 'CLEARED',
          screeningDetail: b.blocked
            ? { status: 'BLOCKED', matched: { name: b.blocked.name, country: b.blocked.country, method: 'exact' }, screened_at: new Date().toISOString() }
            : { status: 'CLEARED', matched: null, screened_at: new Date().toISOString() },
        },
      });

    // 4. Demo SME: Adebayo Imports Ltd (verified, NOT funded: demo step 2 is the operator funding it).
    const demo = await createSme({
      email: 'funmi@adebayoimports.ng', legalName: 'Adebayo Imports Ltd',
      address: '12 Creek Road, Apapa, Lagos', kyb: 'VERIFIED', webhook: true,
    });
    if (demo.created) {
      for (const b of DEMO_BENEFICIARIES) await addBeneficiary(demo.smeId, b);
      // Two beneficiaries that match the watchlist (TC06): stored BLOCKED with the match detail.
      const w1 = WATCHLIST[1], w2 = WATCHLIST[2];
      await addBeneficiary(demo.smeId, {
        name: w1.name, country: w1.country, bank_name: 'Baltic Trade Bank', account_number: '40702810900000012345',
        swift_bic: 'BTBKRU2P', address: '3 Portovaya St, St Petersburg', blocked: w1,
      });
      await addBeneficiary(demo.smeId, {
        name: w2.name, country: w2.country, bank_name: 'Gulf Free Zone Bank', account_number: 'AE070331234567890123456',
        swift_bic: 'GFZBAEAD', address: 'Jebel Ali Free Zone, Dubai', blocked: w2,
      });
      // TC06: a beneficiary that was CLEARED when added, but whose name was later put on the watchlist
      // (WATCHLIST[3]). POST /transfers accepts it (stored status CLEARED); the SCREEN step re-screens
      // against the current watchlist and DECLINES it before any money moves.
      const w3 = WATCHLIST[3];
      await addBeneficiary(demo.smeId, {
        name: w3.name, country: w3.country, bank_name: 'Coastal Commerce Bank', account_number: '0012345678901',
        swift_bic: 'CCBKXXAA', address: 'Harbour District',
      });
    }

    // 5. Two KYB-pending SMEs (TC01 clean, TC02 watchlist match). Their users can sign in but not send.
    const kano = await createSme({
      email: 'admin@kanoagroexports.ng', legalName: 'Kano Agro Exports Ltd',
      address: '7 Bompai Road, Kano', kyb: 'PENDING',
    });
    if (kano.created) await addBeneficiary(kano.smeId, { ...SUPPLIERS[6], account_number: randomAccount(9001) });
    const flagged = await createSme({
      email: 'info@obsidiancrest.ng', legalName: WATCHLIST[0].name,
      address: '4 Marina Road, Lagos Island, Lagos', kyb: 'PENDING',
    });
    if (flagged.created) await addBeneficiary(flagged.smeId, { ...SUPPLIERS[3], account_number: randomAccount(9002) });

    // 6. Load-test SMEs sme001..sme100: verified, one cleared beneficiary each, pre-funded NGN 50m.
    for (let i = 0; i < LOAD_SME_COUNT; i++) {
      const n = i + 1;
      const tag = `sme${pad(n, 3)}`;
      const legalName = `${SURNAMES[i % 20]} ${SECTORS[Math.floor(i / 10)]}`;
      const s = await createSme({
        email: `${tag}@hsg.test`, legalName, address: NG_ADDRESSES[i % NG_ADDRESSES.length], kyb: 'VERIFIED',
      });
      if (s.created) await addBeneficiary(s.smeId, { ...SUPPLIERS[i % SUPPLIERS.length], account_number: randomAccount(n) });
      // Idempotent by reference `inflow:seed-smeNNN`.
      await postings.inflow(s.smeId, `seed-${tag}`, LOAD_SME_FUNDING_KOBO);
      if (n % 20 === 0) console.log(`  … ${n}/${LOAD_SME_COUNT} load-test SMEs`);
    }

    // 7. Wallets: treasury (key index 1-5) and provider (6-8) from chain.local.json.
    const walletRows = [
      ...chain.treasury.map((w, i) => ({ ...w, kind: 'TREASURY' as const, keyIndex: 1 + i })),
      ...chain.providers.map((w, i) => ({ ...w, kind: 'PROVIDER' as const, keyIndex: 6 + i })),
    ];
    for (const w of walletRows) {
      await prisma.wallet.upsert({
        where: { address: w.address },
        update: {},
        create: { id: newId('wal'), label: w.label, address: w.address, kind: w.kind, keyIndex: w.keyIndex },
      });
    }

    // 8. Liquidity providers, each paid at its own provider wallet.
    const providers = [
      { name: 'Atlas FX', rate: '1572.50', capacityUsd: 25_000_000n, reliability: 0.99 },
      { name: 'Meridian Liquidity', rate: '1569.00', capacityUsd: 10_000_000n, reliability: 0.95 },
      { name: 'Harbor OTC', rate: '1575.25', capacityUsd: 50_000_000n, reliability: 0.999 },
    ];
    for (let i = 0; i < providers.length; i++) {
      const p = providers[i];
      const wallet = chain.providers[i];
      if (!wallet) throw new Error(`chain.local.json has no providers[${i}]`);
      await prisma.liquidityProvider.upsert({
        where: { name: p.name },
        update: { walletAddress: wallet.address },
        create: {
          id: newId('lp'), name: p.name, rate: p.rate, capacityUsd: p.capacityUsd, reliability: p.reliability,
          payoutDelayMs: 3000, walletAddress: wallet.address, adapter: 'SIMULATED', active: true,
        },
      });
    }

    // 9. Treasury funding: ledger 1100 must equal what is actually on chain, so read each balance.
    const client = createPublicClient({ transport: http(chain.rpcUrl || ENV.rpcUrl) });
    let treasuryTotal = 0n;
    for (const w of chain.treasury) {
      const units = await client.readContract({
        address: chain.token.address, abi: erc20Abi, functionName: 'balanceOf', args: [w.address],
      });
      const cents = units / CONFIG.CENTS_TO_TOKEN;
      if (cents > 0n) await postings.treasuryFunding(w.label, cents); // reference treasury:{label}, idempotent
      treasuryTotal += cents;
    }

    // 10. Summary.
    const smeCount = await prisma.smeAccount.count();
    const tb = await ledger.trialBalance().catch(() => null);
    console.log(`
✓ Seed complete
  SMEs: ${smeCount}   watchlist: ${await prisma.watchlist.count()}   providers: ${providers.length}   wallets: ${walletRows.length}
  Treasury funded on ledger 1100: USD ${(Number(treasuryTotal) / 100).toLocaleString('en-US', { minimumFractionDigits: 2 })}
  Trial balance: ${tb ? `NGN ${tb.NGN} / USD ${tb.USD} ok=${tb.ok}` : 'n/a'}

  Logins (password for all: ${PASSWORD})
    ops@hsg.test                 OPERATOR
    funmi@adebayoimports.ng      SME  Adebayo Imports Ltd (verified, balance 0: fund it from the operator console)
    admin@kanoagroexports.ng     SME  Kano Agro Exports Ltd (KYB pending, clean -> TC01)
    info@obsidiancrest.ng        SME  ${WATCHLIST[0].name} (KYB pending, watchlist match -> TC02)
    sme001@hsg.test … sme100@hsg.test  load-test SMEs (verified, NGN 50,000,000.00 each)
`);
  } finally {
    await app.close();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
