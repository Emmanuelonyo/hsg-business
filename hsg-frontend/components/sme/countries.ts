/** Countries an SME can pay into. The API stores ISO-3166 alpha-2 codes ("CN"); the UI shows names. */
export const COUNTRIES: { code: string; name: string }[] = [
  { code: "CN", name: "China" },
  { code: "TR", name: "Türkiye" },
  { code: "AE", name: "United Arab Emirates" },
  { code: "IN", name: "India" },
  { code: "GB", name: "United Kingdom" },
  { code: "US", name: "United States" },
  { code: "DE", name: "Germany" },
  { code: "NL", name: "Netherlands" },
  { code: "GH", name: "Ghana" },
  { code: "ZA", name: "South Africa" },
  { code: "HK", name: "Hong Kong" },
  { code: "SG", name: "Singapore" },
];

export function countryName(code: string | null | undefined): string {
  if (!code) return "—";
  return COUNTRIES.find((c) => c.code === code.toUpperCase())?.name ?? code;
}

/** "Shenzhen Ruiqi Machinery" -> "SR" */
export function initials(name: string): string {
  return name.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w.charAt(0).toUpperCase()).join("");
}
