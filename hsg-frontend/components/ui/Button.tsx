import { ButtonHTMLAttributes } from "react";

type Variant = "primary" | "lime" | "outline" | "danger";
const V: Record<Variant, string> = {
  primary: "bg-teal text-lime font-semibold hover:bg-teal-console",
  lime: "bg-lime text-teal font-semibold hover:brightness-95",
  outline: "border-[1.5px] border-teal bg-white text-teal font-medium hover:bg-ground",
  danger: "border-[1.5px] border-critical bg-white text-critical font-medium hover:bg-critical-bg",
};
export function Button({ variant = "primary", className = "", ...p }: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant }) {
  return <button {...p} className={`h-12 px-6 rounded-full text-[15px] inline-flex items-center justify-center gap-2 transition disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer ${V[variant]} ${className}`} />;
}
