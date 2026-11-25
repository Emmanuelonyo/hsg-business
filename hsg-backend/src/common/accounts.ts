/** Chart of accounts (PRD "Chart of accounts"). SME accounts are suffixed with the SME id. */
export const ACCT = {
  SETTLEMENT_BANK: '1000', // Asset NGN
  STABLECOIN_RESERVE: '1100', // Asset USD (treasury wallets)
  PROVIDER_RECEIVABLE: '1200', // Asset USD
  FX_POSITION_NGN: '3000', // Clearing NGN
  FX_POSITION_USD: '3100', // Clearing USD
  FEE_INCOME: '4000', // Income NGN
  smeAvailable: (smeId: string) => `2000-${smeId}`, // Liability NGN
  smeHeld: (smeId: string) => `2100-${smeId}`, // Liability NGN
} as const;

export type Currency = 'NGN' | 'USD';

export const HOUSE_ACCOUNTS: { code: string; name: string; type: 'ASSET' | 'LIABILITY' | 'CLEARING' | 'INCOME'; currency: Currency }[] = [
  { code: '1000', name: 'Settlement bank', type: 'ASSET', currency: 'NGN' },
  { code: '1100', name: 'Stablecoin reserve (treasury wallet)', type: 'ASSET', currency: 'USD' },
  { code: '1200', name: 'Provider receivable', type: 'ASSET', currency: 'USD' },
  { code: '3000', name: 'FX position NGN', type: 'CLEARING', currency: 'NGN' },
  { code: '3100', name: 'FX position USD', type: 'CLEARING', currency: 'USD' },
  { code: '4000', name: 'Fee income', type: 'INCOME', currency: 'NGN' },
];
