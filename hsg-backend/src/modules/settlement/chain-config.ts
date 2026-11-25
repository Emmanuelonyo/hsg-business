import * as fs from 'fs';
import * as path from 'path';
import { defineChain, Chain } from 'viem';
import { ENV } from '../../common/config';

/** Shape of chain.local.json, written by `npm run chain:deploy` (contracts/deploy.ts). */
export interface ChainKey { label: string; address: `0x${string}`; privateKey: `0x${string}` }
export interface ChainConfig {
  rpcUrl: string;
  chainId: number;
  token: { address: `0x${string}`; decimals: number; symbol: string };
  deployer: { address: `0x${string}`; privateKey: `0x${string}` };
  treasury: ChainKey[];
  providers: ChainKey[];
}

/**
 * Chain config: CHAIN_CONFIG_JSON (raw JSON or base64, for hosts without files, e.g. Railway),
 * else chain.local.json (path from CHAIN_CONFIG_PATH, relative to the backend folder / cwd).
 */
export function loadChainConfig(file = ENV.chainConfigPath): ChainConfig {
  const inline = process.env.CHAIN_CONFIG_JSON?.trim();
  if (inline) return JSON.parse(inline.startsWith('{') ? inline : Buffer.from(inline, 'base64').toString('utf8')) as ChainConfig;
  const full = path.isAbsolute(file) ? file : path.resolve(process.cwd(), file);
  if (!fs.existsSync(full)) throw new Error(`chain config ${full} not found: run "npm run chain:deploy" first`);
  return JSON.parse(fs.readFileSync(full, 'utf8')) as ChainConfig;
}

/** viem chain definition from env (RPC_URL / CHAIN_ID), so switching networks is an env change. */
export function chainFromEnv(): Chain {
  return defineChain({
    id: ENV.chainId,
    name: ENV.chainId === 31337 ? 'anvil' : ENV.chainId === 84532 ? 'base-sepolia' : `chain-${ENV.chainId}`,
    nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
    rpcUrls: { default: { http: [ENV.rpcUrl] } },
  });
}

/** The three ERC-20 functions settlement uses. */
export const ERC20_ABI = [
  { type: 'function', name: 'transfer', stateMutability: 'nonpayable', inputs: [{ name: 'to', type: 'address' }, { name: 'value', type: 'uint256' }], outputs: [{ type: 'bool' }] },
  { type: 'function', name: 'balanceOf', stateMutability: 'view', inputs: [{ name: 'owner', type: 'address' }], outputs: [{ type: 'uint256' }] },
  { type: 'function', name: 'decimals', stateMutability: 'view', inputs: [], outputs: [{ type: 'uint8' }] },
] as const;
