"use client";
/**
 * O4 Ledger (docs/design/project/Ops-Ledger.dc.html).
 * Trial balance, hash-chain verification (TC11), reconciliation of account 1100 against the
 * treasury wallets on chain (TC07, TC13). Below: tabs for Treasury wallets (live on-chain), Balances, and a paginated, searchable Journal.
 */
import { Fragment, useEffect, useState } from "react";
import { api } from "@/lib/api";
import { fmtMinor, fmtTime, money } from "@/lib/money";
import { Card, CopyText, Empty, ErrorBox, Loading, PageHeader, PillTabs, T, errMsg, shortHash, useApi } from "@/components/ops/ui";
import type { EntriesPage, JournalEntry, JournalLine, LedgerAccount, LedgerView, ReconcileResult, TreasuryView, VerifyResult } from "@/components/ops/types";

type Tab = "treasury" | "balances" | "journal";
const TABS: Tab[] = ["treasury", "balances", "journal"];

const isDebit = (l: JournalLine) => /^D/i.test(l.side);

/** Total of the debit lines per currency: "NGN 1,587,500.00" (an entry balances per currency). */
function entryAmount(e: JournalEntry): string {
  const by: Record<string, bigint> = {};
  for (const l of e.lines ?? []) if (isDebit(l)) by[l.currency] = (by[l.currency] ?? 0n) + BigInt(l.amount);
  const parts = Object.entries(by).map(([c, v]) => `${c} ${fmtMinor(v)}`);
  return parts.length ? parts.join(" · ") : "—";
}

export default function LedgerPage() {
  const ledger = useApi<LedgerView>("/ops/ledger", 10_000);
  const [verify, setVerify] = useState<VerifyResult | null>(null);
  const [verifyAt, setVerifyAt] = useState<string | null>(null);
  const [verifying, setVerifying] = useState(false);
  const [verifyErr, setVerifyErr] = useState<string | null>(null);
  const [recon, setRecon] = useState<ReconcileResult | null>(null);
  const [reconciling, setReconciling] = useState(false);
  const [reconErr, setReconErr] = useState<string | null>(null);
  // Active tab lives in the URL hash (#journal) so a refresh or a shared link keeps it.
  const [tab, setTab] = useState<Tab>("treasury");
  useEffect(() => {
    const h = window.location.hash.slice(1) as Tab;
    if (TABS.includes(h)) setTab(h);
  }, []);
  function selectTab(t: Tab) {
    setTab(t);
    history.replaceState(null, "", `#${t}`);
  }

  const d = ledger.data;
  const count = d ? Number(d.entry_count) : null;
  const brokenAt = verify && !verify.ok ? verify.broken_at : null;

  async function runVerify() {
    setVerifying(true);
    setVerifyErr(null);
    try {
      const v = await api<VerifyResult>("/ops/ledger/verify", { method: "POST" });
      setVerify(v);
      setVerifyAt(new Date().toISOString());
      if (!v.ok) selectTab("journal"); // jump to the journal so the broken entry is one click away
    } catch (e) {
      setVerifyErr(errMsg(e));
    } finally {
      setVerifying(false);
    }
  }

  async function runReconcile() {
    setReconciling(true);
    setReconErr(null);
    try {
      setRecon(await api<ReconcileResult>("/ops/reconcile", { method: "POST" }));
    } catch (e) {
      setReconErr(errMsg(e));
    } finally {
      setReconciling(false);
    }
  }

  // Totals row per currency for the account balances table.
  const totals = { NGN: { dr: 0n, cr: 0n }, USD: { dr: 0n, cr: 0n } } as Record<string, { dr: bigint; cr: bigint }>;
  for (const a of d?.accounts ?? []) {
    const t = (totals[a.currency] ??= { dr: 0n, cr: 0n });
    t.dr += BigInt(a.debit || "0");
    t.cr += BigInt(a.credit || "0");
  }
  const ledger1100 = d?.accounts.find((a) => a.code === "1100");
  const variance = recon ? BigInt(recon.variance_cents) : null;

  return (
    <>
      <PageHeader title="Ledger" subtitle="Double-entry, append-only, hash-chained. Every figure below is computed from journal lines, never stored." />

      {ledger.loading && !d && <Card><Loading label="Loading ledger…" /></Card>}
      {ledger.error && !d && <Card><ErrorBox message={ledger.error} onRetry={ledger.reload} /></Card>}

      {d && (
        <>
          <div className="grid gap-4 grid-cols-1 lg:grid-cols-3">
            {/* Trial balance */}
            <div className={`rounded-[22px] p-[22px] flex flex-col gap-3 relative overflow-hidden ${d.trial_balance.ok ? "bg-lime" : "bg-critical-bg border border-critical-line text-critical"}`}>
              <svg width="120" height="120" viewBox="0 0 120 120" aria-hidden="true" className="absolute -right-6 -bottom-6"><path d="M12 120 A108 108 0 0 1 120 12" fill="none" stroke={d.trial_balance.ok ? "#F1FF99" : "#FECDCA"} strokeWidth={24} /></svg>
              <div className="flex justify-between items-center relative">
                <span className="text-[12px] font-semibold uppercase tracking-[0.08em]">Trial balance</span>
                <span className="text-[12px] font-semibold">{d.trial_balance.ok ? "Balanced" : "OUT OF BALANCE"}</span>
              </div>
              <div className="flex justify-between items-baseline relative"><span className="text-[14px]">NGN</span><span className="text-[26px] font-medium tabular-nums">{fmtMinor(d.trial_balance.NGN)}</span></div>
              <div className="flex justify-between items-baseline relative"><span className="text-[14px]">USD</span><span className="text-[26px] font-medium tabular-nums">{fmtMinor(d.trial_balance.USD)}</span></div>
              <span className="text-[12px] relative">Debits minus credits, per currency</span>
            </div>

            {/* Hash chain */}
            <div className="bg-teal text-white rounded-[22px] p-[22px] flex flex-col gap-2.5">
              <span className="text-[12px] font-semibold text-lime uppercase tracking-[0.08em]">Hash chain</span>
              <span className={`text-[22px] font-medium ${brokenAt ? "text-[#FDA29B]" : "text-white"}`}>
                {!verify ? "Not verified yet" : verify.ok ? `${Number(verify.checked).toLocaleString("en-US")} entries verified` : `Broken at seq ${verify.broken_at}`}
              </span>
              <span className="text-[13px] text-teal-mist min-h-10">
                {!verify && `${count?.toLocaleString("en-US") ?? "—"} entries in the journal. Verify recomputes every entry_hash from prev_hash and its lines.`}
                {verify?.ok && `Every entry_hash recomputed from prev_hash and its lines. Last run ${fmtTime(verifyAt)}.`}
                {brokenAt && `Recomputed hash of entry ${brokenAt} does not match the stored value. Every later entry is suspect. Checked ${verify?.checked} entries at ${fmtTime(verifyAt)}.`}
              </span>
              {verifyErr && <span role="alert" className="text-[13px] text-[#FDA29B]">{verifyErr}</span>}
              <button type="button" onClick={runVerify} disabled={verifying}
                className="mt-auto h-[42px] border-0 rounded-full bg-lime text-teal text-[14px] font-semibold cursor-pointer disabled:opacity-60">
                {verifying ? `Verifying ${count?.toLocaleString("en-US") ?? ""} entries…` : "Verify chain"}
              </button>
            </div>

            {/* Reconciliation */}
            <div className="bg-white rounded-[22px] p-[22px] flex flex-col gap-2.5">
              <span className="text-[12px] font-semibold text-teal-grey uppercase tracking-[0.08em]">Reconciliation · account 1100</span>
              <div className="flex justify-between text-[13px]"><span className="text-teal-grey">Ledger</span><span className="font-semibold tabular-nums">{recon ? money("USD", recon.ledger_1100_cents) : ledger1100 ? money("USD", ledger1100.net) : "—"}</span></div>
              <div className="flex justify-between text-[13px]"><span className="text-teal-grey">On-chain{recon ? `, ${recon.wallets.length} treasury wallets` : ""}</span><span className="font-semibold tabular-nums">{recon ? money("USD", recon.onchain_cents) : "Not run"}</span></div>
              <div className={`flex justify-between text-[13px] px-3 py-2 -mx-3 rounded-xl ${variance === null ? "bg-ground text-teal-grey" : variance === 0n ? "bg-lime text-teal" : "bg-critical-bg text-critical"}`}>
                <span>Variance</span><span className="font-semibold tabular-nums">{recon ? money("USD", recon.variance_cents) : "—"}</span>
              </div>
              {recon && <span className="text-[12px] text-teal-grey">Checked {fmtTime(recon.checked_at)}</span>}
              {reconErr && <span role="alert" className="text-[13px] text-critical">{reconErr}</span>}
              <button type="button" onClick={runReconcile} disabled={reconciling}
                className="mt-auto h-[42px] border-[1.5px] border-teal rounded-full bg-white text-teal text-[14px] font-semibold cursor-pointer disabled:opacity-60">
                {reconciling ? "Reconciling…" : "Run reconciliation"}
              </button>
            </div>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-3">
            <PillTabs label="Ledger views" value={tab} onChange={selectTab} tabs={[
              { key: "treasury", label: "Treasury wallets" },
              { key: "balances", label: "Balances" },
              { key: "journal", label: <>Journal entries <span className="ml-1 opacity-70 tabular-nums">{count?.toLocaleString("en-US") ?? ""}</span></> },
            ]} />
          </div>

          {tab === "treasury" && <TreasuryTab />}
          {tab === "balances" && <BalancesTab accounts={d.accounts} totals={totals} />}
          {tab === "journal" && <JournalTab latestSeq={count} brokenAt={brokenAt} />}
        </>
      )}
    </>
  );
}

/* ------------------------------------------------------------------ Treasury wallets */

function TreasuryTab() {
  const t = useApi<TreasuryView>("/ops/treasury", 15_000);
  const d = t.data;
  if (t.loading && !d) return <Card><Loading label="Reading wallet balances from the chain…" /></Card>;
  if (t.error && !d) return <Card><ErrorBox message={t.error} onRetry={t.reload} /></Card>;
  if (!d) return null;
  const variance = d.variance_cents === null ? null : BigInt(d.variance_cents);
  const treasury = d.wallets.filter((w) => w.kind === "TREASURY");
  const providers = d.wallets.filter((w) => w.kind === "PROVIDER");
  return (
    <Card title="Treasury wallets" aside={<span className="flex items-center gap-3">Live on-chain read · {fmtTime(d.read_at)}
      <button type="button" onClick={t.reload} className="h-8 px-3 rounded-full border border-teal text-teal text-[12px] font-semibold cursor-pointer hover:bg-ground">Refresh</button></span>}>
      {d.chain_error && <div role="alert" className="mx-[22px] mb-3 px-4 py-2.5 rounded-xl bg-critical-bg border border-critical-line text-critical text-[13px]">Chain unreachable: {d.chain_error}</div>}
      <div className="overflow-x-auto">
        <table className={`${T.table} min-w-[820px]`}>
          <thead>
            <tr className={T.headRow}>
              <th scope="col" className={T.th}>Wallet</th><th scope="col" className={T.th}>Role</th><th scope="col" className={T.th}>Address</th>
              <th scope="col" className={T.thR}>Sent</th><th scope="col" className={T.thR}>Received</th><th scope="col" className={T.thR}>Balance</th>
            </tr>
          </thead>
          <tbody>
            {[...treasury, ...providers].map((w) => (
              <tr key={w.address}>
                <td className={`${T.td} font-semibold`}>{w.label}</td>
                <td className={T.td}>
                  <span className={`inline-flex items-center h-6 px-2.5 rounded-full text-[12px] font-medium ${w.kind === "TREASURY" ? "bg-teal text-lime" : "bg-pending text-teal"}`}>
                    {w.kind === "TREASURY" ? "Treasury · 1100" : `Provider${w.provider_name ? ` · ${w.provider_name}` : ""}`}
                  </span>
                </td>
                <td className={`${T.td} font-mono text-teal-grey`}><CopyText value={w.address} display={shortHash(w.address, 6)} /></td>
                <td className={T.tdR}>{w.tx_sent}</td>
                <td className={T.tdR}>{w.tx_received}</td>
                <td className={`${T.tdR} font-medium`}>{w.balance_cents === null ? "—" : money("USD", w.balance_cents)}</td>
              </tr>
            ))}
            <tr className="bg-teal text-white">
              <td colSpan={5} className="px-[22px] py-3 font-semibold">Treasury total on chain</td>
              <td className="px-3 pr-[22px] py-3 text-right font-semibold text-lime tabular-nums">{money("USD", d.treasury_onchain_cents)}</td>
            </tr>
            <tr className="bg-teal text-white">
              <td colSpan={5} className="px-[22px] py-3 font-semibold">Ledger account 1100 · Stablecoin reserve</td>
              <td className="px-3 pr-[22px] py-3 text-right font-semibold text-lime tabular-nums">{money("USD", d.ledger_1100_cents)}</td>
            </tr>
            <tr className={variance === null ? "bg-ground" : variance === 0n ? "bg-lime text-teal" : "bg-critical-bg text-critical"}>
              <td colSpan={5} className="px-[22px] py-3 font-semibold">Variance (on chain − ledger)</td>
              <td className="px-3 pr-[22px] py-3 text-right font-semibold tabular-nums">{d.variance_cents === null ? "—" : money("USD", d.variance_cents)}</td>
            </tr>
          </tbody>
        </table>
      </div>
      {d.token && <p className="px-[22px] pt-3 text-[12px] text-teal-grey">Token contract <span className="font-mono">{d.token}</span>. Provider wallets are not part of account 1100; they hold tokens between the on-chain leg and the payout, and return them on a reversal.</p>}
    </Card>
  );
}

/* ------------------------------------------------------------------ Balances */

function BalancesTab({ accounts, totals }: { accounts: LedgerAccount[]; totals: Record<string, { dr: bigint; cr: bigint }> }) {
  return (
    <Card title="Account balances" aside="SME accounts 2000 and 2100 shown as totals across all SMEs">
      {accounts.length === 0 ? <Empty title="No postings yet" body="Run the seed or a NIP inflow to create the first entries." /> : (
        <div className="overflow-x-auto">
          <table className={`${T.table} min-w-[760px]`}>
            <thead>
              <tr className={T.headRow}>
                <th scope="col" className={T.th}>Code</th><th scope="col" className={T.th}>Account</th><th scope="col" className={T.th}>Type</th><th scope="col" className={T.th}>Ccy</th>
                <th scope="col" className={T.thR}>Debit</th><th scope="col" className={T.thR}>Credit</th><th scope="col" className={T.thR}>Net</th>
              </tr>
            </thead>
            <tbody>
              {accounts.map((a) => (
                <tr key={a.code + a.currency}>
                  <td className={`${T.td} font-mono font-medium`}>{a.code}</td>
                  <td className={T.td}>{a.name}</td>
                  <td className={`${T.td} text-teal-grey`}>{a.type}</td>
                  <td className={T.td}>{a.currency}</td>
                  <td className={T.tdR}>{BigInt(a.debit || "0") === 0n ? "" : fmtMinor(a.debit)}</td>
                  <td className={T.tdR}>{BigInt(a.credit || "0") === 0n ? "" : fmtMinor(a.credit)}</td>
                  <td className={`${T.tdR} font-medium`}>{fmtMinor(a.net)}</td>
                </tr>
              ))}
              {(["NGN", "USD"] as const).map((c) => (
                <tr key={c} className="bg-teal text-white">
                  <td colSpan={4} className="px-[22px] py-3 font-semibold">Totals {c}</td>
                  <td className="px-3 py-3 text-right font-semibold text-lime tabular-nums">{fmtMinor(totals[c].dr)}</td>
                  <td className="px-3 py-3 text-right font-semibold text-lime tabular-nums">{fmtMinor(totals[c].cr)}</td>
                  <td className="px-3 pr-[22px] py-3 text-right font-semibold text-lime tabular-nums">{fmtMinor(totals[c].dr - totals[c].cr)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}

/* ------------------------------------------------------------------ Journal entries (paginated) */

const PAGE_SIZES = [25, 50, 100];

function JournalTab({ latestSeq, brokenAt }: { latestSeq: number | null; brokenAt: string | null }) {
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);
  const [query, setQuery] = useState("");
  const [q, setQ] = useState("");
  const [open, setOpen] = useState<Set<string>>(new Set());

  // Debounce the reference search; a new search starts at page 1.
  useEffect(() => {
    const t = setTimeout(() => { setQ(query.trim()); setPage(1); }, 300);
    return () => clearTimeout(t);
  }, [query]);

  const path = `/ops/ledger/entries?page=${page}&page_size=${pageSize}${q ? `&q=${encodeURIComponent(q)}` : ""}`;
  // Only the first, unfiltered page auto-refreshes; older pages are stable (the journal is append-only).
  const res = useApi<EntriesPage>(path, page === 1 && !q ? 10_000 : undefined);
  const d = res.data;
  const totalPages = d?.total_pages ?? 1;

  function toggle(seq: string) {
    setOpen((s) => { const n = new Set(s); if (n.has(seq)) n.delete(seq); else n.add(seq); return n; });
  }
  // seq is gapless from 1 and the list is newest-first, so the page holding seq N is computable.
  function goToBroken() {
    if (!brokenAt || !latestSeq) return;
    setQuery(""); setQ("");
    setPage(Math.floor((latestSeq - Number(brokenAt)) / pageSize) + 1);
    setOpen(new Set([String(brokenAt)]));
  }

  return (
    <Card title="Journal entries" aside={d ? `${d.total.toLocaleString("en-US")} ${q ? "matching" : "in total"} · click a row for its lines` : undefined}>
      <div className="flex flex-wrap items-center gap-3 px-[22px] pb-4">
        <label className="flex-1 min-w-[220px]">
          <span className="sr-only">Search by reference</span>
          <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search reference: transfer id, INFLOW, RESERVE…"
            className="w-full h-10 px-4 rounded-full border-[1.5px] border-input bg-white text-[13px] focus:outline-none focus:border-teal" />
        </label>
        <label className="flex items-center gap-2 text-[13px] text-teal-grey">Rows
          <select value={pageSize} onChange={(e) => { setPageSize(Number(e.target.value)); setPage(1); }}
            className="h-10 px-3 rounded-full border-[1.5px] border-input bg-white text-teal text-[13px]">
            {PAGE_SIZES.map((n) => <option key={n} value={n}>{n}</option>)}
          </select>
        </label>
        {brokenAt && (
          <button type="button" onClick={goToBroken} className="h-10 px-4 rounded-full bg-critical text-white text-[13px] font-semibold cursor-pointer">
            Go to broken entry · seq {brokenAt}
          </button>
        )}
      </div>

      {res.loading && !d && <Loading label="Loading entries…" />}
      {res.error && !d && <ErrorBox message={res.error} onRetry={res.reload} />}
      {d && d.items.length === 0 && <Empty title={q ? "No entries match that reference" : "No journal entries yet"} />}
      {d && d.items.length > 0 && (
        <div className="overflow-x-auto">
          <table className={`${T.table} min-w-[900px]`}>
            <thead>
              <tr className={T.headRow}>
                <th scope="col" className={T.th}>Seq</th><th scope="col" className={T.th}>Time</th><th scope="col" className={T.th}>Reference</th>
                <th scope="col" className={T.thR}>Amount</th><th scope="col" className={T.th}>prev_hash</th><th scope="col" className={T.th}>entry_hash</th>
              </tr>
            </thead>
            <tbody>
              {d.items.map((e) => {
                const seq = String(e.seq);
                const bad = brokenAt !== null && seq === String(brokenAt);
                const isOpen = open.has(seq);
                return (
                  <Fragment key={seq}>
                    <tr onClick={() => toggle(seq)} className={`cursor-pointer ${bad ? "bg-critical-bg" : isOpen ? "bg-lime-soft/40" : "bg-white hover:bg-ground"}`} aria-expanded={isOpen}>
                      <td className={`${T.td} font-mono font-medium`}><span className="inline-block w-3 text-teal-grey">{isOpen ? "▾" : "▸"}</span> {seq}</td>
                      <td className={`${T.td} text-teal-grey whitespace-nowrap`}>{fmtTime(e.created_at)}</td>
                      <td className={`${T.td} font-mono`}>{e.reference}</td>
                      <td className={T.tdR}>{entryAmount(e)}</td>
                      <td className={`${T.td} font-mono text-teal-grey`} title={e.prev_hash}>{shortHash(e.prev_hash)}</td>
                      <td className={`${T.td} font-mono ${bad ? "text-critical font-semibold" : "text-teal-grey"}`} title={e.entry_hash}>{shortHash(e.entry_hash)}</td>
                    </tr>
                    {isOpen && <EntryLines entry={e} />}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {d && d.total > 0 && (
        <nav aria-label="Journal pages" className="flex flex-wrap items-center justify-between gap-3 px-[22px] pt-4">
          <span className="text-[13px] text-teal-grey tabular-nums">
            {((d.page - 1) * d.page_size + 1).toLocaleString("en-US")}–{Math.min(d.page * d.page_size, d.total).toLocaleString("en-US")} of {d.total.toLocaleString("en-US")}
          </span>
          <div className="flex items-center gap-1.5">
            <PageBtn label="First page" disabled={page <= 1} onClick={() => setPage(1)}>«</PageBtn>
            <PageBtn label="Previous page" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>‹ Newer</PageBtn>
            <span className="px-3 text-[13px] font-medium tabular-nums">Page {d.page} of {totalPages}</span>
            <PageBtn label="Next page" disabled={page >= totalPages} onClick={() => setPage((p) => p + 1)}>Older ›</PageBtn>
            <PageBtn label="Last page" disabled={page >= totalPages} onClick={() => setPage(totalPages)}>»</PageBtn>
          </div>
        </nav>
      )}
    </Card>
  );
}

function PageBtn({ label, disabled, onClick, children }: { label: string; disabled: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button type="button" aria-label={label} disabled={disabled} onClick={onClick}
      className="h-9 min-w-9 px-3 rounded-full border-[1.5px] border-teal bg-white text-teal text-[13px] font-semibold cursor-pointer hover:bg-ground disabled:opacity-35 disabled:cursor-not-allowed">
      {children}
    </button>
  );
}

/** Expanded Dr/Cr lines for one entry, indented under its row. */
function EntryLines({ entry }: { entry: JournalEntry }) {
  return (
    <tr className="bg-ground">
      <td colSpan={6} className="px-[22px] py-3 border-b border-line-soft">
        <div className="text-[12px] text-teal-grey mb-2">Event <span className="font-mono text-teal">{entry.event}</span> · entry_hash <span className="font-mono text-teal break-all">{entry.entry_hash}</span></div>
        <table className="w-full max-w-[640px] text-[13px] border-collapse">
          <thead><tr className="text-teal-grey text-left"><th className="py-1 font-medium">Account</th><th className="py-1 font-medium text-right">Debit</th><th className="py-1 font-medium text-right">Credit</th><th className="py-1 pl-3 font-medium">Ccy</th></tr></thead>
          <tbody>
            {entry.lines.map((l, i) => (
              <tr key={i}>
                <td className={`py-1 font-mono ${isDebit(l) ? "" : "pl-6"}`}>{isDebit(l) ? "Dr" : "Cr"} {l.account_code}</td>
                <td className="py-1 text-right tabular-nums">{isDebit(l) ? fmtMinor(l.amount) : ""}</td>
                <td className="py-1 text-right tabular-nums">{isDebit(l) ? "" : fmtMinor(l.amount)}</td>
                <td className="py-1 pl-3">{l.currency}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </td>
    </tr>
  );
}
