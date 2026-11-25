/**
 * Public landing page, reproduced from docs/design/project/Landing.dc.html.
 * Server Component: only the nav (active pill) and the FAQ accordion are client components.
 * Motion classes (fx-*) come from ./landing.css, ported verbatim from the mockup.
 */
import Link from "next/link";
import "./landing.css";
import { LandingNav } from "@/components/sme/landing/LandingNav";
import { LandingFaq } from "@/components/sme/landing/LandingFaq";

const HERO_WORDS = ["Pay", "suppliers", "abroad", "from", "your", "naira", "account."];
const RAILS = [
  { code: "USD", rail: "ACH · Wire" }, { code: "EUR", rail: "SEPA" }, { code: "GBP", rail: "Faster Payments" },
  { code: "MXN", rail: "SPEI" }, { code: "BRL", rail: "Pix" }, { code: "COP", rail: "Bre-B" },
];

const Arrow = ({ color = "#E4FF1A", size = 18 }: { color?: string; size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 20 20" aria-hidden="true"><path d="M4 10h12M11 5l5 5-5 5" fill="none" stroke={color} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" /></svg>
);
const Check = ({ color = "#0D3542" }: { color?: string }) => (
  <svg width="11" height="11" viewBox="0 0 12 12" aria-hidden="true"><path d="M2.5 6.2l2.2 2.2 4.8-4.8" fill="none" stroke={color} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" /></svg>
);
const Asterisk = ({ size, color, className = "" }: { size: number; color: string; className?: string }) => (
  <svg className={className} width={size} height={size} viewBox="0 0 48 48" aria-hidden="true">
    <g fill={color}>{[0, 45, 90, 135].map((r) => <rect key={r} x="20" y="2" width="8" height="44" rx="4" transform={`rotate(${r} 24 24)`} />)}</g>
  </svg>
);
const Sparkle = ({ size, color, className = "", style }: { size: number; color: string; className?: string; style?: React.CSSProperties }) => (
  <svg className={className} style={style} width={size} height={size} viewBox="0 0 48 48" aria-hidden="true">
    <path d="M24 0C25.5 15 33 22.5 48 24C33 25.5 25.5 33 24 48C22.5 33 15 25.5 0 24C15 22.5 22.5 15 24 0Z" fill={color} />
  </svg>
);
const Dots = () => (
  <span className="inline-flex gap-1"><span className="h-1.5 w-1.5 bg-teal" /><span className="h-1.5 w-1.5 bg-teal" /><span className="h-1.5 w-1.5 bg-teal" /></span>
);

/** Shared look of the three sticky "step" cards. */
const stepCard = "fx-card fx-stack sticky flex min-h-[360px] flex-wrap items-center gap-10 overflow-hidden rounded-[32px] p-6 sm:p-11";
const stepTitle = "text-[30px] font-medium leading-[36px] tracking-[-0.02em] sm:text-[38px] sm:leading-[44px]";
const btnDark = "fx-btn inline-flex h-14 items-center gap-2.5 rounded-full bg-teal px-7 text-[16px] font-semibold text-lime no-underline";

export default function LandingPage() {
  return (
    <div className="landing-root overflow-x-clip bg-ground text-teal">
      <div className="fx-progress" aria-hidden="true" />
      <LandingNav />

      {/* Hero */}
      <header className="relative overflow-hidden bg-lime px-6 pb-24 pt-[88px]">
        <svg className="fx-float fx-arc absolute -right-[180px] -top-[160px]" width="640" height="640" viewBox="0 0 640 640" aria-hidden="true">
          <path d="M40 640 A600 600 0 0 1 640 40" fill="none" stroke="#F1FF99" strokeWidth={84} />
          <path d="M200 640 A440 440 0 0 1 640 200" fill="none" stroke="#F1FF99" strokeWidth={84} />
        </svg>
        <div id="top" className="fx-hero-out relative mx-auto mb-6 mt-24 flex max-w-[900px] flex-col items-center gap-[26px] text-center">
          <span className="fx-up inline-flex flex-wrap items-center justify-center gap-2 rounded-full bg-teal py-1.5 pl-1.5 pr-3.5 text-[13px] font-medium text-white" style={{ animationDelay: "150ms" }}>
            <span className="rounded-full bg-lime px-2.5 py-[3px] font-semibold text-teal">New</span>Pay in USD, EUR, GBP, MXN, BRL and COP
          </span>
          <h1 className="m-0 text-[44px] font-medium leading-[50px] tracking-[-0.03em] sm:text-[72px] sm:leading-[78px]">
            {HERO_WORDS.map((w, i) => (
              <span key={w}>
                <span className="fx-word" style={{ animationDelay: `${260 + i * 70}ms` }}>{w}</span>
                {i < HERO_WORDS.length - 1 ? " " : ""}
              </span>
            ))}
          </h1>
          <p className="fx-up m-0 max-w-[620px] text-[17px] leading-[28px] text-teal-mid sm:text-[19px] sm:leading-[30px]" style={{ animationDelay: "820ms" }}>
            Fund by bank transfer, lock a rate for 60 seconds, and track every payment to delivery. If a payment can’t be delivered, your naira comes back.
          </p>
          <div className="fx-up flex flex-wrap justify-center gap-3" style={{ animationDelay: "960ms" }}>
            <Link href="/register" className={btnDark}>Open a business account<Arrow /></Link>
            <a href="#how" className="fx-btn inline-flex h-14 items-center rounded-full border-[1.5px] border-teal px-[26px] text-[16px] font-medium text-teal no-underline">See how it works</a>
          </div>
        </div>
      </header>

      {/* Currencies strip */}
      <section id="currencies" aria-label="Payout currencies" className="overflow-hidden bg-teal px-6 py-7 text-white">
        <div className="fx-slide mx-auto flex max-w-[1180px] flex-wrap items-center justify-between gap-x-7 gap-y-3">
          <span className="text-[13px] font-semibold uppercase tracking-[0.08em] text-lime">Where your suppliers get paid</span>
          {RAILS.map((r) => (
            <span key={r.code} className="inline-flex items-baseline gap-2">
              <span className="text-[20px] font-semibold">{r.code}</span>
              <span className="text-[13px] text-nav-muted">{r.rail}</span>
            </span>
          ))}
        </div>
      </section>

      {/* How it works */}
      <section id="how" className="px-4 py-[104px] sm:px-6">
        <div className="mx-auto flex max-w-[1180px] flex-col gap-12">
          <div className="fx-reveal flex flex-wrap items-end justify-between gap-6">
            <h2 className="m-0 max-w-[620px] text-[34px] font-medium leading-[42px] tracking-[-0.02em] sm:text-[48px] sm:leading-[56px]">Three steps. No new tools for your finance team.</h2>
            <p className="m-0 max-w-[400px] text-[16px] leading-[26px] text-teal-grey">If your team can make a bank transfer, they can pay a supplier in Rotterdam, Birmingham or São Paulo.</p>
          </div>

          <div className="flex flex-col gap-7">
            {/* Step 01 */}
            <div className={`${stepCard} top-[112px] bg-lime shadow-[0_-16px_40px_rgba(13,53,66,0.10)]`}>
              <svg className="fx-float absolute -bottom-[190px] -left-[150px]" width="420" height="420" viewBox="0 0 420 420" aria-hidden="true"><path d="M0 60 A360 360 0 0 1 360 420" fill="none" stroke="#F1FF99" strokeWidth={70} /></svg>
              <div className="relative flex flex-[1_1_300px] flex-col gap-4">
                <span className="self-start rounded-full bg-teal px-3.5 py-1.5 text-[13px] font-semibold text-lime">Step 01</span>
                <span className={stepTitle}>Fund your account</span>
                <span className="max-w-[440px] text-[16px] leading-[26px] text-teal-mid">You get your own naira account number. Pay into it from any Nigerian bank app and it arrives in seconds.</span>
                <div className="mt-1 flex flex-wrap gap-2">
                  {["Any Nigerian bank app", "Instant bank transfer", "Email receipt"].map((t) => <span key={t} className="rounded-full border-[1.5px] border-teal px-3.5 py-[7px] text-[13px] font-medium">{t}</span>)}
                </div>
              </div>
              <div aria-hidden="true" className="relative flex flex-[1_1_300px] justify-center">
                <div className="flex w-full max-w-[400px] flex-col gap-4 rounded-[26px] bg-white p-[22px] shadow-[0_24px_50px_rgba(13,53,66,0.18)]" style={{ rotate: "-2deg" }}>
                  <div className="flex items-center justify-between"><span className="text-[12px] font-semibold uppercase tracking-[0.08em] text-teal-grey">Your naira account</span><Dots /></div>
                  <div className="flex items-center justify-between rounded-2xl bg-ground px-4 py-3.5"><span className="font-mono text-[20px] font-medium tracking-[0.05em] sm:text-[22px]">9920 417 362</span><span className="rounded-full bg-teal px-3 py-1.5 text-[12px] font-semibold text-lime">Copy</span></div>
                  <div className="fx-pop flex items-center gap-3 rounded-[18px] bg-teal p-3.5 text-white">
                    <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-lime"><svg width="18" height="18" viewBox="0 0 20 20"><path d="M15.5 4.5L4.5 15.5M12 15.5H4.5V8" fill="none" stroke="#0D3542" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" /></svg></span>
                    <span className="flex min-w-0 flex-1 flex-col"><span className="text-[13px] font-semibold">Money in · Adebayo Imports Ltd</span><span className="text-[12px] text-nav-muted">Just now</span></span>
                    <span className="whitespace-nowrap text-[14px] font-semibold text-lime">+ NGN 5,000,000</span>
                  </div>
                  <div className="flex justify-between text-[13px] text-teal-grey"><span>Available balance</span><span className="font-semibold text-teal">NGN 12,840,250.00</span></div>
                </div>
              </div>
            </div>

            {/* Step 02 */}
            <div className={`${stepCard} top-[136px] bg-teal text-white shadow-[0_-16px_40px_rgba(13,53,66,0.16)]`}>
              <svg className="fx-float absolute -right-[160px] -top-[170px]" width="420" height="420" viewBox="0 0 420 420" aria-hidden="true"><path d="M0 60 A360 360 0 0 1 360 420" fill="none" stroke="#1E4A58" strokeWidth={70} /></svg>
              <div className="relative flex flex-[1_1_300px] flex-col gap-4">
                <span className="self-start rounded-full bg-lime px-3.5 py-1.5 text-[13px] font-semibold text-teal">Step 02</span>
                <span className={stepTitle}>Lock your rate</span>
                <span className="max-w-[440px] text-[16px] leading-[26px] text-teal-mist">Pick the currency your supplier needs. You see the rate, the fee and the exact naira total before you confirm.</span>
                <div className="mt-1 flex flex-wrap gap-2">
                  {["6 currencies", "Rate held 60 seconds", "Fee shown upfront"].map((t) => <span key={t} className="rounded-full border-[1.5px] border-[#4A7684] px-3.5 py-[7px] text-[13px] font-medium">{t}</span>)}
                </div>
              </div>
              <div aria-hidden="true" className="relative flex flex-[1_1_300px] justify-center">
                <div className="flex w-full max-w-[400px] flex-col gap-4 rounded-[26px] bg-white p-[22px] text-teal shadow-[0_24px_50px_rgba(0,0,0,0.28)]" style={{ rotate: "2deg" }}>
                  <div className="grid grid-cols-6 gap-1.5">
                    {RAILS.map((r) => <span key={r.code} className={`rounded-full py-2 text-center text-[12px] font-semibold ${r.code === "EUR" ? "bg-teal text-lime" : "bg-ground"}`}>{r.code}</span>)}
                  </div>
                  <div className="flex flex-col gap-0.5"><span className="text-[12px] text-teal-grey">Supplier receives, by SEPA</span><span className="text-[28px] font-medium tracking-[-0.02em]">EUR 2,000.00</span></div>
                  <div className="flex flex-col gap-2">
                    <div className="flex justify-between text-[12px]"><span className="text-teal-grey">EUR 1 = NGN 1,835.00</span><span className="font-semibold">Rate held 0:42</span></div>
                    <div className="h-2 overflow-hidden rounded-full bg-ground"><div className="fx-bar h-full w-[70%] rounded-full bg-teal" /></div>
                  </div>
                  <div className="flex items-center justify-between rounded-2xl bg-lime px-4 py-3.5"><span className="text-[13px] font-medium">You pay, fee included</span><span className="text-[16px] font-semibold">NGN 3,677,500.00</span></div>
                </div>
              </div>
            </div>

            {/* Step 03 */}
            <div className={`${stepCard} top-[160px] bg-white shadow-[0_-16px_40px_rgba(13,53,66,0.10)]`}>
              <Sparkle className="fx-spin absolute right-9 top-[30px]" size={90} color="#E4FF1A" />
              <div className="relative flex flex-[1_1_300px] flex-col gap-4">
                <span className="self-start rounded-full bg-teal px-3.5 py-1.5 text-[13px] font-semibold text-lime">Step 03</span>
                <span className={stepTitle}>Track it to delivery</span>
                <span className="max-w-[440px] text-[16px] leading-[26px] text-teal-grey">Follow each payment from received to delivered, and download the receipt for your books.</span>
                <div className="mt-1 flex flex-wrap gap-2">
                  {["Live status", "Downloadable receipt", "Full refund if undeliverable"].map((t) => <span key={t} className="rounded-full bg-ground px-3.5 py-[7px] text-[13px] font-medium">{t}</span>)}
                </div>
              </div>
              <div aria-hidden="true" className="relative flex flex-[1_1_300px] justify-center">
                <div className="flex w-full max-w-[400px] flex-col gap-1 rounded-[26px] bg-teal p-6 text-white shadow-[0_24px_50px_rgba(13,53,66,0.25)]" style={{ rotate: "-2deg" }}>
                  <div className="mb-3.5 flex items-center justify-between gap-2"><span className="text-[14px] font-semibold">GBP 3,200.00 to Midlands Tooling</span><span className="rounded-full bg-lime px-3 py-[5px] text-[12px] font-semibold text-teal">Completed</span></div>
                  {[["Received", "10:02"], ["Checks passed", "10:02"], ["Sent by Faster Payments", "10:03"]].map(([l, t]) => (
                    <div key={l} className="flex gap-3">
                      <div className="flex flex-col items-center"><span className="flex h-[22px] w-[22px] items-center justify-center rounded-full bg-lime"><Check /></span><span className="h-5 w-0.5 bg-lime" /></div>
                      <span className="pt-0.5 text-[13px]">{l} <span className="text-nav-muted">· {t}</span></span>
                    </div>
                  ))}
                  <div className="flex gap-3">
                    <span className="fx-pop flex h-[22px] w-[22px] items-center justify-center rounded-full bg-lime"><Check /></span>
                    <span className="pt-0.5 text-[13px] font-semibold">Delivered <span className="font-normal text-nav-muted">· 10:04</span></span>
                  </div>
                  <div className="mt-4 flex items-center justify-between rounded-[14px] bg-teal-mid px-3.5 py-3">
                    <span className="text-[13px]">Receipt HSG-20261125-000188</span>
                    <span className="inline-flex items-center gap-1.5 text-[12px] font-semibold text-lime">
                      <svg width="14" height="14" viewBox="0 0 20 20"><path d="M10 3v10M6 9l4 4 4-4M4 16h12" fill="none" stroke="#E4FF1A" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" /></svg>PDF
                    </span>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Why */}
      <section id="why" className="px-4 pb-[104px] sm:px-6">
        <div className="mx-auto flex max-w-[1180px] flex-wrap gap-5">
          <div className="fx-reveal relative flex min-h-[380px] flex-[1_1_320px] flex-col gap-[18px] overflow-hidden rounded-[32px] bg-teal p-8 text-white sm:p-11">
            <svg className="fx-arc-rot absolute -bottom-[70px] -right-[70px]" width="300" height="300" viewBox="0 0 300 300" aria-hidden="true">
              <path d="M26 300 A274 274 0 0 1 300 26" fill="none" stroke="#1E4A58" strokeWidth={52} />
              <path d="M134 300 A166 166 0 0 1 300 134" fill="none" stroke="#E4FF1A" strokeWidth={52} />
            </svg>
            <span className="relative text-[13px] font-semibold uppercase tracking-[0.08em] text-lime">Why it matters</span>
            <span className="fx-zoom relative origin-left text-[60px] font-medium leading-[66px] tracking-[-0.03em] sm:text-[76px] sm:leading-[80px]">8.46%</span>
            <p className="relative m-0 max-w-[420px] text-[17px] leading-[27px] text-teal-mist">Sub-Saharan Africa is the most expensive region in the world to send money to, at 8.46% on average (World Bank, 2025). Correspondent bank payments also take two to five business days.</p>
          </div>
          <div className="fx-reveal flex flex-[1_1_320px] flex-col gap-5">
            <div className="fx-card flex flex-1 items-start gap-5 rounded-[28px] bg-white p-8">
              <svg width="44" height="44" viewBox="0 0 20 20" aria-hidden="true" className="shrink-0"><path d="M10 2.5l6 2.5v4.5c0 3.8-2.6 6.6-6 8-3.4-1.4-6-4.2-6-8V5z" fill="#E4FF1A" stroke="#0D3542" strokeWidth={1.4} strokeLinejoin="round" /></svg>
              <div className="flex flex-col gap-1.5"><span className="text-[20px] font-semibold">Checked before money moves</span><span className="text-[15px] leading-6 text-teal-grey">Every business is verified, and every beneficiary is screened when added and again before each payment.</span></div>
            </div>
            <div className="fx-card flex flex-1 items-start gap-5 rounded-[28px] bg-lime p-8">
              <Asterisk className="fx-spin shrink-0" size={44} color="#0D3542" />
              <div className="flex flex-col gap-1.5"><span className="text-[20px] font-semibold">Nothing gets stuck</span><span className="text-[15px] leading-6 text-teal-mid">A payment is either delivered or reversed in full, fee included. You never have to chase money that is in limbo.</span></div>
            </div>
          </div>
        </div>
      </section>

      {/* FAQ */}
      <section id="faq" className="px-4 pb-[104px] sm:px-6">
        <div className="mx-auto flex max-w-[900px] flex-col gap-7">
          <h2 className="fx-reveal m-0 text-center text-[34px] font-medium leading-[42px] tracking-[-0.02em] sm:text-[44px] sm:leading-[52px]">Questions businesses ask</h2>
          <LandingFaq />
        </div>
      </section>

      {/* CTA */}
      <section className="px-4 pb-24 sm:px-6">
        <div className="fx-cta relative mx-auto flex max-w-[1180px] flex-wrap items-center justify-between gap-8 overflow-hidden rounded-[40px] bg-lime px-6 py-12 sm:px-12 sm:py-16">
          <svg className="fx-float absolute -bottom-[150px] -left-[110px]" width="360" height="360" viewBox="0 0 360 360" aria-hidden="true"><path d="M0 40 A320 320 0 0 1 320 360" fill="none" stroke="#F1FF99" strokeWidth={64} /></svg>
          <h2 className="relative m-0 max-w-[620px] text-[36px] font-medium leading-[42px] tracking-[-0.02em] sm:text-[52px] sm:leading-[58px]">Your next supplier payment, without the wait.</h2>
          <div className="relative flex flex-col gap-3">
            <Link href="/register" className={`${btnDark} h-[58px] px-[30px]`}>Open a business account<Arrow /></Link>
            <span className="text-center text-[13px] text-teal-mid">Verification usually takes one working day.</span>
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className="bg-teal px-6 py-12 text-teal-mist">
        <div className="mx-auto flex max-w-[1180px] flex-wrap items-start justify-between gap-6">
          <div className="flex max-w-[420px] flex-col gap-3">
            <div className="flex items-center gap-2.5 text-white">
              <svg width="30" height="30" viewBox="0 0 48 48" aria-hidden="true"><rect width="48" height="48" rx="24" fill="#E4FF1A" /><g fill="#0D3542">{[0, 45, 90, 135].map((r) => <rect key={r} x="21" y="9" width="6" height="30" rx="3" transform={`rotate(${r} 24 24)`} />)}</g></svg>
              <span className="font-semibold">HSG Business</span>
            </div>
            <span className="text-[13px] leading-[21px]">A final-year project prototype, Miva Open University. Payouts run through licensed partners in sandbox. No real money moves.</span>
          </div>
          <div className="flex flex-wrap gap-12 text-[14px]">
            <div className="flex flex-col gap-2.5">
              <span className="font-semibold text-lime">Product</span>
              <a href="#how" className="text-teal-mist no-underline hover:text-white">How it works</a>
              <a href="#why" className="text-teal-mist no-underline hover:text-white">Why HSG</a>
              <a href="#faq" className="text-teal-mist no-underline hover:text-white">FAQ</a>
            </div>
            <div className="flex flex-col gap-2.5">
              <span className="font-semibold text-lime">Account</span>
              <Link href="/login" className="text-teal-mist no-underline hover:text-white">Sign in</Link>
              <Link href="/register" className="text-teal-mist no-underline hover:text-white">Open an account</Link>
            </div>
          </div>
        </div>
      </footer>
    </div>
  );
}
