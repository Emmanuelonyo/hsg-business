"use client";
/** S3 Beneficiaries: table with check status, Add beneficiary drawer. Blocked ones are clearly "Can't be paid". */
import { useCallback, useEffect, useState } from "react";
import { api } from "@/lib/api";
import type { Beneficiary, Page } from "@/lib/types";
import { BeneficiaryDrawer } from "@/components/sme/BeneficiaryDrawer";
import { countryName } from "@/components/sme/countries";
import { Icon } from "@/components/sme/motifs";
import { EmptyState, ErrorState, PageHeader, Skeleton, friendlyError, primaryPill } from "@/components/sme/ui";

const fmtDate = (iso: string) => new Date(iso).toLocaleDateString("en-GB", { day: "2-digit", month: "short" });

export default function BeneficiariesPage() {
  const [items, setItems] = useState<Beneficiary[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [newId, setNewId] = useState<string | null>(null);

  const load = useCallback(() => {
    setError(null);
    api<Page<Beneficiary>>("/beneficiaries").then((r) => setItems(r.items)).catch((e) => setError(friendlyError(e)));
  }, []);
  useEffect(load, [load]);

  const onSaved = useCallback((b: Beneficiary) => {
    setNewId(b.id);
    setItems((prev) => [b, ...(prev ?? []).filter((x) => x.id !== b.id)]);
  }, []);
  const close = useCallback(() => setOpen(false), []);

  const addBtn = (
    <button type="button" onClick={() => setOpen(true)} className={primaryPill}>
      <Icon name="plus" size={16} />Add beneficiary
    </button>
  );
  const th = "px-4 py-3.5 text-[13px] font-medium";
  const td = "border-b border-line-soft px-4 py-4 align-top";

  return (
    <>
      <PageHeader title="Beneficiaries" sub="Suppliers you pay abroad. Each one is checked when added and again before every payment." action={addBtn} />
      {error && <ErrorState message={error} onRetry={load} />}

      <section className="overflow-hidden rounded-3xl bg-white">
        {items && items.length === 0 ? (
          <EmptyState
            title="No beneficiaries yet"
            body="Add the suppliers you pay abroad. We check each one before it can receive a payment."
            action={<div className="mt-2">{addBtn}</div>}
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[760px] border-collapse text-[14px]">
              <thead>
                <tr className="bg-ground text-left text-teal-grey">
                  <th scope="col" className={`${th} pl-6`}>Name</th>
                  <th scope="col" className={th}>Bank</th>
                  <th scope="col" className={th}>Account</th>
                  <th scope="col" className={th}>Checks</th>
                  <th scope="col" className={`${th} pr-6 text-right`}>Added</th>
                </tr>
              </thead>
              <tbody>
                {!items
                  ? Array.from({ length: 4 }).map((_, i) => (
                      <tr key={i}>{Array.from({ length: 5 }).map((__, j) => <td key={j} className={`${td} ${j === 0 ? "pl-6" : ""}`}><Skeleton className="h-4 w-full max-w-[150px]" /></td>)}</tr>
                    ))
                  : items.map((b) => {
                      const blocked = b.screening_status === "BLOCKED";
                      return (
                        <tr key={b.id} className={b.id === newId ? "bg-[#FBFFE6]" : ""}>
                          <td className={`${td} pl-6`}>
                            <div className={`font-medium ${blocked ? "text-teal-grey" : ""}`}>{b.name}</div>
                            <div className="text-[13px] text-teal-grey">{countryName(b.country)}</div>
                          </td>
                          <td className={td}>
                            <div>{b.bank_name}</div>
                            {b.swift_bic && <div className="font-mono text-[13px] text-teal-grey">{b.swift_bic}</div>}
                          </td>
                          <td className={`${td} font-mono text-[13px]`}>{b.account_number_masked}</td>
                          <td className={td}>
                            {blocked ? (
                              <>
                                <span className="inline-flex h-[26px] items-center whitespace-nowrap rounded-full border border-critical px-3 text-[13px] font-semibold text-critical">Not cleared</span>
                                <div className="mt-1 text-[12px] font-medium text-critical">Can’t be paid. Contact support.</div>
                              </>
                            ) : (
                              <>
                                <span className="inline-flex h-7 items-center whitespace-nowrap rounded-full bg-lime px-3 text-[13px] font-semibold text-teal">Cleared</span>
                                <div className="mt-1 text-[12px] text-teal-grey">Checked {fmtDate(b.created_at)}</div>
                              </>
                            )}
                          </td>
                          <td className={`${td} pr-6 text-right text-teal-grey`}>{fmtDate(b.created_at)}</td>
                        </tr>
                      );
                    })}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <BeneficiaryDrawer open={open} onClose={close} onSaved={onSaved} />
    </>
  );
}
