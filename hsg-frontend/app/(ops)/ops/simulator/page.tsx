"use client";
/**
 * O5 Simulator (docs/design/project/Ops-Simulator.dc.html).
 * Stands in for the outside world: NIP inflow (TC03), payout partner capacity (TC08),
 * fault switches (TC08, TC09, TC14) and the webhook sink log (TC07).
 */
import { Fragment, useEffect, useState } from "react";
import { api } from "@/lib/api";
import { fmtMinor, fmtTime, money, parseMajorToMinor } from "@/lib/money";
import { Card, Empty, ErrorBox, JsonBlock, Loading, PageHeader, T, Toast, errMsg, shortHash, useApi } from "@/components/ops/ui";
import type { Faults, NipInflowResult, SimProvider, SimSme, WebhookEvent } from "@/components/ops/types";
import { SearchSelect } from "@/components/ops/SearchSelect";

export default function SimulatorPage() {
  const faults = useApi<Faults>("/sim/faults");
  const f = faults.data;
  const active = f ? (f.providersOutOfCapacity ? 1 : 0) + (f.payoutHardFail ? 1 : 0) + (f.chainDelaySeconds > 0 ? 1 : 0) : 0;

  return (
    <>
      <PageHeader
        title="Simulator"
        subtitle="Stands in for the bank and the liquidity providers. Each control maps to a test case."
        right={f && (
          <span className={`inline-flex items-center gap-2 h-[34px] px-3.5 rounded-full text-[13px] font-semibold ${active === 0 ? "bg-lime text-teal" : "bg-amber-bg text-amber"}`}>
            {active === 0 ? "No faults active" : `${active} fault${active === 1 ? "" : "s"} active`}
          </span>
        )}
      />

      <div className="flex flex-wrap gap-[18px] items-stretch">
        <NipInflowCard />
        <FaultSwitches state={faults} />
      </div>

      <ProvidersTable />
      <WebhookLog />

      <section className="bg-lime rounded-[22px] px-6 py-5 flex flex-wrap items-center gap-4 relative overflow-hidden">
        <svg width="44" height="44" viewBox="0 0 48 48" aria-hidden="true"><g fill="#0D3542">{[0, 45, 90, 135].map((r) => <rect key={r} x="20" y="2" width="8" height="44" rx="4" transform={`rotate(${r} 24 24)`} />)}</g></svg>
        <div className="flex-[1_1_360px] flex flex-col gap-0.5">
          <span className="text-[16px] font-semibold">Evaluation run</span>
          <span className="text-[13px] text-teal-mid">500 transfers across 100 seeded SMEs. Started from the command line, not this page, so the run is reproducible.</span>
        </div>
        <code className="font-mono text-[13px] bg-teal text-lime px-4 py-2.5 rounded-xl">k6 run load/transfers.js</code>
      </section>
    </>
  );
}

/* ------------------------------------------------------------------ NIP inflow (TC03) */

interface InflowLog { reference: string; amount: string; name: string; available: string; seq: string }

function NipInflowCard() {
  const smes = useApi<{ items: SimSme[] }>("/sim/smes");
  const [smeId, setSmeId] = useState("");
  const [amount, setAmount] = useState("5,000,000.00");
  const [sender, setSender] = useState("");
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState<{ kind: "ok" | "error"; text: string } | null>(null);
  const [log, setLog] = useState<InflowLog[]>([]);

  // Default the picker to the first verified SME (the demo account is seeded first).
  const items = smes.data?.items ?? [];
  const selected = items.find((s) => s.id === smeId) ?? items.find((s) => s.kyb_status === "VERIFIED") ?? items[0];

  async function send() {
    if (!selected) return;
    const kobo = parseMajorToMinor(amount);
    if (!kobo) { setToast({ kind: "error", text: "Enter an amount in naira, e.g. 5,000,000.00" }); return; }
    setBusy(true);
    setToast(null);
    try {
      const r = await api<NipInflowResult>("/sim/nip-inflow", {
        method: "POST",
        json: { account_number: selected.account_number, amount: kobo, sender_name: sender.trim() || selected.legal_name },
      });
      setToast({ kind: "ok", text: `Credited ${money("NGN", kobo)} to ${selected.legal_name}. New available balance ${money("NGN", r.balance.available)} (held ${money("NGN", r.balance.held)}). Journal entry #${r.entry.seq}.` });
      setLog((l) => [{ reference: r.entry.reference, amount: kobo, name: selected.legal_name, available: r.balance.available, seq: String(r.entry.seq) }, ...l].slice(0, 4));
    } catch (e) {
      setToast({ kind: "error", text: errMsg(e) });
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="flex-[1_1_340px] bg-teal text-white rounded-[22px] p-6 flex flex-col gap-3.5 relative overflow-hidden">
      <svg width="160" height="160" viewBox="0 0 160 160" aria-hidden="true" className="absolute -right-10 -top-10"><path d="M0 30 A130 130 0 0 1 130 160" fill="none" stroke="#1E4A58" strokeWidth={30} /></svg>
      <div className="flex justify-between items-center relative">
        <h2 className="m-0 text-[17px] font-semibold">NIP inflow</h2>
        <span className="text-[12px] text-lime font-mono">TC03</span>
      </div>

      {smes.loading && <span className="text-[13px] text-teal-mist">Loading accounts…</span>}
      {smes.error && <span className="text-[13px] text-[#FDA29B]">{smes.error}</span>}

      <div className="flex flex-col gap-1.5 relative">
        <label htmlFor="sim-sme" className="text-[13px] text-teal-mist">Credit virtual account</label>
        <SearchSelect
          id="sim-sme"
          value={selected?.id ?? ""}
          onChange={(v) => { setSmeId(v); setSender(""); }}
          disabled={!items.length}
          placeholder="Search by business name or account number"
          emptyText="No account matches that name or number"
          options={items.map((s) => ({
            value: s.id,
            label: `${s.account_number} · ${s.legal_name}`,
            search: `${s.kyb_status} ${s.kyb_status === "PENDING" ? "kyb pending" : ""}`,
            render: (
              <span className="flex items-center gap-2.5">
                <span className="font-mono text-[13px] text-teal-grey shrink-0">{s.account_number}</span>
                <span className="truncate">{s.legal_name}</span>
                {s.kyb_status !== "VERIFIED" && (
                  <span className="ml-auto shrink-0 inline-flex items-center h-5 px-2 rounded-full bg-amber-bg text-amber text-[11px] font-semibold">KYB {s.kyb_status.toLowerCase()}</span>
                )}
              </span>
            ),
          }))}
        />
      </div>

      <div className="flex gap-2.5 flex-wrap">
        <div className="flex-[1_1_140px] flex flex-col gap-1.5">
          <label htmlFor="sim-amt" className="text-[13px] text-teal-mist">Amount (NGN)</label>
          <input id="sim-amt" type="text" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)}
            className="h-[46px] border-0 rounded-[14px] px-3.5 text-[15px] font-medium text-right text-teal bg-white min-w-0 tabular-nums" />
        </div>
        <div className="flex-[1_1_140px] flex flex-col gap-1.5">
          <label htmlFor="sim-sender" className="text-[13px] text-teal-mist">Sender name</label>
          <input id="sim-sender" type="text" value={sender} placeholder={selected?.legal_name ?? ""} onChange={(e) => setSender(e.target.value)}
            className="h-[46px] border-0 rounded-[14px] px-3.5 text-[14px] text-teal bg-white min-w-0" />
        </div>
      </div>

      <button type="button" onClick={send} disabled={busy || !selected}
        className="h-12 border-0 rounded-full bg-lime text-teal text-[15px] font-semibold cursor-pointer disabled:opacity-60 disabled:cursor-not-allowed">
        {busy ? "Sending…" : "Send NIP inflow"}
      </button>

      {toast && (
        <div role="status" className={`rounded-xl px-3 py-2.5 text-[13px] ${toast.kind === "ok" ? "bg-lime text-teal" : "bg-critical-bg text-critical"}`}>{toast.text}</div>
      )}

      {log.length > 0 && (
        <div className="flex flex-col gap-1.5">
          {log.map((x) => (
            <div key={x.reference + x.seq} className="flex justify-between gap-2.5 text-[12px] px-3 py-2 rounded-[10px] bg-[#12404E]">
              <span className="font-mono text-teal-mist truncate" title={x.reference}>{x.reference}</span>
              <span className="whitespace-nowrap tabular-nums">NGN {fmtMinor(x.amount)}</span>
              <span className="text-lime whitespace-nowrap">CREDITED</span>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

/* ------------------------------------------------------------------ fault switches */

function Switch({ on, label, onToggle, disabled }: { on: boolean; label: string; onToggle: () => void; disabled?: boolean }) {
  return (
    <button type="button" role="switch" aria-checked={on} aria-label={label} onClick={onToggle} disabled={disabled}
      className={`w-[52px] h-[30px] shrink-0 border-0 rounded-full p-[3px] flex cursor-pointer disabled:opacity-60 ${on ? "bg-teal justify-end" : "bg-input justify-start"}`}>
      <span className={`w-6 h-6 rounded-full ${on ? "bg-lime" : "bg-white"}`} />
    </button>
  );
}

function FaultSwitches({ state }: { state: ReturnType<typeof useApi<Faults>> }) {
  const { data: f, error, loading, setData, reload } = state;
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [delayDraft, setDelayDraft] = useState<string>("");

  // Keep the delay input in sync with the server value whenever it changes.
  useEffect(() => { if (f) setDelayDraft(String(f.chainDelaySeconds)); }, [f]);

  async function put(patch: Partial<Faults>) {
    setBusy(true);
    setErr(null);
    try {
      const next = await api<Faults>("/sim/faults", { method: "PUT", json: patch });
      setData(next);
    } catch (e) {
      setErr(errMsg(e));
    } finally {
      setBusy(false);
    }
  }

  const rows: { key: "providersOutOfCapacity" | "payoutHardFail"; label: string; desc: string; tc: string }[] = [
    { key: "providersOutOfCapacity", label: "Providers out of capacity", desc: "MATCH finds no partner with capacity; the transfer reverses before the chain leg", tc: "TC08" },
    { key: "payoutHardFail", label: "Payout hard fail", desc: "PAYOUT fails after the chain leg; compensation returns tokens and naira", tc: "TC14" },
  ];
  const delayNum = Number(delayDraft);
  const delayDirty = f !== null && delayDraft !== "" && Number.isFinite(delayNum) && delayNum !== f.chainDelaySeconds;

  return (
    <section className="flex-[1.2_1_400px] bg-white rounded-[22px] p-6 flex flex-col gap-3.5">
      <div className="flex flex-wrap justify-between items-center gap-2">
        <h2 className="m-0 text-[17px] font-semibold">Fault switches</h2>
        <span className="text-[12px] text-teal-grey">Applied to the next saga step that reads them</span>
      </div>
      {loading && !f && <Loading />}
      {error && !f && <ErrorBox message={error} onRetry={reload} />}
      {f && (
        <>
          {rows.map((r) => {
            const on = f[r.key];
            return (
              <div key={r.key} className={`flex items-center gap-3.5 px-4 py-3.5 rounded-2xl ${on ? "bg-amber-bg" : "bg-ground"}`}>
                <div className="grow flex flex-col gap-0.5">
                  <span className="text-[14px] font-semibold">{r.label}</span>
                  <span className="text-[12px] text-teal-grey">{r.desc}</span>
                </div>
                <span className="text-[11px] font-mono text-teal-grey">{r.tc}</span>
                <Switch on={on} label={r.label} disabled={busy} onToggle={() => put({ [r.key]: !on })} />
              </div>
            );
          })}
          <div className={`px-4 py-3.5 rounded-2xl flex flex-col gap-2.5 ${f.chainDelaySeconds > 0 ? "bg-amber-bg" : "bg-ground"}`}>
            <div className="flex justify-between items-center gap-3">
              <label htmlFor="sim-delay" className="text-[14px] font-semibold">Chain confirmation delay</label>
              <span className="text-[14px] font-semibold tabular-nums">{f.chainDelaySeconds} s<span className="text-[11px] font-mono text-teal-grey ml-2.5">TC09</span></span>
            </div>
            <div className="flex items-center gap-3">
              <input id="sim-delay" type="range" min={0} max={180} step={10} value={Number.isFinite(delayNum) ? delayNum : 0}
                onChange={(e) => setDelayDraft(e.target.value)} className="grow accent-teal" />
              <input type="number" min={0} max={3600} value={delayDraft} aria-label="Delay in seconds"
                onChange={(e) => setDelayDraft(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter" && delayDirty) put({ chainDelaySeconds: delayNum }); }}
                className="w-20 h-9 rounded-xl border-[1.5px] border-input px-2 text-right text-[14px] bg-white tabular-nums" />
              <button type="button" disabled={!delayDirty || busy || delayNum < 0} onClick={() => put({ chainDelaySeconds: delayNum })}
                className="h-9 px-4 rounded-full bg-teal text-lime text-[13px] font-semibold cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed">Apply</button>
            </div>
            <span className="text-[12px] text-teal-grey">Holds every receipt for this long before CHAIN_CONFIRM accepts it.</span>
          </div>
          {err && <span role="alert" className="text-[13px] text-critical">{err}</span>}
        </>
      )}
    </section>
  );
}

/* ------------------------------------------------------------------ payout partners (TC08) */

interface Draft { rate: string; capacity: string; reliability: string; delay: string; active: boolean }

function ProvidersTable() {
  const providers = useApi<{ items: SimProvider[] }>("/sim/providers");
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ kind: "ok" | "error"; text: string } | null>(null);

  function startEdit(p: SimProvider) {
    setEditing(p.id);
    setDraft({ rate: p.rate, capacity: fmtMinor(p.capacity_usd), reliability: String(p.reliability), delay: String(p.payout_delay_ms), active: p.active });
  }

  async function save(id: string, body: Record<string, unknown>, label: string) {
    setBusy(id);
    setMsg(null);
    try {
      const updated = await api<SimProvider>(`/sim/providers/${id}`, { method: "PUT", json: body });
      providers.setData((d) => (d ? { items: d.items.map((x) => (x.id === id ? { ...x, ...updated } : x)) } : d));
      setMsg({ kind: "ok", text: `${updated.name ?? "Provider"}: ${label}.` });
      setEditing(null);
    } catch (e) {
      setMsg({ kind: "error", text: errMsg(e) });
    } finally {
      setBusy(null);
    }
  }

  function saveDraft(p: SimProvider) {
    if (!draft) return;
    const capClean = draft.capacity.replace(/,/g, "").trim();
    const capacity = /^0*(\.0*)?$/.test(capClean) ? "0" : parseMajorToMinor(draft.capacity);
    const reliability = Number(draft.reliability);
    const delay = Number(draft.delay);
    if (!/^\d+(\.\d{1,2})?$/.test(draft.rate.trim())) return setMsg({ kind: "error", text: "Rate must be a number like 1580.00" });
    if (capacity === null) return setMsg({ kind: "error", text: "Capacity must be a USD amount like 50,000.00" });
    if (!(reliability >= 0 && reliability <= 1)) return setMsg({ kind: "error", text: "Reliability must be between 0 and 1" });
    if (!(Number.isInteger(delay) && delay >= 0)) return setMsg({ kind: "error", text: "Delay must be whole milliseconds" });
    save(p.id, { rate: Number(draft.rate).toFixed(2), capacity_usd: capacity, reliability, payout_delay_ms: delay, active: draft.active }, "saved");
  }

  const items = providers.data?.items ?? [];
  const input = "h-8 w-full min-w-0 rounded-lg border-[1.5px] border-input px-2 text-right text-[13px] bg-white tabular-nums";

  return (
    <Card title="Payout partners" aside="Rate, capacity and reliability drive MATCH routing · TC08">
      {providers.loading && !providers.data && <Loading />}
      {providers.error && !providers.data && <ErrorBox message={providers.error} onRetry={providers.reload} />}
      {providers.data && items.length === 0 && <Empty title="No providers" body="Run the seed to create the three liquidity providers." />}
      {items.length > 0 && (
        <div className="overflow-x-auto">
          <table className={`${T.table} min-w-[980px]`}>
            <thead>
              <tr className={T.headRow}>
                <th scope="col" className={T.th}>Partner</th>
                <th scope="col" className={T.thR}>Rate (NGN/USD)</th>
                <th scope="col" className={T.thR}>Capacity</th>
                <th scope="col" className={T.thR}>Reliability</th>
                <th scope="col" className={T.thR}>Payout delay</th>
                <th scope="col" className={T.th}>Active</th>
                <th scope="col" className={T.th}>Wallet</th>
                <th scope="col" className={T.th}><span className="sr-only">Actions</span></th>
              </tr>
            </thead>
            <tbody>
              {items.map((p) => {
                const isEdit = editing === p.id && draft;
                const empty = BigInt(p.capacity_usd || "0") === 0n;
                return (
                  <tr key={p.id} className={empty || !p.active ? "bg-critical-bg" : "bg-white"}>
                    <td className={T.td}>
                      <div className="font-semibold">{p.name}</div>
                      <div className="text-[12px] text-teal-grey font-mono">{p.adapter}</div>
                    </td>
                    <td className={T.tdR}>{isEdit ? <input aria-label="Rate" className={`${input} w-24`} value={draft.rate} onChange={(e) => setDraft({ ...draft, rate: e.target.value })} /> : p.rate}</td>
                    <td className={`${T.tdR} font-semibold ${empty ? "text-critical" : ""}`}>
                      {isEdit ? <input aria-label="Capacity USD" className={`${input} w-32`} value={draft.capacity} onChange={(e) => setDraft({ ...draft, capacity: e.target.value })} /> : money("USD", p.capacity_usd)}
                    </td>
                    <td className={T.tdR}>{isEdit ? <input aria-label="Reliability" className={`${input} w-20`} value={draft.reliability} onChange={(e) => setDraft({ ...draft, reliability: e.target.value })} /> : Number(p.reliability).toFixed(2)}</td>
                    <td className={T.tdR}>{isEdit ? <input aria-label="Delay ms" className={`${input} w-24`} value={draft.delay} onChange={(e) => setDraft({ ...draft, delay: e.target.value })} /> : `${(p.payout_delay_ms / 1000).toFixed(1)} s`}</td>
                    <td className={T.td}>
                      {isEdit ? (
                        <label className="inline-flex items-center gap-2"><input type="checkbox" checked={draft.active} onChange={(e) => setDraft({ ...draft, active: e.target.checked })} className="accent-teal" />Active</label>
                      ) : p.active ? "Yes" : <span className="text-critical font-semibold">No</span>}
                    </td>
                    <td className={`${T.td} font-mono text-teal-grey`} title={p.wallet_address}>{shortHash(p.wallet_address)}</td>
                    <td className={T.td}>
                      <div className="flex gap-2 justify-end whitespace-nowrap">
                        {isEdit ? (
                          <>
                            <button type="button" disabled={busy === p.id} onClick={() => saveDraft(p)} className="h-8 px-3.5 rounded-full bg-teal text-lime text-[12px] font-semibold cursor-pointer disabled:opacity-50">Save</button>
                            <button type="button" onClick={() => setEditing(null)} className="h-8 px-3.5 rounded-full border-[1.5px] border-teal text-[12px] font-medium cursor-pointer">Cancel</button>
                          </>
                        ) : (
                          <>
                            <button type="button" onClick={() => startEdit(p)} className="h-8 px-3.5 rounded-full border-[1.5px] border-teal text-[12px] font-medium cursor-pointer">Edit</button>
                            <button type="button" disabled={busy === p.id || empty} onClick={() => save(p.id, { capacity_usd: "0" }, "capacity set to USD 0.00")}
                              className="h-8 px-3.5 rounded-full border-[1.5px] border-critical text-critical text-[12px] font-medium cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed">Set capacity to 0</button>
                          </>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      {msg && <div className="p-4"><Toast kind={msg.kind} onClose={() => setMsg(null)}>{msg.text}</Toast></div>}
    </Card>
  );
}

/* ------------------------------------------------------------------ webhook sink (TC07) */

function WebhookLog() {
  const ev = useApi<{ items: WebhookEvent[] }>("/sim/webhook-events", 5000);
  const [open, setOpen] = useState<string | null>(null);
  const items = ev.data?.items ?? [];
  return (
    <Card title="Webhook sink" aside="Last 50 events received at /sim/webhook-sink · refreshes every 5 s">
      {ev.loading && !ev.data && <Loading />}
      {ev.error && !ev.data && <ErrorBox message={ev.error} onRetry={ev.reload} />}
      {ev.data && items.length === 0 && <Empty title="No webhooks yet" body="FINALISE and reversals post here; complete a transfer to see one." />}
      {items.length > 0 && (
        <div className="overflow-x-auto">
          <table className={`${T.table} min-w-[760px]`}>
            <thead>
              <tr className={T.headRow}>
                <th scope="col" className={T.th}>Time</th>
                <th scope="col" className={T.th}>Direction</th>
                <th scope="col" className={T.th}>Event</th>
                <th scope="col" className={T.th}>Reference</th>
                <th scope="col" className={T.thR}>HTTP</th>
                <th scope="col" className={T.th}><span className="sr-only">Payload</span></th>
              </tr>
            </thead>
            <tbody>
              {items.map((w) => {
                const payload = (w.payload ?? {}) as Record<string, unknown>;
                const ref = (payload.reference ?? payload.transfer_id ?? payload.id ?? "—") as string;
                const isOpen = open === w.id;
                return (
                  <Fragment key={w.id}>
                    <tr>
                      <td className={`${T.td} text-teal-grey whitespace-nowrap`}>{fmtTime((w.created_at ?? w.createdAt) as string | undefined)}</td>
                      <td className={`${T.td} font-mono text-[12px]`}>{w.direction ?? "—"}</td>
                      <td className={`${T.td} font-mono`}>{w.event ?? (payload.event as string) ?? "—"}</td>
                      <td className={`${T.td} font-mono`}>{String(ref)}</td>
                      <td className={T.tdR}>{w.status ?? "—"}</td>
                      <td className={`${T.td} text-right`}>
                        <button type="button" onClick={() => setOpen(isOpen ? null : w.id)} className="text-[12px] font-semibold underline cursor-pointer">{isOpen ? "Hide payload" : "Payload"}</button>
                      </td>
                    </tr>
                    {isOpen && (
                      <tr><td colSpan={6} className={T.td}><JsonBlock value={w.payload ?? w} /></td></tr>
                    )}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}
