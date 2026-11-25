/** Payout leg seam (PRD "Settlement partner: Bridge"). SimulatedAdapter is live; BridgeAdapter is a sandbox stub. */
export interface PayoutRequest {
  orderId: string;
  transferId: string;
  providerId: string;
  usdCents: bigint;
  beneficiary: { name: string; accountNumber: string; bankName: string; country: string; swiftBic?: string | null };
  /** Optional, used by the Bridge adapter only: the treasury wallet the stablecoin leg is sent from. */
  fromAddress?: string | null;
  /** Optional, Bridge only: the beneficiary registered as a Bridge external account. */
  externalAccountId?: string | null;
  /** Optional payout currency / rail (defaults USD / wire). */
  currency?: string;
  paymentRail?: string | null;
}
export type PayoutResult = { ok: true; externalRef: string } | { ok: false; hard: boolean; reason: string };
export interface PayoutPartner {
  readonly name: 'SIMULATED' | 'BRIDGE';
  payout(req: PayoutRequest): Promise<PayoutResult>;
}
