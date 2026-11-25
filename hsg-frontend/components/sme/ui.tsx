"use client";
/** Small building blocks shared by the SME screens: states, copy button, transfers table, polling hook. */
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { ApiError } from "@/lib/api";
import { fmtMinor, fmtTime, money, parseMajorToMinor } from "@/lib/money";
import type { SmeTransfer } from "@/lib/types";
import { StatusChip } from "@/components/ui/StatusChip";
import { countryName } from "./countries";
import { Icon, Sparkle } from "./motifs";

/** Shared input styling from the design (52px, 1.5px #C4CFCC border, 14px radius). */
export const inputCls =
  "h-[52px] w-full min-w-0 rounded-[14px] border-[1.5px] border-input bg-white px-4 text-[15px] text-teal outline-none focus:border-teal focus-visible:ring-2 focus-visible:ring-lime-edge";

/** Banking-language copy for API error codes. Never shows internal wording. */
export function friendlyError(e: unknown): string {
  if (e instanceof ApiError) {
    switch (e.code) {
      case "QUOTE_EXPIRED": return "This rate has expired. Refresh to get a new one; nothing has been taken from your balance.";
      case "INSUFFICIENT_FUNDS": return "Your available balance is not enough for this payment. Add funds and try again.";
      case "BENEFICIARY_NOT_CLEARED": return "This beneficiary has not been cleared by our checks, so it can’t be paid.";
      case "KYB_NOT_VERIFIED": return "We are still verifying your business. You can send payments once verification is complete.";
      case "IDEMPOTENCY_CONFLICT": return "This payment was already submitted with different details. Start a new payment.";
      case "VALIDATION_ERROR": return e.message || "Some details are missing or invalid.";
      case "NOT_FOUND": return "We couldn’t find that. It may have been used already.";
      default: return e.message || "Something went wrong. Please try again.";
    }
  }
  return "We couldn’t reach HSG. Check your connection and try again.";
}

export function Skeleton({ className = "" }: { className?: string }) {
  return <div aria-hidden="true" className={`animate-pulse rounded-xl bg-line-soft ${className}`} />;
}

export function ErrorState({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div role="alert" className="flex flex-wrap items-center gap-3 rounded-[14px] border border-critical-line bg-critical-bg px-4 py-3 text-[14px] leading-5 text-critical">
      <Icon name="alert" />
      <span className="flex-1">{message}</span>
      {onRetry && (
        <button type="button" onClick={onRetry} className="h-9 cursor-pointer rounded-full border-[1.5px] border-critical bg-white px-4 text-[13px] font-medium">Try again</button>
      )}
    </div>
  );
}

export function EmptyState({ title, body, action }: { title: string; body?: string; action?: React.ReactNode }) {
  return (
    <div className="flex flex-col items-center gap-2.5 px-6 py-12 text-center">
      <Sparkle size={48} color="#E4FF1A" />
      <span className="text-[16px] font-semibold">{title}</span>
      {body && <span className="max-w-md text-[14px] text-teal-grey">{body}</span>}
      {action}
    </div>
  );
}

export function CopyButton({ value, label = "Copy", copiedLabel = "Copied", className }: { value: string; label?: string; copiedLabel?: string; className: string }) {
  const [copied, setCopied] = useState(false);
  const t = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => { if (t.current) clearTimeout(t.current); }, []);
  return (
    <button
      type="button"
      className={className}
      onClick={() => {
        navigator.clipboard?.writeText(value).catch(() => {});
        setCopied(true);
        if (t.current) clearTimeout(t.current);
        t.current = setTimeout(() => setCopied(false), 1600);
      }}
    >
      <Icon name="copy" size={15} />
      <span aria-live="polite">{copied ? copiedLabel : label}</span>
    </button>
  );
}

/** "9920417362" -> "9920 417 362" as on the design. */
export const fmtAccount = (n: string) => (n.length === 10 ? `${n.slice(0, 4)} ${n.slice(4, 7)} ${n.slice(7)}` : n);

/** Calls fn now and then every `ms` while `active` is true. fn should be stable (useCallback). */
export function usePoll(fn: () => void, ms: number, active = true) {
  useEffect(() => {
    if (!active) return;
    fn();
    const id = setInterval(fn, ms);
    return () => clearInterval(id);
  }, [fn, ms, active]);
}

/** Recent-transfers table used by the dashboard and the transfers list. */
export function TransfersTable({ items, loading, rows = 5 }: { items: SmeTransfer[] | null; loading?: boolean; rows?: number }) {
  const th = "px-4 py-3 text-[13px] font-medium";
  const td = "border-b border-line-soft px-4 py-4";
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[860px] border-collapse text-[14px]">
        <thead>
          <tr className="bg-ground text-left text-teal-grey">
            <th scope="col" className={`${th} pl-7`}>Date</th>
            <th scope="col" className={th}>Beneficiary</th>
            <th scope="col" className={th}>Reference</th>
            <th scope="col" className={`${th} text-right`}>They receive</th>
            <th scope="col" className={`${th} text-right`}>You pay</th>
            <th scope="col" className={`${th} pr-7`}>Status</th>
          </tr>
        </thead>
        <tbody>
          {loading && !items
            ? Array.from({ length: rows }).map((_, i) => (
                <tr key={i}>
                  {Array.from({ length: 6 }).map((__, j) => (
                    <td key={j} className={`${td} ${j === 0 ? "pl-7" : ""}`}><Skeleton className="h-4 w-full max-w-[140px]" /></td>
                  ))}
                </tr>
              ))
            : items?.map((t) => (
                <tr key={t.id} className="hover:bg-ground/60">
                  <td className={`${td} whitespace-nowrap pl-7 text-teal-grey`}>{fmtTime(t.created_at)}</td>
                  <td className={td}>
                    <Link href={`/app/transfers/${t.id}`} className="font-medium text-teal no-underline hover:underline">{t.beneficiary.name}</Link>
                    <div className="text-[13px] text-teal-grey">{countryName(t.beneficiary.country)}</div>
                  </td>
                  <td className={`${td} font-mono text-[13px]`}>{t.reference}</td>
                  <td className={`${td} whitespace-nowrap text-right font-semibold`}>{money("USD", t.usd_amount)}</td>
                  <td className={`${td} whitespace-nowrap text-right text-teal-grey`}>{money("NGN", t.ngn_debited)}</td>
                  <td className={`${td} pr-7`}><StatusChip status={t.status} /></td>
                </tr>
              ))}
        </tbody>
      </table>
    </div>
  );
}

export function PageHeader({ title, sub, action }: { title: string; sub?: React.ReactNode; action?: React.ReactNode }) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-4">
      <div className="flex flex-col gap-1">
        <h1 className="m-0 text-[26px] font-medium tracking-[-0.01em] sm:text-[30px]">{title}</h1>
        {sub && <p className="m-0 text-[14px] text-teal-grey">{sub}</p>}
      </div>
      {action}
    </div>
  );
}

/** Teal pill link/button styling (primary action). */
export const primaryPill =
  "inline-flex h-12 cursor-pointer items-center justify-center gap-2.5 rounded-full bg-teal px-6 text-[15px] font-semibold text-lime no-underline transition hover:bg-teal-console disabled:cursor-not-allowed disabled:opacity-50";
export const outlinePill =
  "inline-flex h-[46px] cursor-pointer items-center justify-center gap-2 rounded-full border-[1.5px] border-teal bg-white px-5 text-[14px] font-medium text-teal no-underline transition hover:bg-ground disabled:cursor-not-allowed disabled:opacity-50";

/** Rate "1580.00" -> "1,580.00" (rates are 2dp strings on the wire). */
export function fmtRate(rate: string): string {
  const minor = parseMajorToMinor(rate);
  return minor ? fmtMinor(minor) : rate;
}
