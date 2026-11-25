"use client";
/**
 * O2 Transfers list. No mockup: same language as the other console screens (white card, ground header row,
 * mono references, internal state chips). Filter by state, search by reference, auto-refresh every 3 s.
 */
import Link from "next/link";
import { useEffect, useState } from "react";
import { fmtTime, money } from "@/lib/money";
import { ALL_STATES, Card, Empty, ErrorBox, Loading, PageHeader, StateChip, T, fmtDuration, useApi } from "@/components/ops/ui";
import type { OpsTransferRow } from "@/components/ops/types";

export default function TransfersPage() {
  const [state, setState] = useState("");
  const [search, setSearch] = useState("");
  const [q, setQ] = useState("");

  // Allow deep links from the overview tiles: /ops/transfers?state=HELD
  useEffect(() => {
    const s = new URLSearchParams(window.location.search).get("state");
    if (s) setState(s);
  }, []);

  // Debounce the reference search so typing does not fire a request per key.
  useEffect(() => {
    const t = setTimeout(() => setQ(search.trim()), 300);
    return () => clearTimeout(t);
  }, [search]);

  const params = new URLSearchParams({ limit: "100" });
  if (state) params.set("state", state);
  if (q) params.set("q", q);
  const list = useApi<{ items: OpsTransferRow[] }>(`/ops/transfers?${params.toString()}`, 3000);
  const items = list.data?.items ?? [];

  return (
    <>
      <PageHeader
        title="Transfers"
        subtitle="Every transfer with its internal saga state. Refreshes every 3 seconds."
        right={<span className="text-[13px] text-teal-grey">{list.data ? `${items.length} shown` : ""}</span>}
      />

      <div className="flex flex-wrap gap-3 items-center">
        <label className="sr-only" htmlFor="tx-search">Search by reference</label>
        <input id="tx-search" type="search" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search reference, e.g. HSG-20261123-000142"
          className="h-11 flex-[1_1_320px] max-w-[420px] rounded-full border-[1.5px] border-input bg-white px-4 text-[14px] font-mono" />
        <label className="sr-only" htmlFor="tx-state">Filter by state</label>
        <select id="tx-state" value={state} onChange={(e) => setState(e.target.value)}
          className="h-11 rounded-full border-[1.5px] border-input bg-white px-4 text-[14px]">
          <option value="">All states</option>
          {ALL_STATES.map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
        {(state || search) && (
          <button type="button" onClick={() => { setState(""); setSearch(""); }} className="h-11 px-4 rounded-full text-[13px] font-medium text-teal-grey hover:text-teal cursor-pointer">Clear</button>
        )}
      </div>

      <Card>
        {list.loading && !list.data && <Loading label="Loading transfers…" />}
        {list.error && <ErrorBox message={list.error} onRetry={list.reload} />}
        {list.data && items.length === 0 && (
          <Empty title={state || q ? "No transfers match" : "No transfers yet"} body={state || q ? "Change the filter or search." : "Transfers appear here as soon as an SME confirms a payment."} />
        )}
        {items.length > 0 && (
          <div className="overflow-x-auto">
            <table className={`${T.table} min-w-[1040px]`}>
              <thead>
                <tr className={T.headRow}>
                  <th scope="col" className={T.th}>Reference</th>
                  <th scope="col" className={T.th}>State</th>
                  <th scope="col" className={T.th}>SME</th>
                  <th scope="col" className={T.th}>Beneficiary</th>
                  <th scope="col" className={T.thR}>Amount</th>
                  <th scope="col" className={T.thR}>NGN debited</th>
                  <th scope="col" className={T.th}>Provider</th>
                  <th scope="col" className={T.th}>Step</th>
                  <th scope="col" className={T.th}>Created</th>
                  <th scope="col" className={T.thR}>Settled in</th>
                </tr>
              </thead>
              <tbody>
                {items.map((t) => (
                  <tr key={t.id} className="hover:bg-ground">
                    <td className={`${T.td} font-mono`}><Link href={`/ops/transfers/${t.id}`} className="font-medium underline-offset-2 hover:underline">{t.reference}</Link></td>
                    <td className={T.td}><StateChip state={t.state} /></td>
                    <td className={T.td}>{t.sme?.legal_name ?? "—"}</td>
                    <td className={T.td}>{t.beneficiary_name}</td>
                    <td className={`${T.tdR} font-medium`}>{money("USD", t.usd_amount)}</td>
                    <td className={T.tdR}>{money("NGN", t.total_ngn)}</td>
                    <td className={T.td}>{t.provider_name ?? <span className="text-teal-grey">—</span>}</td>
                    <td className={`${T.td} font-mono text-[12px] text-teal-grey`}>{t.current_step ?? "—"}</td>
                    <td className={`${T.td} text-teal-grey whitespace-nowrap`}>{fmtTime(t.created_at)}</td>
                    <td className={T.tdR}>{fmtDuration(t.settlement_seconds)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </>
  );
}
