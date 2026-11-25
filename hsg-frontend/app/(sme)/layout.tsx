"use client";
/**
 * SME shell: teal left navigation + page content.
 * Guard: no session token, or a non-SME role, goes back to /login.
 * /me is loaded once here (MeProvider) and a banner shows while KYB is not verified.
 */
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { session } from "@/lib/api";
import { Mark } from "@/components/ui/Mark";
import { MeProvider, useMe } from "@/components/sme/MeContext";
import { Icon, type IconName } from "@/components/sme/motifs";
import { initials } from "@/components/sme/countries";

const NAV: { href: string; label: string; icon: IconName }[] = [
  { href: "/app", label: "Home", icon: "home" },
  { href: "/app/send", label: "Send payment", icon: "send" },
  { href: "/app/funds", label: "Add funds", icon: "funds" },
  { href: "/app/transfers", label: "Transfers", icon: "list" },
  { href: "/app/beneficiaries", label: "Beneficiaries", icon: "people" },
];

export default function SmeLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const [allowed, setAllowed] = useState(false);

  useEffect(() => {
    if (!session.token || session.role !== "SME") {
      session.clear();
      router.replace("/login");
    } else {
      setAllowed(true);
    }
  }, [router]);

  if (!allowed) return <div className="min-h-screen bg-ground" aria-busy="true" />;
  return (
    <MeProvider>
      <Shell>{children}</Shell>
    </MeProvider>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const { me } = useMe();
  const [open, setOpen] = useState(false);

  // Close the mobile menu whenever the route changes.
  useEffect(() => setOpen(false), [pathname]);

  const isActive = (href: string) => (href === "/app" ? pathname === "/app" : pathname.startsWith(href));
  const signOut = () => { session.clear(); router.replace("/login"); };
  const company = me?.sme.legal_name ?? "";
  const person = me?.email.split("@")[0] ?? "";

  return (
    <div className="flex min-h-screen flex-col bg-ground lg:flex-row">
      <nav aria-label="Main" className="print:hidden flex shrink-0 flex-col gap-7 bg-teal px-4 py-4 lg:sticky lg:top-0 lg:h-screen lg:w-[240px] lg:py-7">
        <div className="flex items-center justify-between gap-2.5 px-2">
          <Link href="/app" className="flex items-center gap-2.5 no-underline">
            <Mark size={32} inverse />
            <span className="text-[16px] font-semibold text-white">HSG Business</span>
          </Link>
          <button
            type="button"
            className="flex h-10 w-10 cursor-pointer items-center justify-center rounded-full bg-teal-mid text-white lg:hidden"
            aria-expanded={open}
            aria-controls="sme-nav-links"
            aria-label={open ? "Close menu" : "Open menu"}
            onClick={() => setOpen((o) => !o)}
          >
            <Icon name={open ? "close" : "menu"} size={18} />
          </button>
        </div>

        <div id="sme-nav-links" className={`${open ? "flex" : "hidden"} flex-1 flex-col gap-7 lg:flex`}>
          <div className="flex flex-col gap-1.5">
            {NAV.map((n) => {
              const active = isActive(n.href);
              return (
                <Link
                  key={n.href}
                  href={n.href}
                  aria-current={active ? "page" : undefined}
                  className={`flex h-[46px] items-center gap-3 rounded-full px-4 text-[15px] no-underline transition ${active ? "bg-lime font-semibold text-teal" : "font-medium text-nav-text hover:bg-teal-mid"}`}
                >
                  <Icon name={n.icon} />
                  {n.label}
                </Link>
              );
            })}
          </div>
          <div className="mt-auto flex items-center gap-2.5 border-t border-teal-mid px-2 pt-3.5">
            <div className="flex h-[38px] w-[38px] shrink-0 items-center justify-center rounded-full bg-lime text-[13px] font-semibold text-teal">{initials(company || "HSG")}</div>
            <div className="flex min-w-0 flex-1 flex-col">
              <span className="truncate text-[14px] font-semibold text-white">{person || " "}</span>
              <span className="truncate text-[12px] text-[#B5C6CB]">{company || " "}</span>
            </div>
            <button type="button" onClick={signOut} aria-label="Sign out" title="Sign out" className="flex cursor-pointer rounded-full p-1 text-nav-text hover:text-lime">
              <Icon name="signout" />
            </button>
          </div>
        </div>
      </nav>

      <main className="min-w-0 flex-1 px-4 pb-12 pt-6 sm:px-10 sm:pt-9 print:p-0">
        <div className="flex max-w-[1160px] flex-col gap-6">
          <KybBanner />
          {children}
        </div>
      </main>
    </div>
  );
}

function KybBanner() {
  const { me } = useMe();
  if (!me || me.sme.kyb_status === "VERIFIED") return null;
  const rejected = me.sme.kyb_status === "REJECTED";
  return (
    <div role="status" className="print:hidden flex items-start gap-3 rounded-[18px] bg-amber-bg px-[18px] py-3.5 text-[14px] leading-[21px] text-amber">
      <Icon name="shield" className="mt-0.5" />
      <span>
        <strong className="font-semibold">{rejected ? "We couldn’t verify your business." : "Verification pending."}</strong>{" "}
        {rejected
          ? "Sending payments is not available on this account. Contact support for help."
          : "We are checking your company documents, usually within one working day. You can fund your account now; sending payments unlocks once you are verified."}
      </span>
    </div>
  );
}
