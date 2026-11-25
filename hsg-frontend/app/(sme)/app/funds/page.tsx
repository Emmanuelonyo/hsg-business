"use client";
/** S6 Add funds: the SME's own naira account number to fund by bank transfer, plus live balance. */
import Link from "next/link";
import { useCallback, useState } from "react";
import { api } from "@/lib/api";
import { money } from "@/lib/money";
import type { Balance } from "@/lib/types";
import { useMe } from "@/components/sme/MeContext";
import { Arcs, Sparkle } from "@/components/sme/motifs";
import { CopyButton, ErrorState, PageHeader, Skeleton, fmtAccount, friendlyError, primaryPill, usePoll } from "@/components/sme/ui";

const STEPS = [
  { title: "Transfer from your bank app", body: "Any Nigerian bank, any amount, by instant transfer.", lime: true },
  { title: "We credit you in seconds", body: "Your available balance updates on its own; no need to refresh.", lime: false },
  { title: "Send it abroad", body: "Your available balance is ready for your next payment.", lime: false },
];

export default function FundsPage() {
  const { me, loading, error, reload } = useMe();
  const [balance, setBalance] = useState<Balance | null>(null);
  const [balanceError, setBalanceError] = useState<string | null>(null);
  const loadBalance = useCallback(() => {
    api<Balance>("/balance").then((b) => { setBalance(b); setBalanceError(null); }).catch((e) => setBalanceError(friendlyError(e)));
  }, []);
  usePoll(loadBalance, 5000);

  const va = me?.virtual_account;
  const shareText = va ? `${va.account_name}\n${va.bank_name}\nAccount number: ${va.account_number}` : "";

  return (
    <>
      <PageHeader title="Add funds" sub="Send naira from any Nigerian bank app to your business account below. It arrives in seconds." />
      {error && <ErrorState message={error} onRetry={reload} />}

      <div className="flex flex-wrap gap-5">
        <section aria-label="Your business account" className="relative flex flex-[1.5_1_420px] flex-col gap-[22px] overflow-hidden rounded-[28px] bg-teal p-6 text-white sm:p-8">
          <Arcs size={280} stroke={48} className="-bottom-[60px] -right-[60px]" arcs={[{ start: 24, color: "#1E4A58" }, { start: 126, color: "#E4FF1A" }]} />
          <span className="relative self-start rounded-full bg-lime px-3.5 py-1.5 text-[12px] font-semibold text-teal">Your business account · NGN</span>
          {va ? (
            <>
              <div className="relative flex flex-col gap-1">
                <span className="text-[13px] text-teal-mist">Account number</span>
                <span className="font-mono text-[30px] font-medium tracking-[0.06em] sm:text-[44px]">{fmtAccount(va.account_number)}</span>
              </div>
              <div className="relative grid max-w-[520px] grid-cols-1 gap-4 sm:grid-cols-2">
                <div className="flex flex-col gap-0.5"><span className="text-[13px] text-teal-mist">Bank</span><span className="text-[16px] font-medium">{va.bank_name}</span></div>
                <div className="flex flex-col gap-0.5"><span className="text-[13px] text-teal-mist">Account name</span><span className="text-[16px] font-medium">{va.account_name}</span></div>
              </div>
              <div className="relative flex flex-wrap gap-2.5">
                <CopyButton
                  value={va.account_number}
                  label="Copy account number"
                  className="inline-flex h-12 cursor-pointer items-center gap-2 rounded-full bg-lime px-[22px] text-[15px] font-semibold text-teal"
                />
                <CopyButton
                  value={shareText}
                  label="Copy all details"
                  copiedLabel="Details copied"
                  className="inline-flex h-12 cursor-pointer items-center gap-2 rounded-full border-[1.5px] border-[#4A7684] bg-transparent px-[22px] text-[15px] font-medium text-white"
                />
              </div>
            </>
          ) : loading ? (
            <div className="relative flex flex-col gap-4"><Skeleton className="h-12 w-72 bg-teal-mid" /><Skeleton className="h-10 w-96 max-w-full bg-teal-mid" /></div>
          ) : null}
        </section>

        <section aria-label="How it works" className="flex flex-[1_1_300px] flex-col gap-3">
          {STEPS.map((s, i) => (
            <div key={s.title} className={`flex items-start gap-4 rounded-[22px] px-[22px] py-5 ${s.lime ? "bg-lime" : "bg-white"}`}>
              <span className="text-[28px] font-medium leading-8">0{i + 1}</span>
              <div className="flex flex-col gap-0.5">
                <span className="text-[15px] font-semibold">{s.title}</span>
                <span className={`text-[13px] leading-5 ${s.lime ? "text-teal-mid" : "text-teal-grey"}`}>{s.body}</span>
              </div>
            </div>
          ))}
        </section>
      </div>

      <div className="flex items-center gap-3 rounded-[18px] bg-white px-[18px] py-3.5 text-[13px] leading-5 text-teal-grey">
        <Sparkle size={22} />
        <span>This account accepts naira only. Receiving payments from customers abroad is not available yet.</span>
      </div>

      <section aria-label="Balance" className="flex flex-wrap items-center justify-between gap-4 rounded-3xl bg-white px-7 py-[22px]">
        <div className="flex flex-col gap-1">
          <h2 className="m-0 text-[18px] font-medium">Available balance</h2>
          <span className="text-[13px] text-teal-grey">Updates automatically every few seconds.</span>
        </div>
        {balanceError ? (
          <ErrorState message={balanceError} onRetry={loadBalance} />
        ) : balance ? (
          <div className="flex flex-col items-end gap-0.5 text-right">
            <span className="text-[26px] font-medium" aria-live="polite">{money("NGN", balance.available)}</span>
            {BigInt(balance.held) > 0n && <span className="text-[13px] text-teal-grey">Held: {money("NGN", balance.held)}</span>}
          </div>
        ) : (
          <Skeleton className="h-8 w-52" />
        )}
        {balance && BigInt(balance.available) > 0n && <Link href="/app/send" className={primaryPill}>Send payment</Link>}
      </section>
    </>
  );
}
