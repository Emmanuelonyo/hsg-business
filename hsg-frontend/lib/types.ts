/** API shapes (see docs/API-CONTRACT.md in the repo root). Money = minor-unit strings. */
export type SmeStatus = "Processing" | "Under review" | "Completed" | "Reversed" | "Declined";
export type TransferState = "CREATED" | "SCREENING" | "HELD" | "RESERVED" | "ONCHAIN_PENDING" | "ONCHAIN_CONFIRMED" | "PAYOUT_PENDING" | "COMPLETED" | "REVERSING" | "REVERSED" | "DECLINED";

export interface LoginResponse { token: string; role: "SME" | "OPERATOR"; user: { id: string; email: string; smeId: string | null } }
export interface Me { id: string; email: string; sme: { id: string; legal_name: string; kyb_status: "PENDING" | "VERIFIED" | "REJECTED"; address: string; country: string }; virtual_account: { account_number: string; bank_name: string; account_name: string } }
export interface Balance { currency: "NGN"; available: string; held: string }
export interface Beneficiary { id: string; name: string; country: string; bank_name: string; account_number_masked: string; swift_bic: string | null; address: string; currency: string; screening_status: "CLEARED" | "BLOCKED"; created_at: string }
export interface Quote { id: string; usd_amount: string; rate: string; fee_ngn: string; principal_ngn: string; total_ngn: string; expires_at: string; created_at: string }
export interface TimelineStep { key: "received" | "checks" | "sent" | "delivered"; label: "Received" | "Checks passed" | "Sent" | "Delivered"; at: string | null; state: "done" | "current" | "pending" | "failed" }
export interface SmeTransfer {
  id: string; reference: string; status: SmeStatus; usd_amount: string; ngn_debited: string; rate: string; fee_ngn: string;
  purpose: string; beneficiary: { id: string; name: string; country: string; bank_name: string; account_number_masked: string };
  failure_reason: string | null; ngn_returned: string | null; created_at: string; completed_at: string | null; timeline: TimelineStep[];
}
export interface Page<T> { items: T[]; next_cursor?: string | null }
