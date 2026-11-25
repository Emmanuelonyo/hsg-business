"use client";
/**
 * "Add a beneficiary" drawer. POST /beneficiaries; checks run synchronously on the server,
 * so the response already says CLEARED or BLOCKED and we show the result in place.
 */
import { useEffect, useRef, useState } from "react";
import { api } from "@/lib/api";
import type { Beneficiary } from "@/lib/types";
import { COUNTRIES } from "./countries";
import { Arcs, Asterisk, Icon } from "./motifs";
import { friendlyError } from "./ui";

const field = "h-[50px] w-full min-w-0 rounded-[14px] border-[1.5px] border-input bg-white px-3.5 text-[15px] text-teal outline-none focus:border-teal";
const EMPTY = { name: "", country: "CN", bank_name: "", account_number: "", swift_bic: "", address: "" };

export function BeneficiaryDrawer({ open, onClose, onSaved, saveLabel = "Save and check" }: {
  open: boolean; onClose: () => void; onSaved: (b: Beneficiary) => void; saveLabel?: string;
}) {
  const [form, setForm] = useState(EMPTY);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<Beneficiary | null>(null);
  const firstField = useRef<HTMLInputElement>(null);
  // Keep the latest onClose in a ref so the reset effect below only runs when `open` flips.
  const closeRef = useRef(onClose);
  useEffect(() => { closeRef.current = onClose; }, [onClose]);

  useEffect(() => {
    if (!open) return;
    setForm(EMPTY); setError(null); setResult(null); setBusy(false);
    setTimeout(() => firstField.current?.focus(), 0);
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") closeRef.current(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  if (!open) return null;
  const set = (k: keyof typeof EMPTY) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setForm((f) => ({ ...f, [k]: e.target.value }));
  const valid = form.name.trim() && form.bank_name.trim() && form.account_number.trim() && form.address.trim();

  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (busy || !valid) return;
    setBusy(true); setError(null);
    try {
      const b = await api<Beneficiary>("/beneficiaries", {
        method: "POST",
        json: {
          name: form.name.trim(), country: form.country, bank_name: form.bank_name.trim(),
          account_number: form.account_number.replace(/\s+/g, ""), swift_bic: form.swift_bic.trim() || undefined,
          address: form.address.trim(), currency: "USD",
        },
      });
      setResult(b);
      onSaved(b);
    } catch (err) {
      setError(friendlyError(err));
    } finally {
      setBusy(false);
    }
  }

  const cleared = result?.screening_status === "CLEARED";

  return (
    <div className="fixed inset-0 z-50 flex justify-end print:hidden">
      <button type="button" aria-label="Close drawer" onClick={onClose} className="absolute inset-0 cursor-pointer border-0 bg-[rgba(8,37,46,0.55)] p-0" />
      <form role="dialog" aria-modal="true" aria-labelledby="drawer-title" onSubmit={save} className="relative flex h-full w-full max-w-[460px] flex-col bg-white shadow-[-16px_0_40px_rgba(8,37,46,0.25)]">
        <div className="relative flex flex-col gap-1.5 overflow-hidden bg-teal px-6 pb-[22px] pt-6 text-white">
          <Arcs size={140} stroke={26} className="-bottom-[60px] -right-[30px]" arcs={[{ start: 14, color: "#1E4A58" }]} />
          <div className="relative flex items-center justify-between">
            <h2 id="drawer-title" className="m-0 text-[22px] font-medium">Add a beneficiary</h2>
            <button type="button" aria-label="Close" onClick={onClose} className="flex h-10 w-10 cursor-pointer items-center justify-center rounded-full bg-teal-mid text-white"><Icon name="close" size={16} /></button>
          </div>
          <span className="relative text-[13px] text-teal-mist">We check every new beneficiary before it can be paid. Payments arrive in USD.</span>
        </div>

        <div className="flex flex-1 flex-col gap-4 overflow-y-auto px-6 py-[22px]">
          <div className="flex flex-col gap-1.5"><label htmlFor="b-name" className="text-[14px] font-medium">Business name</label><input ref={firstField} id="b-name" required value={form.name} onChange={set("name")} className={field} /></div>
          <div className="flex flex-col gap-1.5">
            <label htmlFor="b-country" className="text-[14px] font-medium">Country</label>
            <select id="b-country" value={form.country} onChange={set("country")} className={`${field} px-3`}>
              {COUNTRIES.map((c) => <option key={c.code} value={c.code}>{c.name}</option>)}
            </select>
          </div>
          <div className="flex flex-col gap-1.5"><label htmlFor="b-bank" className="text-[14px] font-medium">Bank name</label><input id="b-bank" required value={form.bank_name} onChange={set("bank_name")} className={field} /></div>
          <div className="flex flex-wrap gap-3">
            <div className="flex flex-[2_1_180px] flex-col gap-1.5"><label htmlFor="b-acct" className="text-[14px] font-medium">Account number or IBAN</label><input id="b-acct" required value={form.account_number} onChange={set("account_number")} className={`${field} font-mono text-[14px]`} /></div>
            <div className="flex flex-[1_1_120px] flex-col gap-1.5"><label htmlFor="b-swift" className="text-[14px] font-medium">SWIFT / BIC</label><input id="b-swift" value={form.swift_bic} onChange={set("swift_bic")} className={`${field} font-mono text-[14px] uppercase`} /></div>
          </div>
          <div className="flex flex-col gap-1.5">
            <label htmlFor="b-addr" className="text-[14px] font-medium">Business address</label>
            <input id="b-addr" required value={form.address} onChange={set("address")} aria-describedby="b-addr-help" className={field} />
            <span id="b-addr-help" className="text-[12px] text-teal-grey">Required by international payment rules.</span>
          </div>

          {error && <div role="alert" className="rounded-[14px] border border-critical-line bg-critical-bg px-4 py-3 text-[14px] leading-5 text-critical">{error}</div>}
          {result && cleared && (
            <div role="status" className="flex items-center gap-3 rounded-2xl bg-lime px-4 py-3.5 text-[14px] leading-5">
              <Asterisk size={28} />
              <span>Cleared. {result.name} is ready to receive payments.</span>
            </div>
          )}
          {result && !cleared && (
            <div role="alert" className="flex items-start gap-3 rounded-2xl border border-critical-line bg-critical-bg px-4 py-3.5 text-[14px] leading-5 text-critical">
              <Icon name="alert" />
              <span>Not cleared. {result.name} did not pass our checks and can’t be paid. Contact support if you think this is a mistake.</span>
            </div>
          )}
        </div>

        <div className="flex gap-2.5 border-t border-line-soft px-6 py-4">
          {result ? (
            <>
              <button type="button" onClick={() => { setForm(EMPTY); setResult(null); firstField.current?.focus(); }} className="h-[50px] cursor-pointer rounded-full border-[1.5px] border-teal bg-white px-[22px] text-[15px] font-medium text-teal">Add another</button>
              <button type="button" onClick={onClose} className="h-[50px] flex-1 cursor-pointer rounded-full bg-teal text-[15px] font-semibold text-lime">Done</button>
            </>
          ) : (
            <>
              <button type="button" onClick={onClose} className="h-[50px] cursor-pointer rounded-full border-[1.5px] border-teal bg-white px-[22px] text-[15px] font-medium text-teal">Cancel</button>
              <button type="submit" disabled={busy || !valid} className={`h-[50px] flex-1 cursor-pointer rounded-full text-[15px] font-semibold disabled:cursor-not-allowed ${busy ? "bg-input text-teal-grey" : "bg-teal text-lime disabled:opacity-50"}`}>
                {busy ? "Checking beneficiary…" : saveLabel}
              </button>
            </>
          )}
        </div>
      </form>
    </div>
  );
}
