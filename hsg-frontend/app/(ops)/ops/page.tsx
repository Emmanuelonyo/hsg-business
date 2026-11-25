"use client";
/**
 * O1 Overview. No mockup: stat cards + tables in the console language.
 * Counts by internal state today, p95 settlement time, total reversed, treasury on-chain vs ledger 1100.
 */
import Link from "next/link";
import { fmtTime, money } from "@/lib/money";
import { ALL_STATES, Card, Empty, ErrorBox, Loading, PageHeader, StateChip, T, fmtDuration, useApi } from "@/components/ops/ui";
import type { OpsOverview, OpsTransferRow } from "@/components/ops/types";

export default function OverviewPage() {
  const ov = useApi<OpsOverview>("/ops/overview", 5000);
  const recent = useApi<{ items: OpsTransferRow[] }>("/ops/transfers?limit=8", 5000);
  const d = ov.data;
  const variance = d ? BigInt(d.treasury.variance_cents || "0") : null;
  const counts = d?.counts_today ?? {};
  const totalToday = Object.values(counts).reduce((a: number, b) => a + (b ?? 0), 0);

  return (
    <>
      <PageHeader title="Overview" subtitle="Today on the gateway. Refreshes every 5 seconds." />

      {ov.loading && !d && <Card><Loading label="Loading overview…" /></Card>}
      {ov.error && !d && <Card><ErrorBox message={ov.error} onRetry={ov.reload} /></Card>}

      {d && (
        <>
          <div className="grid gap-4 grid-cols-1 sm:grid-cols-2 lg:grid-cols-4">
            <div className="bg-lime rounded-[22px] p-[22px] flex flex-col gap-2 relative overflow-hidden">
              <svg width="110" height="110" viewBox="0 0 120 120" aria-hidden="true" className="absolute -right-6 -bottom-6"><path d="M12 120 A108 108 0 0 1 120 12" fill="none" stroke="#F1FF99" strokeWidth={24} /></svg>
              <span className="text-[12px] font-semibold uppercase tracking-[0.08em] relative">Completed today</span>
              <span className="text-[34px] font-medium leading-none tabular-nums relative">{d.completed_today}</span>
              <span className="text-[12px] relative">of {totalToday} created today</span>
            </div>
            <div className="bg-teal text-white rounded-[22px] p-[22px] flex flex-col gap-2">
              <span className="text-[12px] font-semibold uppercase tracking-[0.08em] text-lime">p95 settlement</span>
              <span className="text-[34px] font-medium leading-none tabular-nums">{fmtDuration(d.p95_settlement_seconds)}</span>
              <span className="text-[12px] text-teal-mist">created → completed, target ≤ 15 min</span>
            </div>
            <div className="bg-white rounded-[22px] p-[22px] flex flex-col gap-2">
              <span className="text-[12px] font-semibold uppercase tracking-[0.08em] text-teal-grey">Total reversed</span>
              <span className="text-[22px] font-medium tabular-nums">{money("NGN", d.total_reversed_ngn)}</span>
              <span className="text-[12px] text-teal-grey">{counts.REVERSED ?? 0} transfer{counts.REVERSED === 1 ? "" : "s"} reversed today</span>
            </div>
            <div className={`rounded-[22px] p-[22px] flex flex-col gap-2 ${variance === 0n ? "bg-white" : "bg-critical-bg border border-critical-line"}`}>
              <span className="text-[12px] font-semibold uppercase tracking-[0.08em] text-teal-grey">Treasury variance</span>
              <span className={`text-[22px] font-medium tabular-nums ${variance === 0n ? "" : "text-critical"}`}>{money("USD", d.treasury.variance_cents)}</span>
              <span className="text-[12px] text-teal-grey">on-chain minus ledger 1100</span>
            </div>
          </div>

          <div className="flex flex-wrap gap-4 items-stretch">
            <Card title="Transfers by state today" className="flex-[2_1_520px]">
              <div className="px-[22px] pb-[22px] grid gap-2.5 grid-cols-2 sm:grid-cols-3 lg:grid-cols-4">
                {ALL_STATES.map((s) => (
                  <Link key={s} href={`/ops/transfers?state=${s}`} className="rounded-2xl bg-ground px-3.5 py-3 flex flex-col gap-2 hover:bg-line-soft">
                    <StateChip state={s} />
                    <span className={`text-[24px] font-medium tabular-nums ${(counts[s] ?? 0) === 0 ? "text-teal-grey" : ""}`}>{counts[s] ?? 0}</span>
                  </Link>
                ))}
              </div>
            </Card>

            <Card title="Treasury · account 1100" className="flex-[1_1_300px]">
              <div className="px-[22px] pb-[22px] flex flex-col gap-2.5">
                <div className="flex justify-between text-[13px]"><span className="text-teal-grey">Ledger 1100</span><span className="font-semibold tabular-nums">{money("USD", d.treasury.ledger_1100_cents)}</span></div>
                <div className="flex justify-between text-[13px]"><span className="text-teal-grey">On-chain, treasury wallets</span><span className="font-semibold tabular-nums">{money("USD", d.treasury.onchain_cents)}</span></div>
                <div className={`flex justify-between text-[13px] px-3 py-2 -mx-3 rounded-xl ${variance === 0n ? "bg-lime" : "bg-critical-bg text-critical"}`}>
                  <span>Variance</span><span className="font-semibold tabular-nums">{money("USD", d.treasury.variance_cents)}</span>
                </div>
                <Link href="/ops/ledger" className="mt-2 text-[13px] font-semibold">Run reconciliation on the ledger page →</Link>
              </div>
            </Card>
          </div>
        </>
      )}

      <Card title="Latest transfers" aside={<Link href="/ops/transfers" className="font-semibold text-teal">All transfers →</Link>}>
        {recent.loading && !recent.data && <Loading />}
        {recent.error && !recent.data && <ErrorBox message={recent.error} onRetry={recent.reload} />}
        {recent.data && recent.data.items.length === 0 && <Empty title="No transfers yet" />}
        {recent.data && recent.data.items.length > 0 && (
          <div className="overflow-x-auto">
            <table className={`${T.table} min-w-[760px]`}>
              <thead><tr className={T.headRow}><th scope="col" className={T.th}>Reference</th><th scope="col" className={T.th}>State</th><th scope="col" className={T.th}>SME</th><th scope="col" className={T.thR}>Amount</th><th scope="col" className={T.th}>Created</th></tr></thead>
              <tbody>
                {recent.data.items.map((t) => (
                  <tr key={t.id} className="hover:bg-ground">
                    <td className={`${T.td} font-mono`}><Link href={`/ops/transfers/${t.id}`} className="hover:underline">{t.reference}</Link></td>
                    <td className={T.td}><StateChip state={t.state} /></td>
                    <td className={T.td}>{t.sme?.legal_name}</td>
                    <td className={T.tdR}>{money("USD", t.usd_amount)}</td>
                    <td className={`${T.td} text-teal-grey`}>{fmtTime(t.created_at)}</td>
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
