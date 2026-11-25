/** JSON.stringify that turns bigint into string. Installed globally in main.ts / worker.ts via BigInt.prototype.toJSON. */
export function installBigIntJson() {
  (BigInt.prototype as any).toJSON = function () { return this.toString(); };
}
/** Canonical JSON: keys sorted recursively, bigint as string. Used for hashing (ledger, idempotency). */
export function canonicalJson(v: unknown): string {
  const norm = (x: any): any => {
    if (typeof x === 'bigint') return x.toString();
    if (x instanceof Date) return x.toISOString();
    if (Array.isArray(x)) return x.map(norm);
    if (x && typeof x === 'object') return Object.keys(x).sort().reduce((o, k) => { o[k] = norm(x[k]); return o; }, {} as any);
    return x;
  };
  return JSON.stringify(norm(v));
}
