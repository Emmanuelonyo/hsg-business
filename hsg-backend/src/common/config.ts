import * as dotenv from 'dotenv';
dotenv.config();

/** Business constants. Illustrative values from the PRD; the thesis reports them as config, not law. */
export const CONFIG = {
  QUOTE_TTL_SECONDS: 60,
  /** Flat fee per transfer, kobo (NGN 7,500.00). */
  FEE_NGN_KOBO: 750_000n,
  /** Margin added on top of the best provider rate when quoting, e.g. 0.005 = 0.5%. Covers rate drift inside the quote window. */
  QUOTE_MARGIN: 0.005,
  /** Compliance: single transfer above this many USD cents is HELD for review (USD 10,000.00). */
  THRESHOLD_USD_CENTS: 1_000_000n,
  /** Compliance: more than VELOCITY_MAX transfers from one SME within VELOCITY_WINDOW_MIN minutes is HELD. */
  VELOCITY_MAX: 5,
  VELOCITY_WINDOW_MIN: 10,
  /** Saga retry policy for transient errors. */
  SAGA_ATTEMPTS: 5,
  SAGA_BACKOFF_MS: 1000,
  /** Token has 6 decimals; USD cents have 2. tokenUnits = cents * 10^4 */
  TOKEN_DECIMALS: 6,
  CENTS_TO_TOKEN: 10_000n,
} as const;

export const ENV = {
  databaseUrl: process.env.DATABASE_URL!,
  redisUrl: process.env.REDIS_URL ?? 'redis://localhost:6379/0',
  jwtSecret: process.env.JWT_SECRET ?? 'dev-only-change-me',
  apiPort: Number(process.env.API_PORT ?? 4000),
  webOrigin: process.env.WEB_ORIGIN ?? 'http://localhost:3000',
  rpcUrl: process.env.RPC_URL ?? 'http://127.0.0.1:8545',
  chainId: Number(process.env.CHAIN_ID ?? 31337),
  explorerTxUrl: process.env.EXPLORER_TX_URL ?? '',
  chainConfigPath: process.env.CHAIN_CONFIG_PATH ?? './chain.local.json',
  payoutPartner: (process.env.PAYOUT_PARTNER ?? 'SIMULATED') as 'SIMULATED' | 'BRIDGE',
};
