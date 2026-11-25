"use client";
/**
 * O3 Review queue (docs/design/project/Ops-Review.dc.html).
 * Tab 1: transfers parked by a monitoring rule (TC12 velocity, threshold) with Travel Rule data; approve or reject with reason.
 * Tab 2: SMEs waiting for KYB (TC01 clean approve, TC02 watchlist match). Every decision goes to POST /ops/review/:id/decision.
 */
import Link from "next/link";
import { useState } from "react";
import { api } from "@/lib/api";
import { fmtTime, money } from "@/lib/money";
import { Card, Empty, ErrorBox, Loading, PageHeader, PillTabs, T, errMsg, useApi } from "@/components/ops/ui";
import type { DecisionResult, HeldTransfer, KybPending, ReviewQueue } from "@/components/ops/types";

type Tab = "held" | "kyb";
interface Flash { ok: boolean; text: string }

/** Turn the decision `result` (string or object) into one readable sentence, e.g. "REJECTED: name matches watchlist". */
function describeResult(result: unknown): string {
  if (result === null || result === undefined) return "";
  if (typeof result === "string") return result;
  if (typeof result === "object") {
    const r = result as Record<string, unknown>;
    const status = r.kyb_status ?? r.state ?? r.status ?? r.result ?? r.decision;
    const reason = r.reason ?? r.message ?? r.detail ?? r.failure_reason;
    const reasonText = reason && typeof reason === "object" ? JSON.stringify(reason) : reason;
    if (status || reasonText) return [status, reasonText].filter(Boolean).join(": ");
    return JSON.stringify(result);
  }
  return String(result);
}

function ageSince(iso: string | null): string {
  if (!iso) return "—";
  const mins = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60000));
  if (mins < 60) return `${mins} min`;
  return `${Math.floor(mins / 60)} h ${mins % 60} min`;
}

export default function ReviewPage() {
  const queue = useApi<ReviewQueue>("/ops/review", 5000);
  const [tab, setTab] = useState<Tab>("held");
  const [flash, setFlash] = useState<Flash | null>(null);

  async function decide(id: string, decision: "approve" | "reject", reason: string | undefined, label: string) {
    setFlash(null);
    try {
      const r = await api<DecisionResult>(`/ops/review/${id}/decision`, { method: "POST", json: { decision, reason: reason || undefined } });
      const res = describeResult(r.result);
      setFlash({ ok: true, text: `${label} ${decision === "approve" ? "approved" : "rejected"}.${res ? ` Result: ${res}` : ""}` });
      queue.reload();
      return true;
    } catch (e) {
      setFlash({ ok: false, text: `${label}: ${errMsg(e)}` });
      return false;
    }
  }

  const held = queue.data?.held_transfers ?? [];
  const kyb = queue.data?.kyb_pending ?? [];

  return (
    <>
      <PageHeader
        title="Review queue"
        subtitle="Transfers parked by a monitoring rule, and businesses waiting for KYB. Every decision is written to the audit log."
        right={<PillTabs label="Queues" value={tab} onChange={setTab} tabs={[
          { key: "held", label: `Held transfers · ${queue.data ? held.length : "…"}` },
          { key: "kyb", label: `KYB pending · ${queue.data ? kyb.length : "…"}` },
        ]} />}
      />

      {flash && (
        <div role="status" className={`px-[18px] py-3.5 rounded-2xl text-[14px] flex justify-between gap-4 ${flash.ok ? "bg-teal text-white" : "bg-critical-bg text-critical border border-critical-line"}`}>
          <span><span className={`font-semibold ${flash.ok ? "text-lime" : ""}`}>{flash.ok ? "Recorded." : "Failed."}</span> {flash.text}</span>
          <button type="button" aria-label="Dismiss" onClick={() => setFlash(null)} className="opacity-70 hover:opacity-100 cursor-pointer">×</button>
        </div>
      )}

      {queue.loading && !queue.data && <Card><Loading label="Loading queue…" /></Card>}
      {queue.error && !queue.data && <Card><ErrorBox message={queue.error} onRetry={queue.reload} /></Card>}

      {queue.data && tab === "held" && <HeldTab items={held} decide={decide} />}
      {queue.data && tab === "kyb" && <KybTab items={kyb} decide={decide} />}
    </>
  );
}

type Decide = (id: string, decision: "approve" | "reject", reason: string | undefined, label: string) => Promise<boolean>;

/* ------------------------------------------------------------------ held transfers */

function HeldTab({ items, decide }: { items: HeldTransfer[]; decide: Decide }) {
  const [selId, setSelId] = useState<string | null>(null);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [noteErr, setNoteErr] = useState<string | null>(null);
  const sel = items.find((x) => x.id === selId) ?? items[0];

  async function act(decision: "approve" | "reject") {
    if (!sel) return;
    if (decision === "reject" && !note.trim()) { setNoteErr("A reason is required to reject."); return; }
    setNoteErr(null);
    setBusy(true);
    const ok = await decide(sel.id, decision, note.trim(), sel.reference);
    setBusy(false);
    if (ok) { setNote(""); setSelId(null); }
  }

  if (items.length === 0) {
    return (
      <div className="p-7 rounded-[18px] bg-lime flex flex-col gap-1.5 items-start max-w-[420px]">
        <svg width="36" height="36" viewBox="0 0 48 48" aria-hidden="true"><g fill="#0D3542">{[0, 45, 90, 135].map((r) => <rect key={r} x="20" y="2" width="8" height="44" rx="4" transform={`rotate(${r} 24 24)`} />)}</g></svg>
        <span className="text-[16px] font-semibold">Queue clear</span>
        <span className="text-[13px]">Nothing waiting for a decision.</span>
      </div>
    );
  }

  return (
    <div className="flex flex-wrap gap-5 items-start">
      <div className="flex-[1_1_320px] flex flex-col gap-2.5">
        {items.map((it) => {
          const on = it.id === sel?.id;
          return (
            <button key={it.id} type="button" onClick={() => setSelId(it.id)} aria-pressed={on}
              className={`text-left cursor-pointer px-[18px] py-4 rounded-[18px] flex flex-col gap-1.5 border-2 ${on ? "bg-teal text-white border-teal" : "bg-white text-teal border-white hover:border-line"}`}>
              <span className="flex justify-between gap-3 w-full">
                <span className="font-mono text-[13px]">{it.reference}</span>
                <span className={`text-[12px] font-semibold px-2 py-0.5 rounded-md ${on ? "bg-lime text-teal" : "bg-amber-bg text-amber"}`}>{it.rule ?? "HOLD"}</span>
              </span>
              <span className="text-[15px] font-semibold tabular-nums">{money("USD", it.usd_amount)} → {it.beneficiary.name}</span>
              <span className="text-[13px] opacity-80">{it.sme.legal_name} · held {ageSince(it.held_at)}</span>
            </button>
          );
        })}
      </div>

      {sel && (
        <section className="flex-[1.6_1_460px] bg-white rounded-[22px] overflow-hidden">
          <div className="bg-teal text-white px-6 py-[22px] flex flex-col gap-1.5 relative overflow-hidden">
            <svg width="150" height="150" viewBox="0 0 150 150" aria-hidden="true" className="absolute -right-[30px] -bottom-[60px]"><path d="M14 150 A136 136 0 0 1 150 14" fill="none" stroke="#1E4A58" strokeWidth={28} /></svg>
            <span className="text-[12px] font-semibold text-lime uppercase tracking-[0.08em] relative">{sel.rule ?? "Held"} rule</span>
            <span className="text-[22px] font-medium relative tabular-nums">{money("USD", sel.usd_amount)} to {sel.beneficiary.name}</span>
            <span className="text-[13px] text-teal-mist relative">{sel.reason ?? "No reason recorded."}</span>
            <span className="text-[12px] text-teal-mist relative">
              <Link href={`/ops/transfers/${sel.id}`} className="underline text-teal-mist hover:text-white">{sel.reference}</Link> · held {fmtTime(sel.held_at)}
            </span>
          </div>

          <TravelRule data={sel.travel_rule} fallbackOrig={sel.sme.legal_name} fallbackBen={`${sel.beneficiary.name} (${sel.beneficiary.country})`} />

          <div className="px-6 pb-[22px] flex flex-col gap-3.5">
            <div className="flex flex-wrap gap-2">
              <span className="text-[12px] px-2.5 py-1 rounded-full bg-amber-bg text-amber font-semibold">{sel.rule ?? "Rule"} HELD</span>
            </div>
            <label htmlFor="reason" className="text-[14px] font-medium">Decision note <span className="text-teal-grey font-normal">(required to reject)</span></label>
            <textarea id="reason" rows={3} value={note} onChange={(e) => setNote(e.target.value)}
              className="border-[1.5px] border-input rounded-[14px] px-3.5 py-3 text-[14px] text-teal resize-y" />
            {noteErr && <span role="alert" className="text-[13px] text-critical">{noteErr}</span>}
            <div className="flex gap-2.5 flex-wrap">
              <button type="button" disabled={busy} onClick={() => act("approve")}
                className="grow h-[50px] border-0 rounded-full bg-teal text-lime text-[15px] font-semibold cursor-pointer disabled:opacity-50">Approve and release</button>
              <button type="button" disabled={busy} onClick={() => act("reject")}
                className="h-[50px] px-[22px] border-[1.5px] border-critical rounded-full bg-white text-critical text-[15px] font-semibold cursor-pointer disabled:opacity-50">Reject</button>
            </div>
          </div>
        </section>
      )}
    </div>
  );
}

/** Travel Rule block: originator and beneficiary side by side; falls back to raw JSON for unknown shapes. */
function TravelRule({ data, fallbackOrig, fallbackBen }: { data: Record<string, unknown> | null; fallbackOrig: string; fallbackBen: string }) {
  const orig = (data?.originator ?? null) as Record<string, unknown> | null;
  const ben = (data?.beneficiary ?? null) as Record<string, unknown> | null;
  const side = (title: string, obj: Record<string, unknown> | null, fallback: string) => (
    <div className="flex flex-col gap-2 min-w-0">
      <span className="text-[12px] font-semibold text-teal-grey uppercase tracking-[0.08em]">{title}</span>
      {obj && typeof obj === "object" ? (
        Object.entries(obj).map(([k, v], i) => (
          <span key={k} className={i === 0 ? "text-[14px] font-semibold" : `text-[13px] ${/account|iban|number/i.test(k) ? "font-mono" : "text-teal-grey"}`}>
            {i === 0 ? String(v ?? "—") : <><span className="text-teal-grey font-sans">{k.replace(/_/g, " ")}: </span>{typeof v === "object" ? JSON.stringify(v) : String(v ?? "—")}</>}
          </span>
        ))
      ) : (
        <span className="text-[14px] font-semibold">{fallback}</span>
      )}
    </div>
  );
  return (
    <div className="px-6 py-5 flex flex-col gap-3">
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-[18px]">
        {side("Originator", orig, fallbackOrig)}
        {side("Beneficiary", ben, fallbackBen)}
      </div>
      {data && !orig && !ben && <pre className="m-0 font-mono text-[12px] whitespace-pre-wrap break-all bg-ground rounded-xl px-3 py-2">{JSON.stringify(data, null, 2)}</pre>}
      {!data && <span className="text-[13px] text-critical">No Travel Rule data recorded for this transfer.</span>}
    </div>
  );
}

/* ------------------------------------------------------------------ KYB pending */

function KybTab({ items, decide }: { items: KybPending[]; decide: Decide }) {
  const [busy, setBusy] = useState<string | null>(null);
  const [rejecting, setRejecting] = useState<string | null>(null);
  const [reason, setReason] = useState("");

  async function act(s: KybPending, decision: "approve" | "reject") {
    setBusy(s.id);
    const ok = await decide(s.id, decision, decision === "reject" ? reason.trim() : undefined, s.legal_name);
    setBusy(null);
    if (ok) { setRejecting(null); setReason(""); }
  }

  return (
    <Card>
      {items.length === 0 ? <Empty title="No businesses waiting" body="Every SME has a KYB decision." /> : (
        <div className="overflow-x-auto">
          <table className={`${T.table} min-w-[820px]`}>
            <thead>
              <tr className={T.headRow}>
                <th scope="col" className={T.th}>Business</th><th scope="col" className={T.th}>RC number</th><th scope="col" className={T.th}>Address</th>
                <th scope="col" className={T.th}>Applied</th><th scope="col" className={T.th}>Action</th>
              </tr>
            </thead>
            <tbody>
              {items.map((s) => (
                <tr key={s.id}>
                  <td className={`${T.td} font-semibold`}>{s.legal_name}<div className="font-normal text-teal-grey">{s.country}</div></td>
                  <td className={`${T.td} font-mono`}>{s.rc_number ?? "—"}</td>
                  <td className={`${T.td} text-teal-grey`}>{s.address}</td>
                  <td className={`${T.td} text-teal-grey whitespace-nowrap`}>{fmtTime(s.created_at)}</td>
                  <td className={T.td}>
                    {rejecting === s.id ? (
                      <div className="flex flex-col gap-2 min-w-[240px]">
                        <input autoFocus value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Reason for rejecting"
                          className="h-9 rounded-xl border-[1.5px] border-input px-3 text-[13px]" aria-label="Rejection reason" />
                        <div className="flex gap-2">
                          <button type="button" disabled={busy === s.id || !reason.trim()} onClick={() => act(s, "reject")}
                            className="h-9 px-4 rounded-full border-[1.5px] border-critical bg-white text-critical text-[13px] font-semibold cursor-pointer disabled:opacity-40">Confirm reject</button>
                          <button type="button" onClick={() => { setRejecting(null); setReason(""); }} className="h-9 px-3 text-[13px] text-teal-grey cursor-pointer">Cancel</button>
                        </div>
                      </div>
                    ) : (
                      <div className="flex gap-2 whitespace-nowrap">
                        <button type="button" disabled={busy === s.id} onClick={() => act(s, "approve")}
                          title="Screens the legal name against the watchlist; a match rejects it"
                          className="h-9 px-4 border-0 rounded-full bg-teal text-lime text-[13px] font-semibold cursor-pointer disabled:opacity-50">{busy === s.id ? "Screening…" : "Approve"}</button>
                        <button type="button" disabled={busy === s.id} onClick={() => setRejecting(s.id)}
                          className="h-9 px-4 border-[1.5px] border-critical rounded-full bg-white text-critical text-[13px] font-semibold cursor-pointer disabled:opacity-50">Reject</button>
                      </div>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <div className="px-5 py-3.5 text-[13px] text-teal-grey">Approve screens the legal name against the watchlist: a clean name becomes VERIFIED (TC01); a match is REJECTED with a FAIL check (TC02).</div>
    </Card>
  );
}
