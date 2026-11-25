"use client";
/**
 * Open an account (self-service onboarding). POST /auth/register creates the business with
 * verification PENDING plus its naira account number, and signs the user in. The business can
 * fund its account straight away; sending unlocks once an operator verifies it (review queue, KYB tab).
 */
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { api, ApiError, session } from "@/lib/api";
import type { LoginResponse } from "@/lib/types";
import { Mark } from "@/components/ui/Mark";
import { Arcs, Icon, Sparkle } from "@/components/sme/motifs";
import { inputCls } from "@/components/sme/ui";

const STEPS = ["Tell us about your business", "Get your naira account number at once", "Send payments once we’ve checked your documents"];

type Field = "legal_name" | "rc_number" | "address" | "contact_name" | "email" | "password" | "confirm";
type Form = Record<Field, string>;
const EMPTY: Form = { legal_name: "", rc_number: "", address: "", contact_name: "", email: "", password: "", confirm: "" };

/** Mirrors the server rules so most mistakes are caught before submitting. */
function validate(f: Form): Partial<Record<Field, string>> {
  const e: Partial<Record<Field, string>> = {};
  if (f.legal_name.trim().length < 3) e.legal_name = "Enter the business name as registered with CAC.";
  if (!/^(RC|BN|IT)?\d{5,8}$/i.test(f.rc_number.replace(/\s+/g, ""))) e.rc_number = "Enter the CAC number, e.g. RC1234567.";
  if (f.address.trim().length < 8) e.address = "Enter the registered business address.";
  if (f.contact_name.trim().length < 2) e.contact_name = "Enter your full name.";
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(f.email.trim())) e.email = "Enter a valid work email.";
  if (f.password.length < 8) e.password = "Use at least 8 characters.";
  else if (!/[A-Za-z]/.test(f.password) || !/\d/.test(f.password)) e.password = "Use at least one letter and one number.";
  if (f.confirm !== f.password) e.confirm = "Passwords don’t match.";
  return e;
}

export default function RegisterPage() {
  const router = useRouter();
  const [form, setForm] = useState<Form>(EMPTY);
  const [touched, setTouched] = useState<Partial<Record<Field, boolean>>>({});
  const [submitted, setSubmitted] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const errors = validate(form);
  const show = (f: Field) => (submitted || touched[f]) && errors[f];
  const set = (f: Field) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setForm((s) => ({ ...s, [f]: e.target.value }));
  const blur = (f: Field) => () => setTouched((t) => ({ ...t, [f]: true }));

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (busy) return;
    setSubmitted(true);
    setError(null);
    if (Object.keys(errors).length) return;
    setBusy(true);
    try {
      const { confirm: _confirm, ...body } = form;
      void _confirm;
      const res = await api<LoginResponse>("/auth/register", { method: "POST", json: { ...body, email: body.email.trim() } });
      session.set(res.token, res.role);
      router.replace("/app");
    } catch (err) {
      if (err instanceof ApiError && err.code === "CONFLICT") setError("An account with this email already exists. Sign in instead.");
      else if (err instanceof ApiError && (err.code === "VALIDATION_ERROR" || err.code === "RATE_LIMITED")) setError(err.message);
      else setError("We couldn’t open your account right now. Please try again in a moment.");
      setBusy(false);
    }
  }

  const field = (f: Field, label: string, input: React.ReactNode, hint?: string) => (
    <div className="flex flex-col gap-2">
      <label htmlFor={f} className="text-[14px] font-medium">{label}</label>
      {input}
      {show(f) ? (
        <span id={`${f}-err`} className="text-[13px] text-critical">{errors[f]}</span>
      ) : hint ? (
        <span className="text-[13px] text-teal-grey">{hint}</span>
      ) : null}
    </div>
  );
  const inputProps = (f: Field) => ({
    id: f, value: form[f], onChange: set(f), onBlur: blur(f),
    "aria-invalid": Boolean(show(f)), "aria-describedby": show(f) ? `${f}-err` : undefined,
    className: `${inputCls} ${show(f) ? "!border-critical" : ""}`,
  });

  return (
    <div className="flex min-h-screen flex-wrap bg-ground">
      {/* Lime brand panel (same language as Sign in) */}
      <div className="relative flex flex-[1_1_420px] flex-col justify-between gap-10 overflow-hidden bg-lime px-6 py-10 sm:px-14 sm:py-12">
        <Arcs size={420} stroke={64} className="-right-[110px] -top-[110px]" arcs={[{ start: 30, color: "#F1FF99" }, { start: 150, color: "#F1FF99" }]} />
        <Link href="/" className="relative flex items-center gap-3 no-underline">
          <Mark size={36} />
          <span className="text-[18px] font-semibold text-teal">HSG Business</span>
        </Link>
        <div className="relative flex max-w-[540px] flex-col gap-5">
          <h1 className="m-0 text-[36px] font-medium leading-[44px] tracking-[-0.02em] sm:text-[52px] sm:leading-[60px]">Open a business account in minutes.</h1>
          <p className="m-0 text-[16px] leading-[26px] text-teal-mid">Your naira account number is ready as soon as you sign up, so you can fund it right away. We verify your company before your first payment abroad.</p>
        </div>
        <div className="relative flex max-w-[460px] flex-col gap-2.5">
          {STEPS.map((p, i) => (
            <div key={p} className="flex items-center gap-3.5 rounded-full bg-teal py-2.5 pl-2.5 pr-5 text-white">
              <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-lime text-[14px] font-semibold text-teal">0{i + 1}</span>
              <span className="text-[14px] leading-5">{p}</span>
            </div>
          ))}
        </div>
      </div>

      {/* Form */}
      <div className="flex min-w-0 flex-[999_1_560px] items-center justify-center px-6 py-14">
        <div className="flex w-full max-w-[460px] flex-col gap-[26px]">
          <div className="flex flex-col gap-1.5">
            <h2 className="m-0 text-[30px] font-medium">Open an account</h2>
            <p className="m-0 text-[15px] text-teal-grey">For businesses registered in Nigeria.</p>
          </div>

          {error && (
            <div role="alert" className="flex gap-2.5 rounded-[14px] border border-critical-line bg-critical-bg px-4 py-3 text-[14px] leading-5 text-critical">
              <Icon name="alert" />
              <span>
                {error}{" "}
                {error.includes("Sign in") && <Link href="/login" className="font-semibold text-critical underline">Go to sign in</Link>}
              </span>
            </div>
          )}

          <form onSubmit={submit} className="flex flex-col gap-[18px]" noValidate>
            <fieldset className="m-0 flex flex-col gap-[18px] border-0 p-0">
              <legend className="mb-1 text-[12px] font-semibold uppercase tracking-[0.08em] text-teal-grey">Your business</legend>
              {field("legal_name", "Registered business name", <input type="text" autoComplete="organization" {...inputProps("legal_name")} />)}
              {field("rc_number", "CAC registration number", <input type="text" placeholder="RC1234567" {...inputProps("rc_number")} />)}
              {field("address", "Registered address", <input type="text" autoComplete="street-address" {...inputProps("address")} />)}
            </fieldset>

            <fieldset className="m-0 flex flex-col gap-[18px] border-0 border-t border-line p-0 pt-[18px]">
              <legend className="mb-1 text-[12px] font-semibold uppercase tracking-[0.08em] text-teal-grey">Your sign-in</legend>
              {field("contact_name", "Your full name", <input type="text" autoComplete="name" {...inputProps("contact_name")} />)}
              {field("email", "Work email", <input type="email" autoComplete="username" {...inputProps("email")} />)}
              <div className="grid grid-cols-1 gap-[18px] sm:grid-cols-2">
                {field("password", "Password", <input type="password" autoComplete="new-password" {...inputProps("password")} />, "8+ characters, a letter and a number")}
                {field("confirm", "Confirm password", <input type="password" autoComplete="new-password" {...inputProps("confirm")} />)}
              </div>
            </fieldset>

            <button
              type="submit"
              disabled={busy}
              className="mt-1 flex h-[52px] cursor-pointer items-center justify-center gap-2.5 rounded-full bg-teal text-[15px] font-semibold text-lime transition hover:bg-teal-console disabled:cursor-not-allowed disabled:opacity-60"
            >
              {busy ? "Opening your account…" : "Open account"}
              {!busy && <Icon name="arrow" size={18} />}
            </button>
          </form>

          <div className="flex gap-3 rounded-[18px] bg-white px-[18px] py-4 text-[14px] leading-[21px] text-teal-grey">
            <Sparkle size={22} />
            <span>We check your company details against CAC records and sanctions lists, usually within one working day. You can sign in and fund your account while we check.</span>
          </div>

          <div className="border-t border-line pt-[18px] text-[14px] text-teal-grey">
            Already have an account? <Link href="/login" className="font-semibold text-teal underline">Sign in</Link>
          </div>
        </div>
      </div>
    </div>
  );
}
