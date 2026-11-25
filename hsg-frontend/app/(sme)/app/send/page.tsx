"use client";
/**
 * S4 Send payment.
 *   Step 1 Details: pick a CLEARED beneficiary, enter the USD amount they receive, purpose.
 *   Step 2 Review rate: POST /quotes -> rate, fee, total NGN, live countdown to expires_at.
 *   Step 3 Confirm: POST /transfers with an Idempotency-Key, then go to the transfer page.
 *
 * Idempotency: the key is created the first time "Confirm" is pressed for a given quote and
 * reused if that same confirm is retried (e.g. the network dropped), so a double click or a
 * retry can never create two transfers. A fresh quote gets a fresh key.
 */
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { api, ApiError } from "@/lib/api";
import { fmtMinor, money, parseMajorToMinor } from "@/lib/money";
import type { Balance, Beneficiary, Page, Quote, SmeTransfer } from "@/lib/types";
import { useMe } from "@/components/sme/MeContext";
import { BeneficiaryDrawer } from "@/components/sme/BeneficiaryDrawer";
import { countryName, initials } from "@/components/sme/countries";
import { Icon } from "@/components/sme/motifs";
import { ErrorState, Skeleton, fmtRate, friendlyError, inputCls } from "@/components/sme/ui";

type Step = "details" | "quote";
const REVIEW_THRESHOLD_CENTS = 1_000_000n; // USD 10,000.00

export default function SendPage() {
  const router = useRouter();
  const { me } = useMe();
  const kybOk = me?.sme.kyb_status === "VERIFIED";

  const [bens, setBens] = useState<Beneficiary[] | null>(null);
  const [bensError, setBensError] = useState<string | null>(null);
  const [balance, setBalance] = useState<Balance | null>(null);
  const [benId, setBenId] = useState<string | null>(null);
  const [amount, setAmount] = useState("");
  const [purpose, setPurpose] = useState("");
  const [fieldError, setFieldError] = useState<string | null>(null);

  const [step, setStep] = useState<Step>("details");
  const [quote, setQuote] = useState<Quote | null>(null);
  const [quoting, setQuoting] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const [drawer, setDrawer] = useState(false);
  const idemKey = useRef<string | null>(null);

  const loadBens = useCallback(() => {
    setBensError(null);
    api<Page<Beneficiary>>("/beneficiaries")
      .then((r) => {
        setBens(r.items);
        // Pre-select the first cleared beneficiary.
        setBenId((cur) => cur ?? r.items.find((b) => b.screening_status === "CLEARED")?.id ?? null);
      })
      .catch((e) => setBensError(friendlyError(e)));
  }, []);
  const loadBalance = useCallback(() => {
    api<Balance>("/balance").then(setBalance).catch(() => {});
  }, []);
  useEffect(() => { loadBens(); loadBalance(); }, [loadBens, loadBalance]);
  const closeDrawer = useCallback(() => setDrawer(false), []);
  const onBenSaved = useCallback((b: Beneficiary) => {
    setBens((prev) => [b, ...(prev ?? [])]);
    if (b.screening_status === "CLEARED") setBenId(b.id);
  }, []);

  // Tick once a second while a quote is on screen (drives the countdown).
  useEffect(() => {
    if (step !== "quote") return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [step]);

  const chosen = bens?.find((b) => b.id === benId) ?? null;
  const amountMinor = parseMajorToMinor(amount);
  const ttlMs = quote ? new Date(quote.expires_at).getTime() - new Date(quote.created_at).getTime() : 60_000;
  const leftMs = quote ? Math.max(0, new Date(quote.expires_at).getTime() - now) : 0;
  const expired = step === "quote" && quote !== null && leftMs <= 0;
  const secs = Math.ceil(leftMs / 1000);
  const low = secs <= 15;
  const insufficient = quote !== null && balance !== null && BigInt(quote.total_ngn) > BigInt(balance.available);
  const bigPayment = amountMinor !== null && BigInt(amountMinor) > REVIEW_THRESHOLD_CENTS;

  async function getQuote() {
    setFieldError(null);
    setSubmitError(null);
    if (!kybOk) { setFieldError("We are still verifying your business. Sending unlocks once verification is complete."); return; }
    if (!chosen) { setFieldError("Choose or add a beneficiary first."); return; }
    if (chosen.screening_status !== "CLEARED") { setFieldError("This beneficiary has not been cleared and can’t be paid."); return; }
    if (!amountMinor) { setFieldError("Enter an amount greater than zero, with up to two decimals."); return; }
    if (!purpose.trim()) { setFieldError("Tell us the purpose of the payment."); return; }
    setQuoting(true);
    try {
      const q = await api<Quote>("/quotes", { method: "POST", json: { usd_amount: amountMinor } });
      idemKey.current = null; // new quote, new confirm attempt
      setQuote(q);
      setNow(Date.now());
      setStep("quote");
      loadBalance();
    } catch (e) {
      if (step === "quote") setSubmitError(friendlyError(e)); else setFieldError(friendlyError(e));
    } finally {
      setQuoting(false);
    }
  }

  async function confirm() {
    if (!quote || !chosen || submitting || expired || insufficient) return;
    setSubmitting(true);
    setSubmitError(null);
    // Same click retried -> same key; the server replays the original response.
    idemKey.current ??= crypto.randomUUID();
    try {
      const t = await api<SmeTransfer>("/transfers", {
        method: "POST",
        idempotencyKey: idemKey.current,
        json: { quote_id: quote.id, beneficiary_id: chosen.id, purpose: purpose.trim() },
      });
      router.push(`/app/transfers/${t.id}`);
    } catch (e) {
      if (e instanceof ApiError && e.code === "QUOTE_EXPIRED") setNow(new Date(quote.expires_at).getTime() + 1);
      if (e instanceof ApiError && e.code === "INSUFFICIENT_FUNDS") loadBalance();
      setSubmitError(friendlyError(e));
      setSubmitting(false);
    }
  }

  const stepIdx = step === "details" ? 0 : submitting ? 2 : 1;
  const labels = ["Details", "Review rate", "Confirm"];

  return (
    <>
      <div className="flex flex-wrap items-center justify-between gap-4">
        <h1 className="m-0 text-[26px] font-medium tracking-[-0.01em] sm:text-[30px]">Send payment</h1>
        <ol className="m-0 flex list-none items-center gap-1 rounded-full bg-white p-1.5 text-[14px]" aria-label="Steps">
          {labels.map((l, i) => (
            <li key={l} aria-current={i === stepIdx ? "step" : undefined} className={`flex items-center gap-2 rounded-full py-1.5 pl-1.5 pr-3.5 ${i === stepIdx ? "bg-teal" : ""}`}>
              <span className={`inline-flex h-[26px] w-[26px] items-center justify-center rounded-full text-[12px] font-semibold text-teal ${i <= stepIdx ? "bg-lime" : "bg-pending"}`}>{i < stepIdx ? "✓" : i + 1}</span>
              <span className={`${i === stepIdx ? "font-semibold text-white" : "hidden font-medium text-teal-grey sm:inline"}`}>{l}</span>
            </li>
          ))}
        </ol>
      </div>

      <div className="flex flex-wrap items-start gap-6">
        <div className="flex min-w-0 flex-[999_1_480px] flex-col gap-5">
          {step === "details" && (
            <section className="flex flex-col gap-[26px] rounded-3xl bg-white p-5 sm:p-[30px]">
              {me && !kybOk && (
                <div role="alert" className="rounded-[14px] bg-amber-bg px-4 py-3 text-[14px] leading-5 text-amber">
                  Your business is not verified yet, so payments can’t be sent. You can add beneficiaries and fund your account in the meantime.
                </div>
              )}

              <fieldset className="m-0 flex flex-col gap-2.5 border-0 p-0">
                <legend className="mb-3 p-0 text-[17px] font-semibold">Who are you paying?</legend>
                {bensError && <ErrorState message={bensError} onRetry={loadBens} />}
                {!bens && !bensError && [0, 1].map((i) => <Skeleton key={i} className="h-[72px] rounded-[18px]" />)}
                {bens?.length === 0 && (
                  <div className="rounded-[18px] border-2 border-dashed border-input p-[18px] text-[14px] text-teal-grey">No beneficiaries yet. Add one to pay by USD wire.</div>
                )}
                {bens?.map((b) => {
                  const blocked = b.screening_status !== "CLEARED";
                  const sel = b.id === benId && !blocked;
                  return (
                    <button
                      key={b.id}
                      type="button"
                      disabled={blocked}
                      aria-pressed={sel}
                      onClick={() => { setBenId(b.id); setFieldError(null); }}
                      className={`flex items-center gap-3.5 rounded-[18px] border-2 px-4 py-3.5 text-left transition ${sel ? "border-teal bg-[#F7FFCC]" : "border-line-soft bg-white hover:border-line"} ${blocked ? "cursor-not-allowed opacity-55" : "cursor-pointer"}`}
                    >
                      <span className={`flex h-[42px] w-[42px] shrink-0 items-center justify-center rounded-full text-[14px] font-semibold ${sel ? "bg-teal text-lime" : "bg-pending text-teal"}`}>{initials(b.name)}</span>
                      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                        <span className="truncate text-[15px] font-semibold text-teal">{b.name}</span>
                        <span className="truncate text-[13px] text-teal-grey">{countryName(b.country)} · USD wire · {b.bank_name} {b.account_number_masked}</span>
                      </span>
                      <span className={`whitespace-nowrap text-[13px] font-semibold ${blocked ? "text-critical" : "text-teal"}`}>{blocked ? "Not cleared" : sel ? "Selected" : ""}</span>
                    </button>
                  );
                })}
                <button type="button" onClick={() => setDrawer(true)} className="mt-1 h-[42px] cursor-pointer self-start rounded-full border-[1.5px] border-dashed border-teal bg-transparent px-[18px] text-[14px] font-semibold text-teal">+ Add a beneficiary</button>
              </fieldset>

              <div className="flex flex-col gap-2">
                <label htmlFor="amount" className="text-[14px] font-medium">Amount the beneficiary receives</label>
                <div className={`flex h-[60px] items-center overflow-hidden rounded-2xl border-2 bg-white ${fieldError && !amountMinor ? "border-critical" : "border-teal"}`}>
                  <span className="flex h-full min-w-11 items-center justify-center bg-teal px-[18px] text-[15px] font-semibold text-lime">USD</span>
                  <input
                    id="amount"
                    type="text"
                    inputMode="decimal"
                    autoComplete="off"
                    placeholder="0.00"
                    value={amount}
                    onChange={(e) => { setAmount(e.target.value); setFieldError(null); }}
                    onBlur={() => { if (amountMinor) setAmount(fmtMinor(amountMinor)); }}
                    aria-describedby="amount-help"
                    className="min-w-0 flex-1 border-0 px-[18px] text-right text-[24px] font-medium text-teal outline-none"
                  />
                </div>
                <div id="amount-help" className={`text-[13px] ${bigPayment ? "text-amber" : "text-teal-grey"}`}>
                  {bigPayment ? "Worth more than USD 10,000: this payment will be reviewed before it is sent." : "Beneficiary receives exactly this amount, in USD."}
                </div>
              </div>

              <div className="flex flex-col gap-2">
                <label htmlFor="purpose" className="text-[14px] font-medium">Purpose of payment</label>
                <input id="purpose" type="text" value={purpose} maxLength={140} placeholder="e.g. Spare parts, invoice INV-2291" onChange={(e) => setPurpose(e.target.value)} aria-describedby="purpose-help" className={inputCls} />
                <div id="purpose-help" className="text-[13px] text-teal-grey">Shown to the beneficiary’s bank. An invoice number helps them match it.</div>
              </div>

              {fieldError && <div role="alert" className="rounded-[14px] border border-critical-line bg-critical-bg px-4 py-3 text-[14px] leading-5 text-critical">{fieldError}</div>}

              <button type="button" onClick={getQuote} disabled={quoting || (me !== null && !kybOk)} className="h-[54px] cursor-pointer rounded-full bg-teal text-[16px] font-semibold text-lime transition hover:bg-teal-console disabled:cursor-not-allowed disabled:opacity-50">
                {quoting ? "Getting your rate…" : "Get quote"}
              </button>
            </section>
          )}

          {step === "quote" && quote && (
            <section className="relative overflow-hidden rounded-3xl bg-teal text-white">
              <svg width="220" height="220" viewBox="0 0 220 220" aria-hidden="true" className="pointer-events-none absolute -right-10 -top-10"><path d="M40 0 A180 180 0 0 0 220 180" fill="none" stroke="#1E4A58" strokeWidth={40} /></svg>
              <div className="relative flex flex-col gap-5 p-5 sm:p-[30px]">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <h2 className="m-0 text-[17px] font-semibold">Review and confirm</h2>
                  <span role="timer" aria-live="off" className={`inline-flex h-8 items-center gap-2 rounded-full px-3.5 text-[13px] font-semibold ${expired || low ? "bg-amber-bg text-amber" : "bg-lime text-teal"}`}>
                    <Icon name="clock" size={14} />
                    {expired ? "Rate expired" : `Rate held for ${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, "0")}`}
                  </span>
                </div>
                <div className="h-1.5 overflow-hidden rounded-full bg-teal-mid">
                  <div className="h-full rounded-full transition-[width] duration-1000 ease-linear" style={{ width: `${Math.round((leftMs / ttlMs) * 100)}%`, background: low ? "#F79009" : "#E4FF1A" }} />
                </div>

                <div className="flex flex-col gap-1">
                  <span className="text-[12px] font-semibold uppercase tracking-[0.08em] text-lime">You pay</span>
                  <span className="break-words text-[32px] font-medium tracking-[-0.02em] sm:text-[44px]">{money("NGN", quote.total_ngn)}</span>
                </div>

                <dl className="m-0 flex flex-col rounded-[18px] bg-white px-5 py-1 text-teal">
                  <Row k={`${chosen?.name ?? "Beneficiary"} receives`} v={money("USD", quote.usd_amount)} strong />
                  <Row k="Rate" v={`USD 1 = NGN ${fmtRate(quote.rate)}`} />
                  <Row k="Converted amount" v={money("NGN", quote.principal_ngn)} />
                  <Row k="Fee" v={money("NGN", quote.fee_ngn)} />
                  <Row k="Paid out by" v="USD wire" />
                  <Row k="Purpose" v={purpose} last />
                </dl>

                {expired && (
                  <div role="alert" className="rounded-[14px] bg-amber-bg px-4 py-3 text-[14px] leading-5 text-amber">This rate has expired. Refresh to get a new one; nothing has been taken from your balance.</div>
                )}
                {!expired && insufficient && balance && (
                  <div role="alert" className="rounded-[14px] bg-critical-bg px-4 py-3 text-[14px] leading-5 text-critical">
                    Insufficient balance. This payment needs {money("NGN", quote.total_ngn)} and you have {money("NGN", balance.available)} available.{" "}
                    <Link href="/app/funds" className="font-semibold text-critical underline">Add funds</Link>
                  </div>
                )}
                {submitError && !expired && <div role="alert" className="rounded-[14px] bg-critical-bg px-4 py-3 text-[14px] leading-5 text-critical">{submitError}</div>}

                <div className="flex flex-wrap gap-3">
                  <button type="button" disabled={submitting} onClick={() => { setStep("details"); setSubmitError(null); }} className="h-[54px] cursor-pointer rounded-full border-[1.5px] border-[#4A7684] bg-transparent px-[22px] text-[15px] font-medium text-white disabled:opacity-50">Edit details</button>
                  {expired ? (
                    <button type="button" onClick={getQuote} disabled={quoting} className="h-[54px] min-w-[200px] flex-1 cursor-pointer rounded-full border-[1.5px] border-lime bg-transparent text-[15px] font-semibold text-lime disabled:opacity-50">
                      {quoting ? "Refreshing…" : "Refresh quote"}
                    </button>
                  ) : (
                    <button type="button" onClick={confirm} disabled={submitting || insufficient || balance === null} className="h-[54px] min-w-[200px] flex-1 cursor-pointer rounded-full bg-lime px-4 text-[16px] font-semibold text-teal transition hover:brightness-95 disabled:cursor-not-allowed disabled:opacity-50">
                      {submitting ? "Sending…" : `Confirm and send ${money("NGN", quote.total_ngn)}`}
                    </button>
                  )}
                </div>
              </div>
              <div className="relative flex items-center gap-2.5 bg-teal-console px-5 py-4 text-[13px] text-teal-mist sm:px-[30px]">
                <span className="text-lime"><Icon name="shield" size={16} /></span>
                We check every payment before money moves. If it cannot be delivered, the full amount returns to your balance.
              </div>
            </section>
          )}
        </div>

        <aside aria-label="Balance" className="flex flex-[1_1_300px] flex-col gap-4 rounded-3xl bg-white p-[26px]">
          <div className="text-[12px] font-semibold uppercase tracking-[0.08em] text-teal-grey">Available balance</div>
          {balance ? <div className="text-[26px] font-medium">{money("NGN", balance.available)}</div> : <Skeleton className="h-8 w-48" />}
          <div className="flex flex-col gap-2.5 border-t border-line-soft pt-3.5 text-[14px]">
            <div className="flex justify-between gap-3"><span className="text-teal-grey">This payment</span><span className="font-semibold">{money("NGN", quote && step === "quote" ? quote.total_ngn : "0")}</span></div>
            <div className="flex justify-between gap-3">
              <span className="text-teal-grey">Balance after</span>
              <span className={`font-semibold ${insufficient && step === "quote" ? "text-critical" : ""}`}>
                {balance ? money("NGN", (BigInt(balance.available) - (quote && step === "quote" ? BigInt(quote.total_ngn) : 0n)).toString()) : "—"}
              </span>
            </div>
            <div className="flex justify-between gap-3"><span className="text-teal-grey">Rate</span><span className="font-semibold">{quote ? `USD 1 = NGN ${fmtRate(quote.rate)}` : "Shown at quote"}</span></div>
          </div>
          <div className="rounded-2xl bg-lime-soft px-4 py-3.5 text-[13px] leading-5 text-teal">Payments worth more than USD 10,000 are reviewed before sending, usually within one working hour.</div>
        </aside>
      </div>

      <BeneficiaryDrawer
        open={drawer}
        saveLabel="Save and use"
        onClose={closeDrawer}
        onSaved={onBenSaved}
      />
    </>
  );
}

function Row({ k, v, strong, last }: { k: string; v: string; strong?: boolean; last?: boolean }) {
  return (
    <div className={`flex justify-between gap-4 py-[13px] ${last ? "" : "border-b border-line-soft"}`}>
      <dt className="text-[14px] text-teal-grey">{k}</dt>
      <dd className={`m-0 text-right text-[15px] ${strong ? "font-semibold" : ""}`}>{v}</dd>
    </div>
  );
}
