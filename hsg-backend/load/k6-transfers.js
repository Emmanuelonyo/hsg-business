// k6 equivalent of load/run.ts (intake side only; use run.ts for settlement timings and the CSV).
//   k6 run -e API=http://localhost:4000/api -e TRANSFERS=500 -e RATE=10 load/k6-transfers.js
import http from 'k6/http';
import { check } from 'k6';
import { Counter, Trend } from 'k6/metrics';
import exec from 'k6/execution';

const API = __ENV.API || 'http://localhost:4000/api';
const TRANSFERS = Number(__ENV.TRANSFERS || 500);
const RATE = Number(__ENV.RATE || 10);
const SMES = Number(__ENV.SMES || 100);

const intake = new Trend('hsg_intake_ms', true);
const accepted = new Counter('hsg_accepted');
const rejected = new Counter('hsg_rejected');

export const options = {
  scenarios: {
    transfers: {
      executor: 'constant-arrival-rate',
      rate: RATE,
      timeUnit: '1s',
      duration: `${Math.ceil(TRANSFERS / RATE)}s`,
      preAllocatedVUs: 50,
      maxVUs: 200,
    },
  },
  thresholds: { hsg_intake_ms: ['p(95)<2000'] },
};

const json = { headers: { 'Content-Type': 'application/json' } };
const auth = (token, extra = {}) => ({ headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}`, ...extra } });

export function setup() {
  const smes = [];
  for (let i = 1; i <= SMES; i++) {
    const email = `sme${String(i).padStart(3, '0')}@hsg.test`;
    const r = http.post(`${API}/auth/login`, JSON.stringify({ email, password: 'Passw0rd!' }), json);
    const token = r.json('token');
    const b = http.get(`${API}/beneficiaries`, auth(token));
    const ben = (b.json('items') || []).find((x) => x.screening_status === 'CLEARED');
    smes.push({ email, token, beneficiaryId: ben.id });
  }
  return { smes };
}

function uuid() {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16);
  });
}

export default function (data) {
  // scenario.iterationInTest is global across VUs -> round-robin over SMEs (<=5 each for 500 / 100)
  const idx = exec.scenario.iterationInTest;
  const sme = data.smes[idx % data.smes.length];
  const started = Date.now();
  const usd = String(20000 + Math.floor(Math.random() * 180000));
  const q = http.post(`${API}/quotes`, JSON.stringify({ usd_amount: usd }), auth(sme.token));
  if (!check(q, { 'quote 201': (r) => r.status === 201 })) { rejected.add(1); return; }
  const t = http.post(`${API}/transfers`,
    JSON.stringify({ quote_id: q.json('id'), beneficiary_id: sme.beneficiaryId, purpose: `k6 load invoice ${idx + 1}` }),
    auth(sme.token, { 'Idempotency-Key': uuid() }));
  intake.add(Date.now() - started);
  if (check(t, { 'transfer 202': (r) => r.status === 202 })) accepted.add(1); else rejected.add(1);
}
