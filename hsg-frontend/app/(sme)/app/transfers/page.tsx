"use client";
/** S7 Transfers list: the dashboard table with a status filter and search. Newest first. */
import Link from "next/link";
import { useCallback, useMemo, useState } from "react";
import { api } from "@/lib/api";
import type { Page, SmeStatus, SmeTransfer } from "@/lib/types";
import { Icon } from "@/components/sme/motifs";
import { EmptyState, ErrorState, PageHeader, TransfersTable, friendlyError, outlinePill, primaryPill, usePoll } from "@/components/sme/ui";

const TABS: ("All" | SmeStatus)[] = ["All", "Processing", "Under review", "Completed", "Reversed", "Declined"];

export default function TransfersPage() {
  const [items, setItems] = useState<SmeTransfer[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<(typeof TABS)[number]>("All");
  const [q, setQ] = useState("");

  // We load the latest 50 once (and refresh every 10 s) and filter on the client so the
  // chip counts stay accurate. The API also supports ?status= for larger histories.
  const load = useCallback(() => {
    api<Page<SmeTransfer>>("/transfers?limit=50").then((r) => { setItems(r.items); setError(null); }).catch((e) => setError(friendlyError(e)));
  }, []);
  usePoll(load, 10000);

  const counts = useMemo(() => {
    const c: Record<string, number> = { All: items?.length ?? 0 };
    items?.forEach((t) => { c[t.status] = (c[t.status] ?? 0) + 1; });
    return c;
  }, [items]);

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return items?.filter((t) =>
      (status === "All" || t.status === status) &&
      (!needle || t.beneficiary.name.toLowerCase().includes(needle) || t.reference.toLowerCase().includes(needle)),
    ) ?? null;
  }, [items, status, q]);

  const clear = () => { setStatus("All"); setQ(""); };

  return (
    <>
      <PageHeader
        title="Transfers"
        sub="Every payment you have sent, newest first."
        action={<Link href="/app/send" className={primaryPill}><Icon name="send" size={18} />Send payment</Link>}
      />
      {error && <ErrorState message={error} onRetry={load} />}

      <div className="flex flex-wrap items-center gap-3 rounded-[22px] bg-white p-3.5">
        <div className="flex h-[46px] flex-[1_1_260px] items-center gap-2.5 rounded-full bg-ground px-4">
          <svg width="18" height="18" viewBox="0 0 20 20" aria-hidden="true"><circle cx="9" cy="9" r="5.5" fill="none" stroke="#4A6670" strokeWidth={1.7} /><path d="M13 13l4 4" fill="none" stroke="#4A6670" strokeWidth={1.7} strokeLinecap="round" /></svg>
          <label htmlFor="q" className="sr-only">Search transfers</label>
          <input id="q" type="search" placeholder="Search beneficiary or reference" value={q} onChange={(e) => setQ(e.target.value)} className="min-w-0 flex-1 border-0 bg-transparent text-[14px] text-teal outline-none" />
        </div>
        <div role="tablist" aria-label="Status" className="flex flex-wrap gap-1 rounded-[24px] bg-ground p-1">
          {TABS.map((t) => {
            const on = t === status;
            return (
              <button
                key={t}
                type="button"
                role="tab"
                aria-selected={on}
                onClick={() => setStatus(t)}
                className={`inline-flex h-[38px] cursor-pointer items-center gap-1.5 rounded-full px-3.5 text-[13px] font-semibold ${on ? "bg-teal text-lime" : "text-teal hover:bg-white"}`}
              >
                {t}
                <span className={`rounded-full px-[7px] py-px text-[11px] font-semibold ${on ? "bg-lime text-teal" : "bg-white text-teal-grey"}`}>{counts[t] ?? 0}</span>
              </button>
            );
          })}
        </div>
      </div>

      <section className="overflow-hidden rounded-3xl bg-white">
        {items && items.length === 0 ? (
          <EmptyState
            title="No transfers yet"
            body="Payments you send appear here with their status, from received to delivered."
            action={<Link href="/app/send" className={`${primaryPill} mt-2`}>Send your first payment</Link>}
          />
        ) : filtered && filtered.length === 0 ? (
          <EmptyState title="No transfers match" action={<button type="button" onClick={clear} className={`${outlinePill} mt-2 h-10`}>Clear filters</button>} />
        ) : (
          <TransfersTable items={filtered} loading={!items && !error} rows={8} />
        )}
        {filtered && filtered.length > 0 && (
          <div className="border-t border-line-soft px-6 py-4 text-[13px] text-teal-grey">
            Showing {filtered.length} of {items?.length ?? 0} recent transfers
          </div>
        )}
      </section>
    </>
  );
}
