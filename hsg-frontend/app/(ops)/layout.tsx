"use client";
/**
 * Operator console shell (docs/design/project/Ops-*.dc.html): console-teal rail on the left,
 * lime pill for the active page, amber badge with the review-queue count, content on the ground colour.
 * Guard: only an OPERATOR session may stay here; anything else goes to /login.
 */
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState, type ReactNode } from "react";
import { api, session } from "@/lib/api";
import { Mark } from "@/components/ui/Mark";
import type { ReviewQueue } from "@/components/ops/types";

const ICONS: Record<string, ReactNode> = {
  overview: <path d="M4 4h5v5H4zM11 4h5v5h-5zM4 11h5v5H4zM11 11h5v5h-5z" fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinejoin="round" />,
  transfers: <path d="M4 6h12M4 10h12M4 14h8" fill="none" stroke="currentColor" strokeWidth={1.7} strokeLinecap="round" />,
  review: <path d="M10 2.5l6 2.5v4.5c0 3.8-2.6 6.6-6 8-3.4-1.4-6-4.2-6-8V5z" fill="none" stroke="currentColor" strokeWidth={1.7} strokeLinejoin="round" />,
  ledger: <path d="M5 3.5h10a1 1 0 0 1 1 1v12l-2.5-1.5L11 16.5 8.5 15 6 16.5 4 15V4.5a1 1 0 0 1 1-1zM7 7.5h6M7 10.5h6" fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinejoin="round" strokeLinecap="round" />,
  simulator: (
    <>
      <path d="M4 6h7M15 6h1M4 14h1M9 14h7" fill="none" stroke="currentColor" strokeWidth={1.7} strokeLinecap="round" />
      <circle cx="13" cy="6" r="2" fill="none" stroke="currentColor" strokeWidth={1.7} />
      <circle cx="7" cy="14" r="2" fill="none" stroke="currentColor" strokeWidth={1.7} />
    </>
  ),
};

const NAV = [
  { href: "/ops", label: "Overview", icon: "overview", exact: true },
  { href: "/ops/transfers", label: "Transfers", icon: "transfers" },
  { href: "/ops/review", label: "Review queue", icon: "review", badge: true },
  { href: "/ops/ledger", label: "Ledger", icon: "ledger" },
  { href: "/ops/simulator", label: "Simulator", icon: "simulator" },
];

/** Read the email claim from the JWT payload (display only; the API is the authority). */
function emailFromToken(token: string | null): string | null {
  if (!token) return null;
  try {
    const part = token.split(".")[1];
    const json = JSON.parse(atob(part.replace(/-/g, "+").replace(/_/g, "/")));
    return typeof json.email === "string" ? json.email : null;
  } catch {
    return null;
  }
}

export default function OpsLayout({ children }: { children: ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const [ready, setReady] = useState(false);
  const [email, setEmail] = useState<string | null>(null);
  const [reviewCount, setReviewCount] = useState<number | null>(null);

  // Role guard runs on the client because the session lives in localStorage.
  useEffect(() => {
    if (session.role !== "OPERATOR") {
      router.replace("/login");
      return;
    }
    setEmail(emailFromToken(session.token));
    setReady(true);
  }, [router]);

  // Review-queue badge: refresh every 10 s and whenever the page changes.
  useEffect(() => {
    if (!ready) return;
    let alive = true;
    const load = () =>
      api<ReviewQueue>("/ops/review")
        .then((q) => { if (alive) setReviewCount(q.held_transfers.length + q.kyb_pending.length); })
        .catch(() => {});
    load();
    const t = setInterval(load, 10_000);
    return () => { alive = false; clearInterval(t); };
  }, [ready, pathname]);

  function signOut() {
    session.clear();
    router.replace("/login");
  }

  if (!ready) {
    return <div className="min-h-screen bg-ground flex items-center justify-center text-teal-grey text-[14px]">Checking operator session…</div>;
  }

  return (
    <div className="min-h-screen flex flex-wrap bg-ground text-teal">
      <nav aria-label="Console" className="flex-[1_1_220px] max-w-full md:max-w-[240px] bg-teal-console px-3.5 py-7 flex flex-col gap-7 md:min-h-screen md:sticky md:top-0 md:h-screen">
        <div className="flex items-center gap-2.5 px-2">
          <Mark size={32} inverse />
          <div className="flex flex-col">
            <span className="font-semibold text-[15px] text-white">HSG Console</span>
            <span className="text-[11px] text-nav-muted tracking-[0.06em] uppercase">Operator</span>
          </div>
        </div>

        <div className="flex flex-col gap-1">
          {NAV.map((n) => {
            const active = n.exact ? pathname === n.href : pathname === n.href || pathname.startsWith(n.href + "/");
            return (
              <Link key={n.href} href={n.href} aria-current={active ? "page" : undefined}
                className={`flex items-center gap-3 h-11 px-3.5 rounded-full text-[14px] no-underline ${active ? "bg-lime text-teal-console font-semibold" : "text-nav-text font-medium hover:bg-white/5"}`}>
                <svg width="18" height="18" viewBox="0 0 20 20" aria-hidden="true">{ICONS[n.icon]}</svg>
                {n.label}
                {n.badge && reviewCount !== null && reviewCount > 0 && (
                  <span className="ml-auto min-w-[22px] h-[22px] px-1.5 rounded-full bg-amber-dot text-teal-console text-[12px] font-semibold inline-flex items-center justify-center">{reviewCount}</span>
                )}
              </Link>
            );
          })}
        </div>

        <div className="mt-auto pt-3.5 px-2.5 border-t border-[#1B3F4A] text-[12px] leading-[18px] text-nav-muted flex flex-col gap-3">
          <span>Test network · simulated bank and providers<br />Signed in as {email ?? "operator"}</span>
          <button type="button" onClick={signOut} className="self-start h-8 px-3.5 rounded-full border border-[#1B3F4A] text-nav-text text-[12px] font-medium hover:bg-white/5 cursor-pointer">Sign out</button>
        </div>
      </nav>

      <main className="flex-[999_1_560px] min-w-0 px-4 md:px-9 pt-[30px] pb-12">
        <div className="max-w-[1160px] flex flex-col gap-5">{children}</div>
      </main>
    </div>
  );
}
