#!/bin/bash
set -e
API=http://localhost:4100/api/v1
pass() { echo "✅ $1"; }
fail() { echo "❌ $1"; exit 1; }

# 1. workspace + credits
CREDITS=$(curl -s $API/credits | python3 -c "import json,sys; print(json.load(sys.stdin)['balance'])")
[ -n "$CREDITS" ] && pass "workspace session resolved, credits=$CREDITS" || fail "credits"

# 2. pipelines/stages
STAGES=$(curl -s $API/pipelines | python3 -c "import json,sys; print(len(json.load(sys.stdin)[0]['stages']))")
pass "$STAGES stages in default pipeline"

# 3. create deal manually w/ custom fields
DEAL=$(curl -s -X POST $API/deals -H 'content-type: application/json' -d '{"companyName":"E2E Robotics","roundStage":"Seed","askAmount":5000000,"fields":{"lead_partner":"Sarah Kim","team_quality":"A-"}}')
DID=$(echo "$DEAL" | python3 -c "import json,sys; print(json.load(sys.stdin)['id'])")
LEAD=$(echo "$DEAL" | python3 -c "import json,sys; print(json.load(sys.stdin)['fields'].get('lead_partner'))")
[ "$LEAD" = "Sarah Kim" ] && pass "manual deal created w/ field values" || fail "field value ($LEAD)"

# 4. move deal to stage 2
S2=$(curl -s $API/pipelines | python3 -c "import json,sys; print(json.load(sys.stdin)[0]['stages'][1]['id'])")
curl -s -X POST $API/deals/$DID/move -H 'content-type: application/json' -d "{\"stageId\":\"$S2\"}" > /dev/null
NEW=$(curl -s $API/deals/$DID | python3 -c "import json,sys; print(json.load(sys.stdin)['stageId'])")
[ "$NEW" = "$S2" ] && pass "kanban move works" || fail "move"

# 5. email ingestion → processed
EMAIL=$(curl -s -X POST $API/emails/simulate -H 'content-type: application/json' -d '{"companyName":"E2EVentures","round":"Series A","askUsd":9000000,"arrUsd":2000000,"sectorHint":"fintech"}')
EID=$(echo "$EMAIL" | python3 -c "import json,sys; print(json.load(sys.stdin)['id'])")
STATUS=queued
for i in $(seq 1 40); do
  STATUS=$(curl -s $API/emails/$EID | python3 -c "import json,sys; print(json.load(sys.stdin)['processingStatus'])")
  [ "$STATUS" = "processed" ] || [ "$STATUS" = "failed" ] && break
  sleep 3
done
[ "$STATUS" = "processed" ] && pass "email pipeline processed end-to-end" || fail "email status=$STATUS"

# 6. search finds it
FOUND=$(curl -s "$API/search?q=e2eventures" | python3 -c "import json,sys; print(len(json.load(sys.stdin)['companies']))")
[ "$FOUND" -ge 1 ] && pass "search indexes new company" || fail "search"

# 7. share link + public view
COMP=$(curl -s "$API/search?q=e2eventures" | python3 -c "import json,sys; print(json.load(sys.stdin)['companies'][0]['id'])")
LINK=$(curl -s -X POST $API/share-links -H 'content-type: application/json' -d "{\"companyId\":\"$COMP\",\"title\":\"E2E share\"}")
TOKEN=$(echo "$LINK" | python3 -c "import json,sys; print(json.load(sys.stdin)['token'])")
VIEWS=$(curl -s "$API/public/share/$TOKEN" | python3 -c "import json,sys; d=json.load(sys.stdin); print(d['company']['name'])")
[ "$VIEWS" = "E2eventures" ] && pass "public share view renders" || fail "share"

# 8. analytics
ACT=$(curl -s $API/analytics/overview | python3 -c "import json,sys; print(json.load(sys.stdin)['activeDeals'] > 0)")
[ "$ACT" = "True" ] && pass "analytics live" || fail "analytics"

echo ""
echo "ALL E2E CHECKS PASSED"
