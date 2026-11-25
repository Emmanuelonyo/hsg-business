"use client";
/**
 * Small building blocks shared by the operator console pages.
 * Visual language follows docs/design/project/Ops-*.dc.html: white 22px cards on the ground colour,
 * ground-coloured table heads, mono for references/hashes, lime earned only by COMPLETED / PASS.
 */
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { api, ApiError } from "@/lib/api";
import type { TransferState } from "@/lib/types";

/* ------------------------------------------------------------------ helpers */

export function errMsg(e: unknown): string {
  if (e instanceof ApiError) return `${e.code}: ${e.message}`;
  if (e instanceof Error) return e.message;
  return String(e);
}

/** "0x5c2e…9a41" style: keep the first and last four characters. */
export function shortHash(h: string | null | undefined, keep = 4): string {
  if (!h) return "—";
  const s = String(h);
  const head = s.startsWith("0x") ? keep + 2 : keep;
  return s.length <= head + keep + 1 ? s : `${s.slice(0, head)}…${s.slice(-keep)}`;
}

export const TERMINAL_STATES: TransferState[] = ["COMPLETED", "REVERSED", "DECLINED"];
export const ALL_STATES: TransferState[] = [
  "CREATED", "SCREENING", "HELD", "RESERVED", "ONCHAIN_PENDING", "ONCHAIN_CONFIRMED",
  "PAYOUT_PENDING", "COMPLETED", "REVERSING", "REVERSED", "DECLINED",
];

/** "105.3" seconds -> "1 min 45 s". */
export function fmtDuration(seconds: number | null | undefined): string {
  if (seconds === null || seconds === undefined || Number.isNaN(seconds)) return "—";
  if (seconds < 60) return `${seconds.toFixed(seconds < 10 ? 1 : 0)} s`;
  const m = Math.floor(seconds / 60);
  const s = Math.round(seconds % 60);
  return `${m} min ${s} s`;
}

export function msBetween(a?: string | null, b?: string | null): number | null {
  if (!a || !b) return null;
  return new Date(b).getTime() - new Date(a).getTime();
}

/** Time only with milliseconds, for saga steps: "09:14:02.118". */
export function fmtClock(iso?: string | null, ms = false): string {
  if (!iso) return "—";
  const d = new Date(iso);
  const t = d.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
  return ms ? `${t}.${String(d.getMilliseconds()).padStart(3, "0")}` : t;
}

/* ------------------------------------------------------------------ data hook */

/**
 * GET `path` through lib/api.ts. If `intervalMs` is set it re-fetches on that interval
 * until `stopWhen(data)` returns true (e.g. the transfer reached a terminal state).
 */
export function useApi<T>(path: string | null, intervalMs?: number, stopWhen?: (d: T) => boolean) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [tick, setTick] = useState(0);
  const stopRef = useRef(stopWhen);
  stopRef.current = stopWhen;
  const reload = useCallback(() => setTick((t) => t + 1), []);

  useEffect(() => {
    if (!path) return;
    let alive = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const run = async () => {
      try {
        const d = await api<T>(path);
        if (!alive) return;
        setData(d);
        setError(null);
        if (intervalMs && !stopRef.current?.(d)) timer = setTimeout(run, intervalMs);
      } catch (e) {
        if (!alive) return;
        setError(errMsg(e));
        if (intervalMs) timer = setTimeout(run, intervalMs);
      } finally {
        if (alive) setLoading(false);
      }
    };
    run();
    return () => { alive = false; if (timer) clearTimeout(timer); };
  }, [path, intervalMs, tick]);

  return { data, error, loading, reload, setData };
}

/* ------------------------------------------------------------------ chips */

/** Internal transfer state chip: mono, 6px radius. COMPLETED lime, REVERSED/DECLINED red outline, HELD amber, rest neutral. */
export function StateChip({ state }: { state: string }) {
  let cls = "bg-pending text-teal";
  if (state === "COMPLETED") cls = "bg-lime text-teal-console";
  else if (state === "REVERSED" || state === "DECLINED") cls = "border border-critical text-critical bg-white";
  else if (state === "HELD") cls = "bg-amber-bg text-amber";
  else if (state === "REVERSING") cls = "bg-critical-bg text-critical";
  return <span className={`inline-flex items-center h-[26px] px-2.5 rounded-md font-mono text-[12px] font-medium whitespace-nowrap ${cls}`}>{state}</span>;
}

/** PASS / FAIL / HOLD, or saga step outcome (OK / DONE / FAILED / RUNNING). */
export function ResultTag({ value }: { value: string | null | undefined }) {
  const v = (value ?? "—").toUpperCase();
  let cls = "bg-pending text-teal";
  if (["PASS", "OK", "DONE", "SUCCEEDED", "SUCCESS", "COMPLETED", "CONFIRMED", "PAID", "VERIFIED"].includes(v)) cls = "bg-lime text-teal";
  else if (["FAIL", "FAILED", "ERROR", "REJECTED", "REVERTED"].includes(v)) cls = "border border-critical text-critical bg-white";
  else if (["HOLD", "HELD", "RETRY", "RETRYING", "PENDING_REVIEW"].includes(v)) cls = "bg-amber-bg text-amber";
  return <span className={`inline-flex items-center h-[22px] px-2 rounded-md font-mono text-[12px] whitespace-nowrap ${cls}`}>{v}</span>;
}

/* ------------------------------------------------------------------ layout bits */

export function PageHeader({ title, subtitle, right }: { title: ReactNode; subtitle?: ReactNode; right?: ReactNode }) {
  return (
    <div className="flex flex-wrap justify-between items-end gap-4">
      <div className="flex flex-col gap-1">
        <h1 className="m-0 text-[28px] font-medium">{title}</h1>
        {subtitle && <p className="m-0 text-[14px] text-teal-grey">{subtitle}</p>}
      </div>
      {right}
    </div>
  );
}

export function Card({ title, aside, children, className = "" }: { title?: ReactNode; aside?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={`bg-white rounded-[22px] overflow-hidden ${className}`}>
      {(title || aside) && (
        <div className="px-[22px] py-[18px] flex flex-wrap justify-between items-center gap-3">
          {title && <h2 className="m-0 text-[17px] font-semibold">{title}</h2>}
          {aside && <span className="text-[13px] text-teal-grey">{aside}</span>}
        </div>
      )}
      {children}
    </section>
  );
}

/** Table classes: header row on the ground colour, soft row rules. */
export const T = {
  table: "w-full border-collapse text-[13px]",
  headRow: "bg-ground text-teal-grey text-left",
  th: "px-3 py-[11px] font-medium first:pl-[22px] last:pr-[22px]",
  thR: "px-3 py-[11px] font-medium text-right first:pl-[22px] last:pr-[22px]",
  td: "px-3 py-[11px] border-b border-line-soft first:pl-[22px] last:pr-[22px] align-top",
  tdR: "px-3 py-[11px] border-b border-line-soft text-right tabular-nums whitespace-nowrap first:pl-[22px] last:pr-[22px] align-top",
  mono: "font-mono",
};

export function Loading({ label = "Loading…" }: { label?: string }) {
  return (
    <div className="p-6 flex items-center gap-3 text-[14px] text-teal-grey" role="status">
      <span className="w-4 h-4 rounded-full border-2 border-teal-grey border-t-transparent animate-spin" aria-hidden />
      {label}
    </div>
  );
}

export function Empty({ title, body }: { title: string; body?: string }) {
  return (
    <div className="p-6 flex flex-col gap-1">
      <span className="text-[15px] font-semibold">{title}</span>
      {body && <span className="text-[13px] text-teal-grey">{body}</span>}
    </div>
  );
}

export function ErrorBox({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div role="alert" className="m-4 px-4 py-3 rounded-2xl bg-critical-bg border border-critical-line text-critical text-[13px] flex flex-wrap items-center justify-between gap-3">
      <span>{message}</span>
      {onRetry && <button type="button" onClick={onRetry} className="h-8 px-3 rounded-full border border-critical bg-white font-medium cursor-pointer">Try again</button>}
    </div>
  );
}

/** Pill tab bar (Ops-Transfer / Ops-Review): selected = teal with lime text. */
export function PillTabs<K extends string>({ tabs, value, onChange, label }: { tabs: { key: K; label: ReactNode }[]; value: K; onChange: (k: K) => void; label: string }) {
  return (
    <div role="tablist" aria-label={label} className="flex flex-wrap gap-1.5 p-1.5 bg-white rounded-full self-start">
      {tabs.map((t) => {
        const on = t.key === value;
        return (
          <button key={t.key} type="button" role="tab" aria-selected={on} onClick={() => onChange(t.key)}
            className={`h-[38px] px-4 rounded-full text-[13px] font-semibold cursor-pointer ${on ? "bg-teal text-lime" : "bg-transparent text-teal-grey hover:text-teal"}`}>
            {t.label}
          </button>
        );
      })}
    </div>
  );
}

/** Small status banner shown after an action (teal with lime lead word, or red for errors). */
export function Toast({ kind, children, onClose }: { kind: "ok" | "error"; children: ReactNode; onClose?: () => void }) {
  const ok = kind === "ok";
  return (
    <div role="status" className={`px-[18px] py-[14px] rounded-2xl text-[14px] flex items-start justify-between gap-4 ${ok ? "bg-teal text-white" : "bg-critical-bg text-critical border border-critical-line"}`}>
      <span><span className={`font-semibold ${ok ? "text-lime" : ""}`}>{ok ? "Done." : "Failed."}</span> {children}</span>
      {onClose && <button type="button" onClick={onClose} aria-label="Dismiss" className="opacity-70 hover:opacity-100 cursor-pointer">×</button>}
    </div>
  );
}

/** Mono value with a copy button. */
export function CopyText({ value, display }: { value: string; display?: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <span className="inline-flex items-center gap-2">
      <span className="font-mono" title={value}>{display ?? value}</span>
      <button type="button" className="text-[11px] px-2 h-6 rounded-full border border-line text-teal-grey hover:text-teal cursor-pointer"
        onClick={() => { navigator.clipboard?.writeText(value).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1200); }).catch(() => {}); }}>
        {copied ? "Copied" : "Copy"}
      </button>
    </span>
  );
}

/** Pretty-print a JSON-ish value for detail cells. */
export function JsonBlock({ value }: { value: unknown }) {
  if (value === null || value === undefined) return <span className="text-teal-grey">—</span>;
  if (typeof value !== "object") return <span>{String(value)}</span>;
  return <pre className="m-0 font-mono text-[12px] leading-[18px] whitespace-pre-wrap break-all bg-ground rounded-xl px-3 py-2">{JSON.stringify(value, null, 2)}</pre>;
}
