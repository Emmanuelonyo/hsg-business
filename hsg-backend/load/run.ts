/**
 * Evaluation run (PRD block 10): `npm run load -- --transfers 500 --rate 10 --api http://localhost:4000/api [--faults]`
 *
 * 1. Signs in as sme001..sme100 and as the operator.
 * 2. Submits N transfers at a constant arrival rate (open model: a new transfer starts every 1/rate s,
 *    whether or not earlier ones have returned). Each transfer = POST /quotes then POST /transfers
 *    with a fresh Idempotency-Key. SMEs are used round-robin so none sends more than 5 (velocity gate).
 * 3. Polls GET /ops/transfers as the operator until every transfer is COMPLETED / REVERSED / DECLINED
 *    or the timeout passes.
 * 4. Writes load/results/run-<ts>.csv (one row per transfer) and summary-<ts>.json, prints a table.
 *
 * --faults switches payoutHardFail ON for the middle 10% of the submissions (45%..55%) via PUT /sim/faults,
 * so part of the run must take the reversal path (target: 100% resolved even with faults).
 */
import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';

// ------------------------------------------------------------------ args
function arg(name: string, def: string): string {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] && !process.argv[i + 1].startsWith('--') ? process.argv[i + 1] : def;
}
const TRANSFERS = Number(arg('transfers', '500'));
const RATE = Number(arg('rate', '10'));
const API = arg('api', process.env.API_URL ?? 'http://localhost:4000/api').replace(/\/$/, '');
const TIMEOUT_S = Number(arg('timeout', '900'));
const SMES = Number(arg('smes', '100'));
const FAULTS = process.argv.includes('--faults');
const PASSWORD = 'Passw0rd!';
const TERMINAL = new Set(['COMPLETED', 'REVERSED', 'DECLINED']);

// ------------------------------------------------------------------ http helper
async function call(method: string, url: string, token?: string, body?: unknown, headers: Record<string, string> = {}) {
  const res = await fetch(`${API}${url}`, {
    method,
    headers: {
      'content-type': 'application/json',
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...headers,
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  let json: any = null;
  try { json = text ? JSON.parse(text) : null; } catch { json = { raw: text }; }
  return { status: res.status, json };
}

async function login(email: string): Promise<string> {
  const r = await call('POST', '/auth/login', undefined, { email, password: PASSWORD });
  if (r.status !== 200 && r.status !== 201) throw new Error(`login ${email} failed: ${r.status} ${JSON.stringify(r.json)}`);
  return r.json.token;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const percentile = (sorted: number[], p: number) =>
  sorted.length ? sorted[Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1)] : null;
const round1 = (n: number | null) => (n == null ? null : Math.round(n * 10) / 10);

// ------------------------------------------------------------------ types
interface Sme { email: string; token: string; beneficiaryId: string }
interface Sent {
  n: number; sme: string; id: string | null; reference: string | null;
  intakeMs: number; intakeStatus: number; error: string | null;
  finalState?: string; createdAt?: string; completedAt?: string | null; settlementSeconds?: number | null;
}

async function main() {
  if (TRANSFERS > SMES * 5) {
    console.warn(`! ${TRANSFERS} transfers over ${SMES} SMEs is more than 5 each: the velocity gate will HELD some.`);
  }
  console.log(`HSG load test  api=${API}  transfers=${TRANSFERS}  rate=${RATE}/s  faults=${FAULTS ? 'middle 10%' : 'off'}`);

  // 1. Sign in (10 at a time) and pick each SME's first cleared beneficiary.
  const opsToken = await login('ops@hsg.test');
  const smes: Sme[] = [];
  const emails = Array.from({ length: SMES }, (_, i) => `sme${String(i + 1).padStart(3, '0')}@hsg.test`);
  for (let i = 0; i < emails.length; i += 10) {
    const batch = await Promise.all(emails.slice(i, i + 10).map(async (email) => {
      const token = await login(email);
      const b = await call('GET', '/beneficiaries', token);
      const ben = (b.json?.items ?? []).find((x: any) => x.screening_status === 'CLEARED');
      if (!ben) throw new Error(`${email} has no cleared beneficiary`);
      return { email, token, beneficiaryId: ben.id };
    }));
    smes.push(...batch);
  }
  console.log(`✓ signed in ${smes.length} SMEs + operator`);

  // Make sure faults start off.
  if (FAULTS) await call('PUT', '/sim/faults', opsToken, { payoutHardFail: false });

  // 2. Constant arrival rate submission.
  const runStart = new Date(Date.now() - 1000); // small margin for clock rounding in ?since=
  const sent: Sent[] = [];
  const inflight: Promise<void>[] = [];
  const faultOnAt = Math.floor(TRANSFERS * 0.45);
  const faultOffAt = Math.floor(TRANSFERS * 0.55);
  const t0 = Date.now();

  const submitOne = async (n: number) => {
    const sme = smes[n % smes.length];
    // USD 200.00 .. 2,000.00 (well under the USD 10,000 review threshold)
    const usdCents = String(20_000 + Math.floor(Math.random() * 180_000));
    const started = performance.now();
    const rec: Sent = { n, sme: sme.email, id: null, reference: null, intakeMs: 0, intakeStatus: 0, error: null };
    sent.push(rec);
    try {
      const q = await call('POST', '/quotes', sme.token, { usd_amount: usdCents });
      if (q.status !== 201 && q.status !== 200) throw Object.assign(new Error(q.json?.error?.code ?? `quote ${q.status}`), { status: q.status });
      const t = await call('POST', '/transfers', sme.token,
        { quote_id: q.json.id, beneficiary_id: sme.beneficiaryId, purpose: `Load test invoice LT-${n + 1}` },
        { 'Idempotency-Key': crypto.randomUUID() });
      rec.intakeStatus = t.status;
      if (t.status !== 202) throw Object.assign(new Error(t.json?.error?.code ?? `transfer ${t.status}`), { status: t.status });
      rec.id = t.json.id;
      rec.reference = t.json.reference;
    } catch (e: any) {
      rec.error = e.message;
      rec.intakeStatus = rec.intakeStatus || e.status || 0;
    } finally {
      rec.intakeMs = Math.round(performance.now() - started);
    }
  };

  for (let n = 0; n < TRANSFERS; n++) {
    const due = t0 + (n * 1000) / RATE;
    const wait = due - Date.now();
    if (wait > 0) await sleep(wait);
    if (FAULTS && n === faultOnAt) { await call('PUT', '/sim/faults', opsToken, { payoutHardFail: true }); console.log(`  faults ON  at #${n}`); }
    if (FAULTS && n === faultOffAt) { await call('PUT', '/sim/faults', opsToken, { payoutHardFail: false }); console.log(`  faults OFF at #${n}`); }
    inflight.push(submitOne(n));
    if ((n + 1) % 50 === 0) console.log(`  submitted ${n + 1}/${TRANSFERS}`);
  }
  await Promise.all(inflight);
  const intakeEnd = Date.now();
  if (FAULTS) await call('PUT', '/sim/faults', opsToken, { payoutHardFail: false });

  const accepted = sent.filter((s) => s.id);
  const intakeSeconds = (intakeEnd - t0) / 1000;
  console.log(`✓ intake done: ${accepted.length}/${TRANSFERS} accepted in ${intakeSeconds.toFixed(1)} s`);

  // 3. Poll the operator list until every accepted transfer is terminal (or timeout).
  const byId = new Map(accepted.map((s) => [s.id!, s]));
  const deadline = Date.now() + TIMEOUT_S * 1000;
  let open = byId.size;
  while (open > 0 && Date.now() < deadline) {
    const r = await call('GET', `/ops/transfers?since=${encodeURIComponent(runStart.toISOString())}&limit=1000`, opsToken);
    if (r.status === 200) {
      for (const it of r.json.items as any[]) {
        const s = byId.get(it.id);
        if (!s) continue;
        s.finalState = it.state;
        s.createdAt = it.created_at;
        s.completedAt = it.completed_at;
        s.settlementSeconds = it.settlement_seconds;
      }
    }
    open = [...byId.values()].filter((s) => !s.finalState || !TERMINAL.has(s.finalState)).length;
    process.stdout.write(`\r  waiting for ${open} non-terminal transfers…        `);
    if (open > 0) await sleep(2000);
  }
  process.stdout.write('\n');

  // 4. Metrics.
  const completed = accepted.filter((s) => s.finalState === 'COMPLETED');
  const settle = completed.map((s) => Number(s.settlementSeconds)).filter((x) => Number.isFinite(x)).sort((a, b) => a - b);
  const intakeLat = sent.map((s) => s.intakeMs).sort((a, b) => a - b);
  const byState: Record<string, number> = {};
  for (const s of sent) {
    const k = s.id ? s.finalState ?? 'UNKNOWN' : `INTAKE_FAILED(${s.error})`;
    byState[k] = (byState[k] ?? 0) + 1;
  }
  const firstCreated = Math.min(...accepted.map((s) => Date.parse(s.createdAt ?? '') || Infinity));
  const lastCompleted = Math.max(...completed.map((s) => Date.parse(s.completedAt ?? '') || 0));
  const completionWindowS = completed.length && Number.isFinite(firstCreated) ? (lastCompleted - firstCreated) / 1000 : null;
  const unresolved = accepted.filter((s) => !s.finalState || !TERMINAL.has(s.finalState)).length;

  const summary = {
    started_at: new Date(t0).toISOString(),
    api: API,
    config: { transfers: TRANSFERS, target_rate_per_s: RATE, smes: SMES, faults: FAULTS ? 'payoutHardFail on for submissions 45%-55%' : 'off', timeout_s: TIMEOUT_S },
    submitted: TRANSFERS,
    accepted: accepted.length,
    intake_failed: TRANSFERS - accepted.length,
    intake_rate_per_s: round1(accepted.length / intakeSeconds),
    intake_ms: { p50: percentile(intakeLat, 50), p95: percentile(intakeLat, 95), max: intakeLat[intakeLat.length - 1] ?? null },
    completed: completed.length,
    completions_per_s: completionWindowS ? Math.round((completed.length / completionWindowS) * 100) / 100 : null,
    settlement_seconds: { p50: round1(percentile(settle, 50)), p95: round1(percentile(settle, 95)), max: round1(settle[settle.length - 1] ?? null) },
    by_final_state: byState,
    unresolved,
    resolved_pct: accepted.length ? Math.round(((accepted.length - unresolved) / accepted.length) * 10000) / 100 : null,
  };

  // 5. Files.
  const dir = path.join(__dirname, 'results');
  fs.mkdirSync(dir, { recursive: true });
  const stamp = new Date(t0).toISOString().replace(/[:.]/g, '-');
  const csvPath = path.join(dir, `run-${stamp}.csv`);
  const jsonPath = path.join(dir, `summary-${stamp}.json`);
  const esc = (v: unknown) => {
    const s = v == null ? '' : String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const lines = ['id,reference,sme,created_at,completed_at,final_state,settlement_seconds,intake_ms'];
  for (const s of sent.sort((a, b) => a.n - b.n)) {
    lines.push([s.id, s.reference, s.sme, s.createdAt, s.completedAt, s.id ? s.finalState ?? 'UNKNOWN' : `INTAKE_FAILED:${s.error}`, s.settlementSeconds, s.intakeMs].map(esc).join(','));
  }
  fs.writeFileSync(csvPath, lines.join('\n') + '\n');
  fs.writeFileSync(jsonPath, JSON.stringify(summary, null, 2) + '\n');

  // 6. Table.
  const rows: [string, string][] = [
    ['Submitted / accepted', `${TRANSFERS} / ${accepted.length}`],
    ['Intake rate (accepted/s)', `${summary.intake_rate_per_s}`],
    ['Intake latency p50 / p95 / max (ms)', `${summary.intake_ms.p50} / ${summary.intake_ms.p95} / ${summary.intake_ms.max}`],
    ['Completed', `${completed.length}`],
    ['Completions per second', `${summary.completions_per_s ?? '-'}`],
    ['Settlement p50 / p95 / max (s)', `${summary.settlement_seconds.p50 ?? '-'} / ${summary.settlement_seconds.p95 ?? '-'} / ${summary.settlement_seconds.max ?? '-'}`],
    ...Object.entries(byState).map(([k, v]) => [`  final ${k}`, String(v)] as [string, string]),
    ['Not resolved (non-terminal)', `${unresolved}`],
    ['Resolved %', `${summary.resolved_pct ?? '-'}`],
  ];
  const w = Math.max(...rows.map((r) => r[0].length));
  console.log('\n' + rows.map(([k, v]) => `  ${k.padEnd(w)}  ${v}`).join('\n'));
  console.log(`\n  CSV:     ${csvPath}\n  Summary: ${jsonPath}`);
  if (unresolved > 0) console.log('  Note: HELD transfers need an operator decision before they count as resolved.');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
