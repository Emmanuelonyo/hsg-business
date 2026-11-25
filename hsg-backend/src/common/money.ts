/**
 * Money helpers. All amounts are bigint minor units internally and strings on the wire.
 * Rates are 2dp decimal strings ("1580.00") and are converted to integer "basis" (x100) for math.
 */
export const toMinorString = (v: bigint) => v.toString();
export const parseMinor = (s: string | number | bigint): bigint => {
  const b = BigInt(s);
  if (b < 0n) throw new Error('negative amount');
  return b;
};
/** "1580.00" -> 158000n (rate * 100) */
export const rateToBasis = (rate: string): bigint => {
  const [i, f = ''] = rate.split('.');
  return BigInt(i) * 100n + BigInt((f + '00').slice(0, 2));
};
export const basisToRate = (b: bigint): string => `${b / 100n}.${(b % 100n).toString().padStart(2, '0')}`;
/** usd cents * (NGN per USD) -> kobo. cents * rateBasis / 100 = kobo (since 1 USD = 100 cents, 1 NGN = 100 kobo). */
export const usdCentsToKobo = (cents: bigint, rate: string): bigint => (cents * rateToBasis(rate)) / 100n;
/** Display: 158750000n kobo -> "1,587,500.00" */
export const formatMinor = (v: bigint): string => {
  const neg = v < 0n; const a = neg ? -v : v;
  const whole = (a / 100n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return `${neg ? '-' : ''}${whole}.${(a % 100n).toString().padStart(2, '0')}`;
};
