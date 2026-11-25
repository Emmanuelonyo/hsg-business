"use client";
/**
 * S5 Transfer detail: amounts, status chip, 4-step timeline from the API.
 * Polls every 3 s while the payment is still moving (Processing / Under review).
 * "Download receipt" prints the page; print styles hide the navigation and buttons.
 */
import Link from "next/link";
import { use, useCallback, useState } from "react";
import { api, ApiError } from "@/lib/api";
import { fmtTime, money } from "@/lib/money";
import type { SmeStatus, SmeTransfer, TimelineStep } from "@/lib/types";
import { StatusChip } from "@/components/ui/StatusChip";
import { Mark } from "@/components/ui/Mark";
import { countryName } from "@/components/sme/countries";
import { Arcs, Asterisk, Icon } from "@/components/sme/motifs";
import { ErrorState, Skeleton, fmtRate, friendlyError, outlinePill, usePoll } from "@/components/sme/ui";

/** Banner colours per status: [background, title, body, arc]. */
const BANNER: Record<SmeStatus, [string, string, string, string]> = {
  "Processing": ["#0D3542", "#FFFFFF", "#C9D6DA", "#1E4A58"],
  "Under review": ["#FEF3E2", "#93370D", "#5C2A0C", "#FDE3BF"],
  "Completed": ["#E4FF1A", "#0D3542", "#1E4A58", "#F1FF99"],
  "Reversed": ["#FEF3F2", "#B42318", "#5B1A13", "#FDDAD6"],
  "Declined": ["#FEF3F2", "#B42318", "#5B1A13", "#FDDAD6"],
};

function bannerCopy(t: SmeTransfer): { title: string; body: string; debitLabel: string; debitAmount: string } {
  const usd = money("USD", t.usd_amount);
  const ngn = money("NGN", t.ngn_debited);
  switch (t.status) {
    case "Processing":
      return { title: "On its way", body: `${ngn} is held from your balance while we send ${usd} to ${t.beneficiary.name}.`, debitLabel: "Held from your balance", debitAmount: ngn };
    case "Under review":
      return { title: "Under review", body: "Our compliance team is checking this payment, usually within one working hour. No money has left your balance yet. We’ll email you if we need anything.", debitLabel: "Amount to be debited", debitAmount: ngn };
    case "Completed":
      return { title: "Delivered", body: `${usd} reached ${t.beneficiary.name}${t.completed_at ? ` on ${fmtTime(t.completed_at)}` : ""}. Your receipt is ready to download.`, debitLabel: "Debited from your balance", debitAmount: ngn };
    case "Reversed": {
      const back = money("NGN", t.ngn_returned ?? t.ngn_debited);
      return {
        title: "Payment reversed, funds returned",
        body: `${t.failure_reason ?? "This payment could not be delivered."} ${back}, including the fee, is back in your available balance.`,
        debitLabel: "Returned to your balance",
        debitAmount: back,
      };
    }
    case "Declined":
      return { title: "Payment declined", body: `${t.failure_reason ?? "This payment did not pass our checks, so it was not sent."} Nothing was taken from your balance.`, debitLabel: "Amount (not debited)", debitAmount: ngn };
  }
}

export default function TransferPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const [t, setT] = useState<SmeTransfer | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notFound, setNotFound] = useState(false);

  const load = useCallback(() => {
    api<SmeTransfer>(`/transfers/${encodeURIComponent(id)}`)
      .then((r) => { setT(r); setError(null); })
      .catch((e) => {
        if (e instanceof ApiError && (e.code === "NOT_FOUND" || e.status === 404)) setNotFound(true);
        else setError(friendlyError(e));
      });
  }, [id]);

  const moving = !t || t.status === "Processing" || t.status === "Under review";
  usePoll(load, 3000, moving && !notFound);

  const back = (
    <Link href="/app/transfers" className="inline-flex items-center gap-1.5 self-start text-[14px] font-semibold text-teal no-underline print:hidden">
      <Icon name="back" size={16} />All transfers
    </Link>
  );

  if (notFound) {
    return (
      <>
        {back}
        <div className="rounded-3xl bg-white p-8">
          <h1 className="m-0 text-[22px] font-medium">We couldn’t find that transfer</h1>
          <p className="mt-2 text-[14px] text-teal-grey">It may belong to another account, or the link is incomplete.</p>
        </div>
      </>
    );
  }

  if (!t) {
    return (
      <>
        {back}
        {error ? <ErrorState message={error} onRetry={load} /> : (
          <div className="flex flex-col gap-5" aria-busy="true">
            <Skeleton className="h-9 w-3/4" />
            <Skeleton className="h-24 w-full rounded-3xl" />
            <div className="flex flex-wrap gap-5"><Skeleton className="h-80 flex-[1_1_340px] rounded-3xl" /><Skeleton className="h-80 flex-[1.3_1_380px] rounded-3xl" /></div>
          </div>
        )}
      </>
    );
  }

  const copy = bannerCopy(t);
  const [bg, fg, bodyColor, arc] = BANNER[t.status];
  const steps = t.timeline;

  return (
    <>
      {back}

      {/* Printed receipt header (screen hidden). */}
      <div className="hidden items-center gap-3 border-b border-line pb-4 print:flex">
        <Mark size={32} />
        <span className="text-[18px] font-semibold">HSG Business · Payment receipt</span>
      </div>

      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex flex-col gap-1.5">
          <div className="flex flex-wrap items-center gap-3">
            <h1 className="m-0 text-[22px] font-medium tracking-[-0.01em] sm:text-[28px]">{money("USD", t.usd_amount)} to {t.beneficiary.name}</h1>
            <StatusChip status={t.status} />
          </div>
          <div className="text-[14px] text-teal-grey">
            Submitted {fmtTime(t.created_at)} · <span className="font-mono text-teal">{t.reference}</span>
          </div>
        </div>
        <button type="button" onClick={() => window.print()} className={`${outlinePill} print:hidden`}>
          <Icon name="download" size={16} />Download receipt
        </button>
      </div>

      {error && <div className="print:hidden"><ErrorState message={error} onRetry={load} /></div>}

      <div role="status" className="relative flex items-center gap-[18px] overflow-hidden rounded-3xl px-[26px] py-[22px]" style={{ background: bg }}>
        <Arcs size={160} stroke={30} className="-right-[30px] -top-[50px]" arcs={[{ start: 16, color: arc }]} />
        {t.status === "Completed" && <Asterisk size={44} className="relative shrink-0" />}
        <div className="relative flex max-w-[760px] flex-col gap-1">
          <div className="text-[18px] font-semibold" style={{ color: fg }}>{copy.title}</div>
          <div className="text-[14px] leading-[22px]" style={{ color: bodyColor }}>{copy.body}</div>
        </div>
      </div>

      <div className="flex flex-wrap items-start gap-[22px]">
        <section aria-label="Progress" className="flex flex-[1_1_340px] flex-col rounded-3xl bg-white px-7 py-[26px] print:border print:border-line">
          <div className="mb-[18px] flex items-center justify-between">
            <h2 className="m-0 text-[17px] font-semibold">Progress</h2>
            {moving && (
              <span className="inline-flex items-center gap-1.5 rounded-full bg-lime-soft px-2.5 py-1 text-[12px] font-medium text-teal print:hidden">
                <span className="h-[7px] w-[7px] animate-pulse rounded-full bg-teal" />Live
              </span>
            )}
          </div>
          <ol className="m-0 list-none p-0">
            {steps.map((s, i) => (
              <TimelineRow key={s.key} step={s} status={t.status} last={i === steps.length - 1 && t.status !== "Reversed"} />
            ))}
            {t.status === "Reversed" && (
              <TimelineRow
                step={{ key: "delivered", label: "Delivered", at: null, state: "done" }}
                labelOverride="Funds returned"
                subOverride={`${money("NGN", t.ngn_returned ?? t.ngn_debited)} back in your balance`}
                status={t.status}
                last
              />
            )}
          </ol>
        </section>

        <section aria-label="Payment details" className="flex flex-[1.3_1_380px] flex-col gap-1.5 rounded-3xl bg-white px-7 py-[26px] print:border print:border-line">
          <h2 className="m-0 mb-2 text-[17px] font-semibold">Payment details</h2>
          <dl className="m-0 flex flex-col">
            <Detail k="Beneficiary receives" v={money("USD", t.usd_amount)} strong />
            <Detail k="Rate" v={`USD 1 = NGN ${fmtRate(t.rate)}`} />
            <Detail k="Fee" v={money("NGN", t.fee_ngn)} />
            <div className="-mx-3.5 my-1.5 flex items-center justify-between gap-4 rounded-[14px] bg-lime-soft px-3.5 py-3">
              <dt className="text-[14px] font-medium">{copy.debitLabel}</dt>
              <dd className="m-0 text-right text-[16px] font-semibold">{copy.debitAmount}</dd>
            </div>
            <Detail k="Beneficiary" v={t.beneficiary.name} sub={countryName(t.beneficiary.country)} />
            <Detail k="Bank" v={`${t.beneficiary.bank_name} ${t.beneficiary.account_number_masked}`} />
            <Detail k="Reference" v={t.reference} mono />
            <Detail k="Purpose" v={t.purpose} last />
          </dl>
        </section>
      </div>
    </>
  );
}

function TimelineRow({ step, status, last, labelOverride, subOverride }: {
  step: TimelineStep; status: SmeStatus; last: boolean; labelOverride?: string; subOverride?: string;
}) {
  const T = "#0D3542", R = "#B42318", N = "#C4CFCC";
  let label = labelOverride ?? step.label;
  if (step.key === "checks" && status === "Under review" && step.state === "current") label = "Under review";
  if (step.key === "checks" && step.state === "failed") label = "Declined";
  if (step.key === "sent" && step.state !== "failed") label = "Sent to beneficiary’s bank";
  if (step.state === "failed" && step.key !== "checks") label = step.key === "sent" ? "Sending failed" : "Delivery failed";

  const stopped = status === "Declined" || status === "Reversed";
  const sub = subOverride ?? (step.at ? fmtTime(step.at) : step.state === "current" ? "In progress" : stopped ? "Not sent" : "Pending");

  const dot =
    step.state === "done" ? { bg: T, bd: T } :
    step.state === "failed" ? { bg: R, bd: R } :
    step.state === "current" ? { bg: status === "Under review" ? "#FEF3E2" : "#E4FF1A", bd: T } :
    { bg: "#FFFFFF", bd: N };
  const labelColor = step.state === "failed" ? R : step.state === "pending" ? "#4A6670" : T;
  const weight = step.state === "done" ? 500 : step.state === "pending" ? 400 : 600;

  return (
    <li className="flex gap-3.5" aria-current={step.state === "current" ? "step" : undefined}>
      <div className="flex shrink-0 flex-col items-center">
        <div className="box-border flex h-7 w-7 items-center justify-center rounded-full border-2" style={{ background: dot.bg, borderColor: dot.bd }}>
          {step.state === "done" && <svg width="13" height="13" viewBox="0 0 12 12" aria-hidden="true"><path d="M2.5 6.2l2.2 2.2 4.8-4.8" fill="none" stroke="#E4FF1A" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" /></svg>}
          {step.state === "failed" && <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true"><path d="M3.5 3.5l5 5M8.5 3.5l-5 5" fill="none" stroke="#FFFFFF" strokeWidth={2} strokeLinecap="round" /></svg>}
          {step.state === "current" && <span className="h-2.5 w-2.5 rounded-full bg-teal" />}
        </div>
        <div className="min-h-[30px] w-0.5 flex-1" style={{ background: last ? "transparent" : step.state === "done" ? T : N }} />
      </div>
      <div className="flex flex-col gap-[3px] pb-[22px] pt-[3px]">
        <span className="text-[15px]" style={{ fontWeight: weight, color: labelColor }}>
          {label}
          <span className="sr-only"> ({step.state === "done" ? "done" : step.state === "current" ? "in progress" : step.state === "failed" ? "failed" : "pending"})</span>
        </span>
        <span className="text-[13px] text-teal-grey">{sub}</span>
      </div>
    </li>
  );
}

function Detail({ k, v, sub, strong, mono, last }: { k: string; v: string; sub?: string; strong?: boolean; mono?: boolean; last?: boolean }) {
  return (
    <div className={`flex justify-between gap-4 py-3 ${last ? "" : "border-b border-line-soft"}`}>
      <dt className="shrink-0 text-[14px] text-teal-grey">{k}</dt>
      <dd className={`m-0 text-right ${mono ? "font-mono text-[13px]" : "text-[15px]"} ${strong ? "font-semibold" : ""}`}>
        {v}
        {sub && <div className="text-[13px] text-teal-grey">{sub}</div>}
      </dd>
    </div>
  );
}
