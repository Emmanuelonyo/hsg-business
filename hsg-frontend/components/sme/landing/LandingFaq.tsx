"use client";
/** FAQ accordion from the landing mockup: one item open at a time, the open card turns teal. */
import { useState } from "react";

const FAQS: [string, string][] = [
  ["Which currencies can my suppliers receive?", "USD by ACH or wire, EUR by SEPA, GBP by Faster Payments, MXN by SPEI, BRL by Pix and COP by Bre-B. Your supplier receives exactly the amount you choose."],
  ["How long does it take?", "Funding your account by bank transfer takes seconds. Payment times depend on the supplier’s country and bank, and you can follow each payment to delivery."],
  ["What happens if a payment fails?", "It is reversed. The full naira amount, including the fee, goes back to your available balance, and you see the reason on the payment page."],
  ["Who can open an account?", "Registered Nigerian businesses. We verify your company documents and directors before your account opens."],
];

export function LandingFaq() {
  const [open, setOpen] = useState(0);
  return (
    <div className="flex flex-col gap-3">
      {FAQS.map(([q, a], i) => {
        const isOpen = open === i;
        return (
          <div key={q} className={`fx-reveal overflow-hidden rounded-3xl ${isOpen ? "bg-teal text-white" : "bg-white text-teal"}`}>
            <button
              type="button"
              id={`faq-q-${i}`}
              aria-expanded={isOpen}
              aria-controls={`faq-a-${i}`}
              onClick={() => setOpen(isOpen ? -1 : i)}
              className="flex w-full cursor-pointer items-center justify-between gap-4 border-0 bg-transparent px-[26px] py-[22px] text-left text-[17px] font-semibold text-inherit"
            >
              {q}
              <span aria-hidden="true" className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-[20px] font-medium text-teal ${isOpen ? "bg-lime" : "bg-ground"}`}>
                {isOpen ? "−" : "+"}
              </span>
            </button>
            {isOpen && (
              <p id={`faq-a-${i}`} role="region" aria-labelledby={`faq-q-${i}`} className={`fx-fade m-0 px-[26px] pb-6 text-[15px] leading-[25px] ${isOpen ? "text-teal-mist" : "text-teal-grey"}`}>
                {a}
              </p>
            )}
          </div>
        );
      })}
    </div>
  );
}
