/** Money arrives as strings in minor units ("158750000" kobo). Display: currency code first, two decimals. */
export function fmtMinor(minor: string | number | bigint | null | undefined): string {
  if (minor === null || minor === undefined || minor === "") return "—";
  let v = BigInt(minor);
  const neg = v < 0n; if (neg) v = -v;
  const whole = (v / 100n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return `${neg ? "−" : ""}${whole}.${(v % 100n).toString().padStart(2, "0")}`;
}
export const money = (ccy: "NGN" | "USD", minor: string | number | bigint | null | undefined) => `${ccy} ${fmtMinor(minor)}`;
/** "1,000.50" -> "100050" (cents). Returns null if invalid. */
export function parseMajorToMinor(input: string): string | null {
  const clean = input.replace(/,/g, "").trim();
  if (!/^\d+(\.\d{0,2})?$/.test(clean)) return null;
  const [i, f = ""] = clean.split(".");
  const v = BigInt(i) * 100n + BigInt((f + "00").slice(0, 2));
  return v > 0n ? v.toString() : null;
}
export const fmtTime = (iso?: string | null) => (iso ? new Date(iso).toLocaleString("en-GB", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit", second: "2-digit" }) : "—");
