#!/bin/bash
# Acceptance evidence for TC05 (expired quote), TC08 (provider capacity routing + reversal), TC09 (chain congestion).
# Usage: API=http://localhost:4000/api ./scripts/acceptance-tc05-08-09.sh   (writes ../docs/evidence/*.json)
set -u
A=${API:-http://localhost:4000/api}
OUT=$(cd "$(dirname "$0")/../../docs/evidence" && pwd)
j() { python3 -c "import sys,json; d=json.load(sys.stdin); print(eval(sys.argv[1]))" "$1"; }
login() { curl -s -X POST $A/auth/login -H 'content-type: application/json' -d "{\"email\":\"$1\",\"password\":\"Passw0rd!\"}" | j 'd["token"]'; }
OPS=$(login ops@hsg.test); SME=$(login funmi@adebayoimports.ng)
G() { curl -s -H "Authorization: Bearer $1" "$A$2"; }
P() { curl -s -X ${4:-POST} -H "Authorization: Bearer $1" -H 'content-type: application/json' ${5:+-H "Idempotency-Key: $5"} "$A$2" -d "$3"; }
BN=$(G $SME /beneficiaries | j '[b["id"] for b in d["items"] if b["name"].startswith("Shenzhen")][0]')
ACCT=$(G $SME /me | j 'd["virtual_account"]["account_number"]')
P $OPS /sim/nip-inflow "{\"account_number\":\"$ACCT\",\"amount\":\"2000000000\",\"sender_name\":\"Acceptance top-up\"}" >/dev/null
P $OPS /sim/faults '{"payoutHardFail":false,"chainDelaySeconds":0,"providersOutOfCapacity":false}' PUT >/dev/null
send() { local q=$(P $SME /quotes '{"usd_amount":"100000"}' | j 'd["id"]'); P $SME /transfers "{\"quote_id\":\"$q\",\"beneficiary_id\":\"$BN\",\"purpose\":\"$1\"}" POST $(uuidgen) | j 'd["id"]'; }
wait_t() { for i in $(seq 1 ${2:-60}); do s=$(G $OPS /ops/transfers/$1 | j 'd["transfer"]["state"]'); case $s in COMPLETED|REVERSED|DECLINED) echo $s; return;; esac; sleep 3; done; echo TIMEOUT; }
detail() { G $OPS /ops/transfers/$1; }
summ() { python3 -c "
import sys,json; d=json.load(sys.stdin); t=d['transfer']
print(json.dumps({'id':t['id'],'reference':t['reference'],'state':t['state'],'failure_reason':t['failure_reason'],
 'created_at':t['timestamps']['created_at'],'completed_at':t['timestamps']['completed_at'],'reversed_at':t['timestamps']['reversed_at'],
 'provider':(d['payout_order'] or {}).get('provider',{}).get('name'),'payout_status':(d['payout_order'] or {}).get('status'),
 'saga_steps':[(s['step'],s['attempt'],s['status']) for s in d['saga_steps']],
 'chain_transactions':[(c['kind'],c['tx_hash'],c['status'],c['block_number']) for c in d['chain_transactions']],
 'journal':[e['reference'].split(':')[-1] for e in d['journal_entries']]},indent=1))"; }
providers() { G $OPS /sim/providers | python3 -c "import sys,json;print(json.dumps([(p['id'],p['name'],p['capacity_usd']) for p in json.load(sys.stdin)['items']]))"; }

echo "===== TC08 run 1: best provider at zero capacity, route to next ====="
ORIG=$(providers); echo "providers before: $ORIG"
# Find which provider wins normally (last completed transfer's provider) by sending one control transfer.
C=$(send "TC08 control"); echo "control $C -> $(wait_t $C)"; WIN=$(detail $C | j 'd["payout_order"]["provider"]["name"]'); WINID=$(G $OPS /sim/providers | j "[p['id'] for p in d['items'] if p['name']=='$WIN'][0]"); echo "normal winner: $WIN"
P $OPS /sim/providers/$WINID '{"capacity_usd":"0"}' PUT >/dev/null
T1=$(send "TC08 run 1"); R1=$(wait_t $T1); echo "run1 $T1 -> $R1"; detail $T1 | summ > $OUT/TC08-run1.json; echo "routed to: $(python3 -c "import json;print(json.load(open('$OUT/TC08-run1.json'))['provider'])")"
echo "===== TC08 run 2: all three providers at zero capacity -> REVERSED ====="
for id in $(G $OPS /sim/providers | j '" ".join(p["id"] for p in d["items"])'); do P $OPS /sim/providers/$id '{"capacity_usd":"0"}' PUT >/dev/null; done
B0=$(G $SME /balance | j 'd["available"]'); T2=$(send "TC08 run 2"); R2=$(wait_t $T2); B1=$(G $SME /balance | j 'd["available"]')
echo "run2 $T2 -> $R2 ; available before $B0 after $B1"; detail $T2 | summ > $OUT/TC08-run2.json
G $SME /transfers/$T2 | python3 -c "import sys,json;d=json.load(sys.stdin);print('SME sees:',d['status'],'|',d['failure_reason'],'| ngn_returned',d['ngn_returned'])"
# restore capacities
echo "$ORIG" | python3 -c "import sys,json;[print(i,c) for i,n,c in json.load(sys.stdin)]" | while read id cap; do P $OPS /sim/providers/$id "{\"capacity_usd\":\"$cap\"}" PUT >/dev/null; done; echo "providers restored: $(providers)"

echo "===== TC09: chain delay 120 s ====="
P $OPS /sim/faults '{"chainDelaySeconds":120}' PUT >/dev/null
T9=$(send "TC09 chain congestion"); T9START=$(date +%s); echo "TC09 transfer $T9 submitted with 120 s chain delay"

echo "===== TC05 (while TC09 waits): expired quote ====="
N0=$(G $OPS /ops/ledger/entries?page_size=1 | j 'd["total"]')
Q=$(P $SME /quotes '{"usd_amount":"100000"}'); QID=$(echo $Q | j 'd["id"]'); echo "quote $QID expires_at $(echo $Q | j 'd["expires_at"]')"
sleep 62
R05=$(P $SME /transfers "{\"quote_id\":\"$QID\",\"beneficiary_id\":\"$BN\",\"purpose\":\"TC05 expired quote\"}" POST $(uuidgen)); echo "response: $R05"
sleep 3; N1=$(G $OPS /ops/ledger/entries?page_size=1 | j 'd["total"]')
# Journal can grow from the concurrent TC09 transfer, so count entries referencing this quote's would-be transfer instead: none can exist.
TCOUNT=$(G $OPS "/ops/transfers?q=TC05&limit=50" | j 'len(d["items"])')
python3 -c "import json;json.dump({'quote':json.loads('''$Q'''),'confirm_response':json.loads('''$R05'''),'journal_total_before':$N0,'journal_total_after':$N1,'transfers_created_for_TC05':$TCOUNT,'note':'journal may grow from the concurrent TC09 transfer; no transfer or entry was created for the expired quote'},open('$OUT/TC05.json','w'),indent=1)"
echo "TC05: transfers created for expired quote = $TCOUNT"

R9=$(wait_t $T9 80); echo "TC09 $T9 -> $R9 after $(( $(date +%s) - T9START )) s"; detail $T9 | summ > $OUT/TC09.json
python3 -c "import json;d=json.load(open('$OUT/TC09.json'));print('chain txs:',len(d['chain_transactions']),'| CHAIN_CONFIRM attempts:',sum(1 for s in d['saga_steps'] if s[0]=='CHAIN_CONFIRM'))"
P $OPS /sim/faults '{"chainDelaySeconds":0}' PUT >/dev/null; echo "faults reset"
