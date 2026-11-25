"use client";
/**
 * O2 Transfer detail (docs/design/project/Ops-Transfer.dc.html).
 * Header with reference, internal state, SME, amounts and timings; five evidence tabs:
 * Saga steps (TC09), Compliance checks (TC06), Journal entries (TC14), Chain transaction (TC07/TC14), Payout order (TC08).
 * Polls every 3 s until the transfer reaches a terminal state.
 */
import Link from "next/link";
import { useParams } from "next/navigation";
import { useState, type ReactNode } from "react";
import { api } from "@/lib/api";
import { fmtMinor, fmtTime, money } from "@/lib/money";
import {
  Card, CopyText, Empty, ErrorBox, JsonBlock, Loading, PillTabs, ResultTag, StateChip, T, TERMINAL_STATES,
  errMsg, fmtClock, fmtDuration, msBetween, shortHash, useApi,
} from "@/components/ops/ui";
import type { ChainTx, JournalEntry, OpsTransferDetail, PayoutOrder } from "@/components/ops/types";

type Tab = "saga" | "checks" | "journal" | "chain" | "payout";

export default function TransferDetailPage() {
  const { id } = useParams<{ id: string }>();
  const detail = useApi<OpsTransferDetail>(id ? `/ops/transfers/${id}` : null, 3000, (d) => TERMINAL_STATES.includes(d.transfer.state));
  const [tab, setTab] = useState<Tab>("saga");
  const [retrying, setRetrying] = useState(false);
  const [retryMsg, setRetryMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const d = detail.data;

  async function retry() {
    setRetrying(true);
    setRetryMsg(null);
    try {
      const r = await api<{ ok: boolean; step: string }>(`/ops/transfers/${id}/retry`, { method: "POST" });
      setRetryMsg({ ok: true, text: `Re-enqueued ${r.step} with a fresh job id.` });
      detail.reload();
    } catch (e) {
      setRetryMsg({ ok: false, text: errMsg(e) });
    } finally {
      setRetrying(false);
    }
  }

  if (detail.loading && !d) return <Card><Loading label="Loading transfer…" /></Card>;
  if (!d) return (
    <>
      <Link href="/ops/transfers" className="text-[13px] text-teal-grey">← Transfers</Link>
      <Card><ErrorBox message={detail.error ?? "Transfer not found"} onRetry={detail.reload} /></Card>
    </>
  );

  const t = d.transfer;
  const ts = t.timestamps ?? {};
  const terminal = TERMINAL_STATES.includes(t.state);
  const endAt = ts.completed_at ?? ts.reversed_at ?? ts.declined_at ?? null;
  const elapsedMs = msBetween(ts.created_at, endAt ?? (terminal ? null : new Date().toISOString()));

  const tabs: { key: Tab; label: string }[] = [
    { key: "saga", label: `Saga steps · ${d.saga_steps.length}` },
    { key: "checks", label: `Compliance checks · ${d.compliance_checks.length}` },
    { key: "journal", label: `Journal entries · ${d.journal_entries.length}` },
    { key: "chain", label: `Chain transaction · ${d.chain_transactions.length}` },
    { key: "payout", label: "Payout order" },
  ];

  return (
    <>
      {/* Header */}
      <div className="flex flex-wrap justify-between items-start gap-4">
        <div className="flex flex-col gap-1.5">
          <div className="text-[13px] text-teal-grey"><Link href="/ops/transfers" className="hover:underline">Transfers</Link> / <span className="font-mono">{t.id}</span></div>
          <div className="flex items-center gap-3 flex-wrap">
            <h1 className="m-0 font-mono text-[24px] font-medium">{t.reference}</h1>
            <StateChip state={t.state} />
            {!terminal && <span className="text-[12px] text-teal-grey">live · refreshing every 3 s</span>}
          </div>
          <div className="text-[13px] text-teal-grey">Current step <span className="font-mono text-teal">{t.current_step ?? "—"}</span> · Purpose {t.purpose || "—"}</div>
        </div>
        <div className="flex flex-col items-end gap-2">
          <button type="button" onClick={retry} disabled={retrying || terminal}
            title={terminal ? "Terminal state: nothing to retry" : "Re-enqueue the current saga step"}
            className="h-[42px] px-[18px] rounded-full border-[1.5px] border-teal bg-white text-teal text-[14px] font-medium cursor-pointer disabled:border-input disabled:text-[#7A8F95] disabled:cursor-not-allowed">
            {retrying ? "Retrying…" : "Retry current step"}
          </button>
          {retryMsg && <span role="status" className={`text-[13px] ${retryMsg.ok ? "text-teal" : "text-critical"}`}>{retryMsg.text}</span>}
        </div>
      </div>

      {t.failure_reason && (
        <div role="alert" className="px-[18px] py-3.5 rounded-2xl bg-critical-bg border border-critical-line text-critical text-[14px]">
          <span className="font-semibold">Failure reason:</span> {t.failure_reason}
        </div>
      )}
      {t.held_rule && t.state === "HELD" && (
        <div className="px-[18px] py-3.5 rounded-2xl bg-amber-bg text-amber text-[14px]">
          <span className="font-semibold">Held by rule {t.held_rule}.</span> Decide it in the <Link href="/ops/review" className="underline">review queue</Link>.
        </div>
      )}

      {/* Summary cards */}
      <div className="grid gap-3.5 grid-cols-1 sm:grid-cols-2 lg:grid-cols-4">
        <Summary label="SME" value={d.sme.legal_name} sub={<span className="font-mono">{d.sme.id} · KYB {d.sme.kyb_status}</span>} />
        <Summary label="Amount" value={money("USD", t.usd_amount)}
          sub={<>{money("NGN", t.total_ngn)} debited · rate {t.rate} · fee {money("NGN", t.fee_ngn)}</>} />
        <Summary label="Routed to"
          value={d.payout_order ? `${d.payout_order.provider.name} · ${d.payout_order.provider.adapter}` : "Not matched yet"}
          sub={<>To {d.beneficiary.name}, {d.beneficiary.bank_name} ({d.beneficiary.country}){t.treasury_wallet ? <> · from <span className="font-mono">{shortHash(t.treasury_wallet)}</span></> : null}</>} />
        <div className="bg-teal text-white rounded-[18px] px-[18px] py-4 flex flex-col gap-1">
          <span className="text-[12px] text-nav-muted">{endAt ? `Created → ${t.state.toLowerCase()}` : "Elapsed so far"}</span>
          <span className="text-[15px] font-semibold text-lime">{elapsedMs !== null ? fmtDuration(elapsedMs / 1000) : "—"}</span>
          <span className="text-[12px] text-nav-muted">{fmtClock(ts.created_at)} → {endAt ? fmtClock(endAt) : "…"}</span>
        </div>
      </div>

      {/* State timestamps */}
      <div className="flex flex-wrap gap-2">
        {Object.entries(ts).filter(([, v]) => v).sort((a, b) => String(a[1]).localeCompare(String(b[1]))).map(([k, v]) => (
          <span key={k} className="inline-flex items-center gap-2 h-7 px-3 rounded-full bg-white text-[12px]">
            <span className="font-mono text-teal-grey">{k.replace(/_at$/, "").toUpperCase()}</span>
            <span className="tabular-nums">{fmtClock(v, true)}</span>
          </span>
        ))}
      </div>

      <PillTabs label="Transfer records" tabs={tabs} value={tab} onChange={setTab} />

      <section className="bg-white rounded-[20px] overflow-hidden">
        {tab === "saga" && <SagaTab d={d} />}
        {tab === "checks" && <ChecksTab d={d} />}
        {tab === "journal" && <JournalTab entries={d.journal_entries} />}
        {tab === "chain" && <ChainTab txs={d.chain_transactions} />}
        {tab === "payout" && <PayoutTab p={d.payout_order} />}
      </section>
    </>
  );
}

function Summary({ label, value, sub }: { label: string; value: ReactNode; sub?: ReactNode }) {
  return (
    <div className="bg-white rounded-[18px] px-[18px] py-4 flex flex-col gap-1 min-w-0">
      <span className="text-[12px] text-teal-grey">{label}</span>
      <span className="text-[15px] font-semibold tabular-nums">{value}</span>
      {sub && <span className="text-[12px] text-teal-grey">{sub}</span>}
    </div>
  );
}

/* ------------------------------------------------------------------ tabs */

function SagaTab({ d }: { d: OpsTransferDetail }) {
  if (d.saga_steps.length === 0) return <Empty title="No saga steps yet" body="The first step (SCREEN) is recorded as soon as the worker picks the transfer up." />;
  return (
    <div className="overflow-x-auto">
      <table className={`${T.table} min-w-[900px]`}>
        <thead>
          <tr className={T.headRow}>
            <th scope="col" className={T.th}>#</th><th scope="col" className={T.th}>Step</th><th scope="col" className={T.th}>Attempt</th><th scope="col" className={T.th}>Status</th>
            <th scope="col" className={T.th}>Started</th><th scope="col" className={T.th}>Ended</th><th scope="col" className={T.thR}>Duration</th><th scope="col" className={T.th}>Error</th>
          </tr>
        </thead>
        <tbody>
          {d.saga_steps.map((s, i) => {
            const ms = msBetween(s.started_at, s.ended_at);
            return (
              <tr key={s.id}>
                <td className={`${T.td} text-teal-grey`}>{i + 1}</td>
                <td className={`${T.td} font-mono font-medium`}>{s.step}</td>
                <td className={`${T.td} ${s.attempt > 1 ? "font-semibold text-amber" : ""}`}>{s.attempt}</td>
                <td className={T.td}><ResultTag value={s.status} /></td>
                <td className={`${T.td} font-mono whitespace-nowrap`}>{fmtClock(s.started_at, true)}</td>
                <td className={`${T.td} font-mono whitespace-nowrap`}>{fmtClock(s.ended_at, true)}</td>
                <td className={T.tdR}>{ms === null ? "—" : ms < 1000 ? `${ms} ms` : fmtDuration(ms / 1000)}</td>
                <td className={`${T.td} ${s.error ? "text-critical" : "text-teal-grey"} max-w-[320px] break-words`}>{s.error ?? "—"}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function ChecksTab({ d }: { d: OpsTransferDetail }) {
  return (
    <>
      {d.compliance_checks.length === 0 ? <Empty title="No compliance checks yet" body="SCREEN writes one row per gate." /> : (
        <div className="overflow-x-auto">
          <table className={`${T.table} min-w-[760px]`}>
            <thead><tr className={T.headRow}><th scope="col" className={T.th}>Gate</th><th scope="col" className={T.th}>Result</th><th scope="col" className={T.th}>Time</th><th scope="col" className={T.th}>Detail</th></tr></thead>
            <tbody>
              {d.compliance_checks.map((c) => (
                <tr key={c.id}>
                  <td className={`${T.td} font-semibold`}>{c.gate}</td>
                  <td className={T.td}><ResultTag value={c.result} /></td>
                  <td className={`${T.td} text-teal-grey whitespace-nowrap`}>{fmtClock(c.created_at, true)}</td>
                  <td className={`${T.td} w-[55%]`}><JsonBlock value={c.detail} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {d.transfer.travel_rule && (
        <div className="px-5 py-4 border-t border-line-soft flex flex-col gap-2">
          <span className="text-[12px] font-semibold text-teal-grey uppercase tracking-[0.08em]">Travel Rule data</span>
          <JsonBlock value={d.transfer.travel_rule} />
        </div>
      )}
    </>
  );
}

function JournalTab({ entries }: { entries: JournalEntry[] }) {
  if (entries.length === 0) return <Empty title="No journal entries" body="Nothing has been posted for this transfer (expected for a decline before RESERVE)." />;
  return (
    <>
      <div className="overflow-x-auto">
        <table className={`${T.table} min-w-[900px]`}>
          <thead>
            <tr className={T.headRow}>
              <th scope="col" className={T.th}>Seq</th><th scope="col" className={T.th}>Reference</th><th scope="col" className={T.th}>Account</th>
              <th scope="col" className={T.thR}>Debit</th><th scope="col" className={T.thR}>Credit</th><th scope="col" className={T.th}>Ccy</th><th scope="col" className={T.th}>Hashes</th>
            </tr>
          </thead>
          <tbody>
            {entries.map((e, i) => e.lines.map((l, j) => {
              const dr = /^D/i.test(l.side);
              return (
                <tr key={`${e.seq}-${j}`} className={i % 2 === 0 ? "bg-white" : "bg-[#FBFFE6]"}>
                  <td className={`${T.td} font-mono font-medium`}>{j === 0 ? String(e.seq) : ""}</td>
                  <td className={`${T.td} font-mono`}>{j === 0 ? <>{e.reference}<div className="text-[11px] text-teal-grey">{fmtTime(e.created_at)}</div></> : ""}</td>
                  <td className={`${T.td} font-mono ${dr ? "" : "pl-8"}`}>{dr ? "Dr" : "Cr"} {l.account_code}</td>
                  <td className={T.tdR}>{dr ? fmtMinor(l.amount) : ""}</td>
                  <td className={T.tdR}>{dr ? "" : fmtMinor(l.amount)}</td>
                  <td className={T.td}>{l.currency}</td>
                  <td className={`${T.td} font-mono text-teal-grey text-[12px] whitespace-nowrap`}>
                    {j === 0 ? <><span title={e.prev_hash}>prev {shortHash(e.prev_hash)}</span><br /><span title={e.entry_hash}>hash {shortHash(e.entry_hash)}</span></> : ""}
                  </td>
                </tr>
              );
            }))}
          </tbody>
        </table>
      </div>
      <div className="px-5 py-3.5 text-[13px] text-teal-grey">{entries.length} entr{entries.length === 1 ? "y" : "ies"}, each balanced within its currency. NGN and USD sides meet in the FX position accounts 3000 and 3100.</div>
    </>
  );
}

/** Token units have 6 decimals and equal cents × 10,000. */
function tokenToUsd(units: string | null | undefined): string {
  if (!units) return "—";
  try { return money("USD", BigInt(units) / 10000n); } catch { return units; }
}

function ChainTab({ txs }: { txs: ChainTx[] }) {
  if (txs.length === 0) return <Empty title="No chain transaction" body="None is created for a transfer declined or reversed before CHAIN_SEND." />;
  return (
    <div className="flex flex-col">
      {txs.map((tx, i) => {
        const rows: [string, ReactNode][] = [
          ["Kind", <span key="k" className={`inline-flex h-[22px] items-center px-2 rounded-md text-[12px] ${tx.kind === "RETURN" ? "bg-amber-bg text-amber" : "bg-pending"}`}>{tx.kind}</span>],
          ["Status", <ResultTag key="s" value={tx.status} />],
          ["From", <span key="f" title={tx.from_address}>{shortHash(tx.from_address, 6)}</span>],
          ["To", <span key="t" title={tx.to_address}>{shortHash(tx.to_address, 6)}</span>],
          ["Amount", <span key="a">{tokenToUsd(tx.token_amount)} <span className="text-teal-grey">({tx.token_amount} units)</span></span>],
          ["Tx hash", tx.tx_hash
            ? (tx.explorer_url
              ? <a key="h" href={tx.explorer_url} target="_blank" rel="noreferrer" className="font-semibold underline" title={tx.tx_hash}>{shortHash(tx.tx_hash, 6)} ↗</a>
              : <CopyText key="h" value={tx.tx_hash} display={shortHash(tx.tx_hash, 6)} />)
            : "—"],
          ["Nonce", tx.nonce ?? "—"],
          ["Block", tx.block_number !== null && tx.block_number !== undefined ? Number(tx.block_number).toLocaleString("en-US") : "—"],
          ["Confirmations", tx.confirmations ?? "—"],
          ["Gas used", tx.gas_used !== null && tx.gas_used !== undefined ? Number(tx.gas_used).toLocaleString("en-US") : "—"],
          ["Created", fmtTime(tx.created_at)],
          ["Confirmed", fmtTime(tx.confirmed_at)],
        ];
        return (
          <div key={tx.id} className={i > 0 ? "border-t-4 border-ground" : ""}>
            <div className="px-6 pt-5 text-[14px] font-semibold">{tx.kind === "RETURN" ? "Return to treasury" : "Send to provider"}</div>
            <div className="px-6 pb-5 grid grid-cols-1 md:grid-cols-2 gap-x-8">
              {rows.map(([k, v]) => (
                <div key={k} className="flex justify-between gap-4 py-3 border-b border-line-soft text-[13px]">
                  <span className="text-teal-grey">{k}</span><span className="font-mono text-right">{v}</span>
                </div>
              ))}
            </div>
            {tx.explorer_url && <div className="px-6 pb-5"><a href={tx.explorer_url} target="_blank" rel="noreferrer" className="text-[13px] font-semibold">Open in block explorer ↗</a></div>}
          </div>
        );
      })}
    </div>
  );
}

function PayoutTab({ p }: { p: PayoutOrder | null }) {
  if (!p) return <Empty title="No payout order" body="MATCH creates one when a provider is chosen." />;
  const rows: [string, ReactNode, string][] = [
    ["provider", `${p.provider.name} · ${p.provider.adapter}`, "Partner MATCH chose by rate, capacity and reliability"],
    ["score", p.score ?? "—", "Routing score at the time of MATCH"],
    ["rate", p.rate, "NGN per USD the partner charged"],
    ["usd_amount", money("USD", p.usd_amount), "Exactly this amount arrives"],
    ["status", <ResultTag key="s" value={p.status} />, "Payout state at the partner"],
    ["external_ref", p.external_ref ?? "—", "Partner's own reference for the payout"],
    ["failure", p.failure ?? "—", "Why the partner failed the payout, if it did"],
    ["created_at", fmtTime(p.created_at), ""],
    ["paid_at", fmtTime(p.paid_at), ""],
  ];
  return (
    <div className="overflow-x-auto">
      <table className={`${T.table} min-w-[720px]`}>
        <thead><tr className={T.headRow}><th scope="col" className={T.th}>Field</th><th scope="col" className={T.th}>Value</th><th scope="col" className={T.th}>What it means here</th></tr></thead>
        <tbody>
          {rows.map(([k, v, m]) => (
            <tr key={k} className={k === "status" ? "bg-[#F7FFCC]" : k === "failure" && p.failure ? "bg-critical-bg" : ""}>
              <td className={`${T.td} font-mono font-medium`}>{k}</td>
              <td className={`${T.td} font-mono ${k === "failure" && p.failure ? "text-critical" : ""}`}>{v}</td>
              <td className={`${T.td} text-teal-grey`}>{m}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
