/**
 * npm run chain:deploy
 *
 * 1. Compiles contracts/MockUSD.sol with solc (npm) and refreshes contracts/MockUSD.json.
 *    If solc is unavailable it falls back to the committed MockUSD.json artifact.
 * 2. Deploys a fresh MockUSD from anvil account 0 (the deployer).
 * 3. Mints USD 200,000.00 (200_000 * 10^6 token units) to each treasury wallet (accounts 1-5).
 * 4. Writes chain.local.json (read by settlement, seed and scripts).
 *
 * Re-running deploys a NEW token and rewrites chain.local.json (re-seed afterwards).
 * Env: RPC_URL, CHAIN_ID, CHAIN_CONFIG_PATH, CHAIN_MNEMONIC (default: anvil's test mnemonic).
 */
import * as dotenv from 'dotenv';
dotenv.config();
import * as fs from 'fs';
import * as path from 'path';
import { createPublicClient, createWalletClient, defineChain, getAddress, http, toHex } from 'viem';
import { mnemonicToAccount } from 'viem/accounts';

const RPC_URL = process.env.RPC_URL ?? 'http://127.0.0.1:8545';
const CHAIN_ID = Number(process.env.CHAIN_ID ?? 31337);
const MNEMONIC = process.env.CHAIN_MNEMONIC ?? 'test test test test test test test test test test test junk';
const OUT_PATH = path.resolve(__dirname, '..', process.env.CHAIN_CONFIG_PATH ?? './chain.local.json');
const ARTIFACT_PATH = path.join(__dirname, 'MockUSD.json');
const SOURCE_PATH = path.join(__dirname, 'MockUSD.sol');

/** USD 200,000.00 in 6-decimal token units. */
const TREASURY_FUNDING_UNITS = 200_000n * 10n ** 6n;

interface Artifact { abi: any[]; bytecode: `0x${string}` }

/** Compile MockUSD.sol with solc-js; on any failure use the committed artifact. */
function loadArtifact(): Artifact {
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const solc = require('solc');
    const input = {
      language: 'Solidity',
      sources: { 'MockUSD.sol': { content: fs.readFileSync(SOURCE_PATH, 'utf8') } },
      settings: { optimizer: { enabled: true, runs: 200 }, evmVersion: 'cancun', outputSelection: { '*': { '*': ['abi', 'evm.bytecode.object'] } } },
    };
    const out = JSON.parse(solc.compile(JSON.stringify(input)));
    const errors = (out.errors ?? []).filter((e: any) => e.severity === 'error');
    if (errors.length) throw new Error(errors.map((e: any) => e.formattedMessage).join('\n'));
    const c = out.contracts['MockUSD.sol'].MockUSD;
    const artifact = { contractName: 'MockUSD', compiler: `solc ${solc.version()}`, abi: c.abi, bytecode: `0x${c.evm.bytecode.object}` };
    fs.writeFileSync(ARTIFACT_PATH, JSON.stringify(artifact, null, 2) + '\n');
    console.log(`compiled MockUSD.sol with ${artifact.compiler}`);
    return artifact as Artifact;
  } catch (e) {
    console.warn(`solc compile failed (${(e as Error).message.split('\n')[0]}); using committed ${ARTIFACT_PATH}`);
    return JSON.parse(fs.readFileSync(ARTIFACT_PATH, 'utf8'));
  }
}

/** Derive anvil account i from the mnemonic, with its raw private key (needed by the local signer). */
function deriveAccount(i: number) {
  const acct = mnemonicToAccount(MNEMONIC, { addressIndex: i });
  const pk = acct.getHdKey().privateKey;
  if (!pk) throw new Error(`no private key for index ${i}`);
  return { address: acct.address, privateKey: toHex(pk) };
}

async function main() {
  const chain = defineChain({
    id: CHAIN_ID, name: CHAIN_ID === 31337 ? 'anvil' : `chain-${CHAIN_ID}`,
    nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 }, rpcUrls: { default: { http: [RPC_URL] } },
  });
  const publicClient = createPublicClient({ chain, transport: http(RPC_URL) });
  const actualChainId = await publicClient.getChainId();
  if (actualChainId !== CHAIN_ID) throw new Error(`RPC ${RPC_URL} reports chainId ${actualChainId}, expected ${CHAIN_ID}`);

  const { abi, bytecode } = loadArtifact();
  const deployerAcct = mnemonicToAccount(MNEMONIC, { addressIndex: 0 });
  const wallet = createWalletClient({ account: deployerAcct, chain, transport: http(RPC_URL) });

  // 1. Deploy
  const deployHash = await wallet.deployContract({ abi, bytecode });
  const deployRcpt = await publicClient.waitForTransactionReceipt({ hash: deployHash });
  const token = getAddress(deployRcpt.contractAddress!); // checksummed
  console.log(`MockUSD deployed at ${token} (block ${deployRcpt.blockNumber})`);

  // 2. Accounts: 0 deployer, 1-5 treasury, 6-8 providers
  const deployer = deriveAccount(0);
  const treasury = [1, 2, 3, 4, 5].map((i, n) => ({ label: `treasury-${n + 1}`, ...deriveAccount(i) }));
  const providers = [6, 7, 8].map((i, n) => ({ label: `provider-${n + 1}`, ...deriveAccount(i) }));

  // 3. Mint USD 200,000.00 to each treasury wallet. Explicit nonces so all five go out at once.
  let nonce = await publicClient.getTransactionCount({ address: deployer.address, blockTag: 'pending' });
  const mintHashes: `0x${string}`[] = [];
  for (const t of treasury) {
    mintHashes.push(await wallet.writeContract({ address: token, abi, functionName: 'mint', args: [t.address, TREASURY_FUNDING_UNITS], nonce: nonce++ }));
  }
  for (const h of mintHashes) {
    const r = await publicClient.waitForTransactionReceipt({ hash: h });
    if (r.status !== 'success') throw new Error(`mint ${h} reverted`);
  }
  for (const t of treasury) {
    const bal = (await publicClient.readContract({ address: token, abi, functionName: 'balanceOf', args: [t.address] })) as bigint;
    console.log(`  ${t.label} ${t.address} balance ${bal / 10n ** 6n} mUSD`);
  }

  // 4. Write chain.local.json
  const config = {
    rpcUrl: RPC_URL,
    chainId: CHAIN_ID,
    token: { address: token, decimals: 6, symbol: 'mUSD' },
    deployer,
    treasury,
    providers,
  };
  fs.writeFileSync(OUT_PATH, JSON.stringify(config, null, 2) + '\n');
  console.log(`wrote ${OUT_PATH}`);

  // 5. A fresh deploy usually means a fresh anvil: drop cached nonce counters so settlement re-reads them from the chain.
  await clearNonceCounters();
}

/** Deletes hsg:nonce:* in REDIS_URL (settlement re-initialises each counter from getTransactionCount). */
async function clearNonceCounters() {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const IORedis = require('ioredis');
  const redis = new IORedis(process.env.REDIS_URL ?? 'redis://localhost:6379/0', { maxRetriesPerRequest: 1, lazyConnect: true });
  try {
    await redis.connect();
    const keys: string[] = await redis.keys('hsg:nonce:*');
    if (keys.length) await redis.del(...keys);
    console.log(`cleared ${keys.length} nonce counter(s) in ${process.env.REDIS_URL ?? 'redis://localhost:6379/0'}`);
  } catch (e) {
    console.warn(`could not clear nonce counters: ${(e as Error).message}`);
  } finally {
    redis.disconnect();
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
