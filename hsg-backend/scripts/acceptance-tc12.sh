#!/bin/bash
# TC12 velocity: 6 transfers from one SME inside 10 minutes -> the 6th is HELD and appears in the review queue.
# Usage: API=http://localhost:4000/api SME_EMAIL=sme077@hsg.test ./scripts/acceptance-tc12.sh
set -u
A=${API:-http://localhost:4000/api}; WHO=${SME_EMAIL:-sme077@hsg.test}
OUT=$(cd "$(dirname "$0")/../../docs/evidence" && pwd)
j() { python3 -c "import sys,json; d=json.load(sys.stdin); print(eval(sys.argv[1]))" "$1"; }
login() { curl -s -X POST $A/auth/login -H 'content-type: application/json' -d "{\"email\":\"$1\",\"password\":\"Passw0rd!\"}" | j 'd["token"]'; }
OPS=$(login ops@hsg.test); SME=$(login $WHO)
BN=$(curl -s -H "Authorization: Bearer $SME" $A/beneficiaries | j 'd["items"][0]["id"]')
IDS=()
for n in 1 2 3 4 5 6; do
  Q=$(curl -s -X POST -H "Authorization: Bearer $SME" -H 'content-type: application/json' $A/quotes -d '{"usd_amount":"50000"}' | j 'd["id"]')
  T=$(curl -s -X POST -H "Authorization: Bearer $SME" -H 'content-type: application/json' -H "Idempotency-Key: $(uuidgen)" $A/transfers \
      -d "{\"quote_id\":\"$Q\",\"beneficiary_id\":\"$BN\",\"purpose\":\"TC12 velocity #$n\"}" | j 'd["id"]')
  IDS+=("$T"); echo "submitted #$n $T"
done
sleep 20
{
  echo "TC12 velocity, SME $WHO, $(date -u +%FT%TZ)"
  for T in "${IDS[@]}"; do
    curl -s -H "Authorization: Bearer $OPS" $A/ops/transfers/$T | python3 -c "
import sys,json;d=json.load(sys.stdin);t=d['transfer'];v=[c for c in d['compliance_checks'] if c['gate']=='VELOCITY']
print(t['reference'],t['state'].ljust(10),'velocity:',v[0]['result'] if v else '-',json.dumps(v[0]['detail']) if v else '')"
  done
  curl -s -H "Authorization: Bearer $OPS" $A/ops/review | python3 -c "import sys,json;d=json.load(sys.stdin);print('review queue held:',[(h['reference'],h['rule'],h['reason']) for h in d['held_transfers']])"
} | tee $OUT/TC12.txt
