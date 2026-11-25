"use client";
/**
 * S2 Dashboard: available + held balance (polled every 5 s so a bank transfer in shows up fast),
 * virtual account with copy button, last 5 transfers, Send payment CTA.
 */
import Link from "next/link";
import { useCallback, useState } from "react";
import { api } from "@/lib/api";
import { money } from "@/lib/money";
import type { Balance, Page, SmeTransfer } from "@/lib/types";
import { useMe } from "@/components/sme/MeContext";
import { Arcs, Dots, Icon, Sparkle } from "@/components/sme/motifs";
import { CopyButton, EmptyState, ErrorState, Skeleton, TransfersTable, fmtAccount, friendlyError, primaryPill, usePoll } from "@/components/sme/ui";

function greeting() {
  const h = new Date().getHours();
  return h < 12 ? "Good morning" : h < 17 ? "Good afternoon" : "Good evening";
}

export default function DashboardPage() {
  const { me, loading: meLoading, error: meError, reload } = useMe();
  const [balance, setBalance] = useState<Balance | null>(null);
  const [balanceError, setBalanceError] = useState<string | null>(null);
  const [transfers, setTransfers] = useState<SmeTransfer[] | null>(null);
  const [transfersError, setTransfersError] = useState<string | null>(null);

  const loadBalance = useCallback(() => {
    api<Balance>("/balance").then((b) => { setBalance(b); setBalanceError(null); }).catch((e) => setBalanceError(friendlyError(e)));
  }, []);
  const loadTransfers = useCallback(() => {
    api<Page<SmeTransfer>>("/transfers?limit=5").then((r) => { setTransfers(r.items.slice(0, 5)); setTransfersError(null); }).catch((e) => setTransfersError(friendlyError(e)));
  }, []);
  usePoll(loadBalance, 5000);
  usePoll(loadTransfers, 10000);

  const noFunds = balance !== null && BigInt(balance.available) === 0n && BigInt(balance.held) === 0n;
  const held = balance ? BigInt(balance.held) : 0n;
  const inFlight = transfers?.filter((t) => t.status === "Processing" || t.status === "Under review").length ?? 0;
  const completed = transfers?.filter((t) => t.status === "Completed") ?? [];
  const deliveredUsd = completed.reduce((s, t) => s + BigInt(t.usd_amount), 0n);
  const firstName = me ? me.email.split("@")[0].split(/[._-]/)[0] : "";
  const name = firstName ? firstName.charAt(0).toUpperCase() + firstName.slice(1) : "";

  return (
    <>
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="flex flex-col gap-1">
          <h1 className="m-0 text-[26px] font-medium tracking-[-0.01em] sm:text-[30px]">{greeting()}{name ? `, ${name}` : ""}</h1>
          <p className="m-0 text-[14px] text-teal-grey">Your exact rate is locked when you get a quote, and held for 60 seconds.</p>
        </div>
        <Link href="/app/send" className={primaryPill}><Icon name="send" size={18} />Send payment</Link>
      </div>

      {meError && <ErrorState message={meError} onRetry={reload} />}
      {balanceError && <ErrorState message={balanceError} onRetry={loadBalance} />}

      <div className="flex flex-wrap gap-5">
        {/* Available balance */}
        <section aria-label="Balance" className="relative flex min-h-[200px] flex-[1.4_1_340px] flex-col gap-3.5 overflow-hidden rounded-3xl bg-teal p-7 text-white">
          <Arcs size={200} stroke={36} className="-bottom-9 -right-9" arcs={[{ start: 18, color: "#1E4A58" }, { start: 92, color: "#E4FF1A" }]} />
          <div className="relative text-[12px] font-semibold uppercase tracking-[0.08em] text-lime">Available balance</div>
          {balance ? (
            <div className="relative text-[30px] font-medium tracking-[-0.02em] sm:text-[38px]" aria-live="polite">{money("NGN", balance.available)}</div>
          ) : (
            <Skeleton className="relative h-11 w-64 bg-teal-mid" />
          )}
          {balance && (
            <div className="relative mt-auto inline-flex flex-wrap items-center gap-2.5 self-start rounded-full bg-teal-mid px-3.5 py-2 text-[13px]">
              {held > 0n ? "Held for payments in progress" : "Nothing held"}
              <span className="font-semibold text-lime">{money("NGN", balance.held)}</span>
            </div>
          )}
        </section>

        {/* Virtual account */}
        <section aria-label="Fund your account" className="flex flex-[1_1_300px] flex-col gap-3.5 rounded-3xl bg-lime p-7">
          <div className="flex items-center justify-between">
            <div className="text-[12px] font-semibold uppercase tracking-[0.08em]">Fund your account</div>
            <Dots />
          </div>
          {me ? (
            <>
              <div className="flex flex-wrap items-center justify-between gap-3">
                <span className="font-mono text-[22px] font-medium tracking-[0.04em] sm:text-[26px]">{fmtAccount(me.virtual_account.account_number)}</span>
                <CopyButton
                  value={me.virtual_account.account_number}
                  className="inline-flex h-[38px] cursor-pointer items-center gap-1.5 rounded-full bg-teal px-3.5 text-[13px] font-semibold text-lime"
                />
              </div>
              <div className="flex flex-col gap-1.5 text-[14px]">
                <div className="flex justify-between gap-3"><span className="text-teal-mid">Bank</span><span className="text-right font-medium">{me.virtual_account.bank_name}</span></div>
                <div className="flex justify-between gap-3"><span className="text-teal-mid">Account name</span><span className="text-right font-medium">{me.virtual_account.account_name}</span></div>
              </div>
            </>
          ) : meLoading ? (
            <div className="flex flex-col gap-3"><Skeleton className="h-8 w-48 bg-lime-soft" /><Skeleton className="h-4 w-full bg-lime-soft" /><Skeleton className="h-4 w-full bg-lime-soft" /></div>
          ) : null}
        </section>

        {/* Activity summary */}
        <section aria-label="Activity" className="relative flex flex-[0.7_1_220px] flex-col gap-2.5 overflow-hidden rounded-3xl bg-white p-7">
          <Sparkle size={44} color="#E4FF1A" className="absolute right-5 top-5" />
          <div className="text-[12px] font-semibold uppercase tracking-[0.08em] text-teal-grey">Recently delivered</div>
          {transfers ? (
            <>
              <div className="text-[24px] font-medium sm:text-[28px]">{money("USD", deliveredUsd.toString())}</div>
              <div className="text-[14px] text-teal-grey">{completed.length} delivered</div>
              <div className="text-[14px] text-teal-grey">{inFlight} in progress</div>
            </>
          ) : (
            <><Skeleton className="h-8 w-40" /><Skeleton className="h-4 w-24" /></>
          )}
        </section>
      </div>

      {noFunds && (
        <div className="flex flex-wrap items-center gap-4 rounded-3xl border-2 border-dashed border-input bg-white px-6 py-5">
          <Sparkle size={28} />
          <div className="flex min-w-[220px] flex-1 flex-col gap-0.5">
            <span className="text-[15px] font-semibold">No funds yet</span>
            <span className="text-[14px] text-teal-grey">Send naira from any Nigerian bank app to your account number above. It shows here within seconds.</span>
          </div>
          <Link href="/app/funds" className={primaryPill}>How to add funds</Link>
        </div>
      )}

      <section className="flex flex-col overflow-hidden rounded-3xl bg-white">
        <div className="flex items-center justify-between px-7 py-[22px]">
          <h2 className="m-0 text-[18px] font-medium">Recent transfers</h2>
          <Link href="/app/transfers" className="text-[14px] font-semibold text-teal">View all</Link>
        </div>
        {transfersError && <div className="px-7 pb-5"><ErrorState message={transfersError} onRetry={loadTransfers} /></div>}
        {transfers && transfers.length === 0 ? (
          <EmptyState
            title="No transfers yet"
            body="When you pay a supplier, it shows here with its status from received to delivered."
            action={<Link href="/app/send" className={`${primaryPill} mt-2`}>Send your first payment</Link>}
          />
        ) : (
          <TransfersTable items={transfers} loading={!transfers && !transfersError} />
        )}
      </section>
    </>
  );
}
