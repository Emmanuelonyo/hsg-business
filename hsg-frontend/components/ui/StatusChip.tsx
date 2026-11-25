import type { SmeStatus } from "@/lib/types";

/** Five SME status words, coloured per the design: lime is earned (Completed only). */
const STYLES: Record<SmeStatus, string> = {
  "Processing": "bg-pending text-teal",
  "Under review": "bg-amber-bg text-amber",
  "Completed": "bg-lime text-teal font-semibold",
  "Reversed": "border border-critical text-critical h-[26px]",
  "Declined": "border border-critical text-critical h-[26px]",
};
export function StatusChip({ status }: { status: SmeStatus }) {
  return <span className={`inline-flex items-center h-7 px-3 rounded-full text-[13px] font-medium whitespace-nowrap ${STYLES[status]}`}>{status}</span>;
}
