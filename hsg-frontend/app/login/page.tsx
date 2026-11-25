"use client";
/**
 * S1 Sign in. POST /auth/login, store the session, then route by role:
 * SME -> /app, OPERATOR -> /ops. Operators use the same form.
 */
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { api, ApiError, session } from "@/lib/api";
import type { LoginResponse } from "@/lib/types";
import { Mark } from "@/components/ui/Mark";
import { Arcs, Icon, Sparkle } from "@/components/sme/motifs";
import { inputCls } from "@/components/sme/ui";

const POINTS = ["Your own naira account number", "Rate, fee and total before you confirm", "If it can’t be delivered, your naira comes back"];

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const res = await api<LoginResponse>("/auth/login", { method: "POST", json: { email: email.trim(), password } });
      session.set(res.token, res.role);
      router.replace(res.role === "OPERATOR" ? "/ops" : "/app");
    } catch (err) {
      setError(
        err instanceof ApiError && err.status === 401
          ? "That email and password don’t match. Check both and try again."
          : "We couldn’t sign you in right now. Please try again in a moment.",
      );
      setBusy(false);
    }
  }

  return (
    <div className="flex min-h-screen flex-wrap bg-ground">
      {/* Lime brand panel */}
      <div className="relative flex flex-[1_1_420px] flex-col justify-between gap-10 overflow-hidden bg-lime px-6 py-10 sm:px-14 sm:py-12">
        <Arcs size={420} stroke={64} className="-right-[110px] -top-[110px]" arcs={[{ start: 30, color: "#F1FF99" }, { start: 150, color: "#F1FF99" }]} />
        <Link href="/" className="relative flex items-center gap-3 no-underline">
          <Mark size={36} />
          <span className="text-[18px] font-semibold text-teal">HSG Business</span>
        </Link>
        <div className="relative flex max-w-[540px] flex-col gap-5">
          <h1 className="m-0 text-[36px] font-medium leading-[44px] tracking-[-0.02em] sm:text-[52px] sm:leading-[60px]">Pay suppliers abroad from your naira account.</h1>
          <p className="m-0 text-[16px] leading-[26px] text-teal-mid">Fund by bank transfer, lock a rate for 60 seconds, and track every payment to delivery. One account, one statement, no new tools for your finance team.</p>
        </div>
        <div className="relative flex max-w-[460px] flex-col gap-2.5">
          {POINTS.map((p, i) => (
            <div key={p} className="flex items-center gap-3.5 rounded-full bg-teal py-2.5 pl-2.5 pr-5 text-white">
              <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-lime text-[14px] font-semibold text-teal">0{i + 1}</span>
              <span className="text-[14px] leading-5">{p}</span>
            </div>
          ))}
        </div>
      </div>

      {/* Form */}
      <div className="flex min-w-0 flex-[999_1_560px] items-center justify-center px-6 py-14">
        <div className="flex w-full max-w-[420px] flex-col gap-[26px]">
          <div className="flex flex-col gap-1.5">
            <h2 className="m-0 text-[30px] font-medium">Sign in</h2>
            <p className="m-0 text-[15px] text-teal-grey">Use the email your business registered with.</p>
          </div>

          {error && (
            <div role="alert" className="flex gap-2.5 rounded-[14px] border border-critical-line bg-critical-bg px-4 py-3 text-[14px] leading-5 text-critical">
              <Icon name="alert" />
              <span>{error}</span>
            </div>
          )}

          <form onSubmit={submit} className="flex flex-col gap-[18px]" noValidate>
            <div className="flex flex-col gap-2">
              <label htmlFor="email" className="text-[14px] font-medium">Work email</label>
              <input id="email" type="email" autoComplete="username" required value={email} onChange={(e) => setEmail(e.target.value)} className={inputCls} />
            </div>
            <div className="flex flex-col gap-2">
              <div className="flex items-baseline justify-between">
                <label htmlFor="password" className="text-[14px] font-medium">Password</label>
                <span className="text-[13px] text-teal-grey">Forgot it? Contact support.</span>
              </div>
              <input id="password" type="password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} className={inputCls} />
            </div>
            <button
              type="submit"
              disabled={busy || !email || !password}
              className="flex h-[52px] cursor-pointer items-center justify-center gap-2.5 rounded-full bg-teal text-[15px] font-semibold text-lime transition hover:bg-teal-console disabled:cursor-not-allowed disabled:opacity-60"
            >
              {busy ? "Signing in…" : "Sign in"}
              {!busy && <Icon name="arrow" size={18} />}
            </button>
          </form>

          <div className="flex gap-3 rounded-[18px] bg-white px-[18px] py-4 text-[14px] leading-[21px] text-teal-grey">
            <Sparkle size={22} />
            <span>
              New business? <Link href="/register" className="font-semibold text-teal underline">Open an account</Link>. Your naira account number is ready at once; payments abroad unlock after we verify your company, usually within one working day.
            </span>
          </div>

          <div className="border-t border-line pt-[18px] text-[14px] text-teal-grey">
            Gateway staff: <button type="button" onClick={() => document.getElementById("email")?.focus()} className="cursor-pointer font-semibold text-teal underline">operator sign-in</button> uses this same form.
          </div>
        </div>
      </div>
    </div>
  );
}
