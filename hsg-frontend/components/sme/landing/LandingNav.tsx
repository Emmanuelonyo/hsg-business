"use client";
/**
 * Landing navigation pill (sticky, drops in, shrinks on scroll via .fx-nav).
 * The active section pill follows clicks (as in the mockup) and also follows scrolling.
 */
import Link from "next/link";
import { useEffect, useState } from "react";

const LINKS: [string, string][] = [["how", "How it works"], ["why", "Why HSG"], ["currencies", "Currencies"], ["faq", "FAQ"]];

function Logo() {
  return (
    <svg width="34" height="34" viewBox="0 0 48 48" aria-hidden="true">
      <rect width="48" height="48" rx="24" fill="#E4FF1A" />
      <g fill="#0D3542">{[0, 45, 90, 135].map((r) => <rect key={r} x="21" y="9" width="6" height="30" rx="3" transform={`rotate(${r} 24 24)`} />)}</g>
    </svg>
  );
}

const Arrow = () => (
  <svg width="16" height="16" viewBox="0 0 20 20" aria-hidden="true"><path d="M4 10h12M11 5l5 5-5 5" fill="none" stroke="#0D3542" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" /></svg>
);

export function LandingNav() {
  const [active, setActive] = useState("how");

  // Scroll-spy: the section nearest the top of the viewport becomes active.
  useEffect(() => {
    const els = LINKS.map(([id]) => document.getElementById(id)).filter((e): e is HTMLElement => !!e);
    const io = new IntersectionObserver(
      (entries) => {
        const visible = entries.filter((e) => e.isIntersecting).sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top);
        if (visible[0]) setActive(visible[0].target.id);
      },
      { rootMargin: "-30% 0px -60% 0px" },
    );
    els.forEach((e) => io.observe(e));
    return () => io.disconnect();
  }, []);

  return (
    <div className="sticky top-0 z-50 h-0">
      <div className="px-4 pt-5 sm:px-6">
        <nav
          aria-label="Main"
          className="fx-drop fx-nav relative mx-auto flex max-w-[1180px] flex-wrap items-center justify-between gap-3 rounded-full bg-teal py-2.5 pl-[18px] pr-2.5 shadow-[0_12px_32px_rgba(13,53,66,0.18)]"
        >
          <a href="#top" className="flex items-center gap-2.5 text-white no-underline">
            <Logo />
            <span className="text-[16px] font-semibold">HSG Business</span>
          </a>
          <div className="hidden flex-wrap items-center gap-1 rounded-full bg-teal-mid p-1 lg:flex">
            {LINKS.map(([id, label]) => {
              const on = active === id;
              return (
                <a
                  key={id}
                  href={`#${id}`}
                  onClick={() => setActive(id)}
                  aria-current={on ? "true" : undefined}
                  className={`inline-flex h-[38px] items-center rounded-full px-4 text-[14px] font-medium no-underline transition-colors ${on ? "bg-lime text-teal" : "text-nav-text hover:text-white"}`}
                >
                  {label}
                </a>
              );
            })}
          </div>
          <div className="flex items-center gap-1.5">
            <Link href="/login" className="inline-flex h-[42px] items-center rounded-full px-3 text-[14px] font-medium text-white no-underline sm:px-4">Sign in</Link>
            <Link href="/register" className="fx-btn inline-flex h-11 items-center gap-2 rounded-full bg-lime px-5 text-[14px] font-semibold text-teal no-underline">
              <span className="hidden sm:inline">Open an account</span>
              <span className="sm:hidden">Open account</span>
              <Arrow />
            </Link>
          </div>
        </nav>
      </div>
    </div>
  );
}
