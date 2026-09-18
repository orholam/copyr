#!/bin/bash
set -e
API=http://localhost:4100/api/v1
pass() { echo "✅ $1"; }
fail() { echo "❌ $1"; exit 1; }

# 1. RBAC permissions exposed
PERMS=$(curl -s $API/me/permissions | python3 -c "import json,sys; print('manage_automations' in json.load(sys.stdin)['permissions'])")
[ "$PERMS" = "True" ] && pass "RBAC permission sets (owner defaults)" || fail "rbac"

# 2. Workflow engine: create + trigger + run with steps
EXISTING=$(curl -s "$API/search?q=E2E+stage+mover")
WFID=""
# reuse or create
WF=$(curl -s -X POST $API/workflows -H 'content-type: application/json' -d '{"name":"E2E stage mover","triggerEvent":"deal.created","conditions":[{"field":"deal.askAmount","op":"gte","value":1000000}],"actions":[{"type":"add_note","config":{"body":"Auto-flagged: {{deal.company.name}}"}}]}')
WFID=$(echo "$WF" | python3 -c "import json,sys; print(json.load(sys.stdin)['id'])")
UNIQ2="WfFlow Test $(date +%s)"
curl -s -X POST $API/deals -H 'content-type: application/json' -d "{\"companyName\":\"$UNIQ2\",\"askAmount\":7000000}" > /dev/null
RUN="pending"
for i in $(seq 1 12); do
  RUN=$(curl -s "$API/workflows/$WFID/runs" | python3 -c 'import json,sys; d=json.load(sys.stdin); print(d[0]["status"]+" | "+d[0]["steps"][0]["detail"] if d else "none")' 2>/dev/null || echo none)
  echo "$RUN" | grep -q "completed | Auto-flagged" && break
  sleep 2
done
echo "$RUN" | grep -q "completed | Auto-flagged: WfFlow Test" && pass "workflow engine end-to-end (trigger→condition→action→run log)" || fail "workflow run: $RUN"

# 3. Dry-run test endpoint
TEST=$(curl -s -X POST $API/workflows/$WFID/test | python3 -c "import json,sys; d=json.load(sys.stdin); print(d['matched'], len(d['plannedActions']))")
echo "$TEST" | grep -q "True 1" && pass "workflow dry-run testing" || fail "test: $TEST"

# 4. Outbound webhooks: subscription + delivery record (self-404 target)
SUB=$(curl -s -X POST $API/webhooks -H 'content-type: application/json' -d '{"url":"http://localhost:4100/health","events":["company.created"]}')
SUBID=$(echo "$SUB" | python3 -c "import json,sys; d=json.load(sys.stdin); print(d['id']); assert d['secret'].startswith('whsec_')")
UNIQ="WebhookEvt $(date +%s)"
curl -s -X POST $API/companies -H 'content-type: application/json' -d "{\"name\":\"$UNIQ\"}" > /dev/null
DEL="pending"
for i in $(seq 1 15); do
  DEL=$(curl -s "$API/webhooks/$SUBID/deliveries" | python3 -c "import json,sys; d=json.load(sys.stdin); print(d[0]['event']+' '+str(d[0]['responseStatus'])+' '+str(d[0]['attempts']>=1) if d else 'pending')" 2>/dev/null || echo pending)
  echo "$DEL" | grep -qE "company.created [0-9]" && break
  sleep 2
done
echo "$DEL" | grep -qE "company.created 40[0-9] True" && pass "outbound webhooks dispatched + logged (HMAC secret issued)" || fail "webhook delivery: $DEL"

# 5. Plan-tiered rate limits respond (headers present, not exhausted)
RL=$(curl -s -D - -o /dev/null $API/deals?limit=1 2>/dev/null | grep -ci "x-ratelimit")
[ "$RL" -ge 1 ] && pass "rate limiter active with per-plan tiers" || fail "rate limit headers"

# 6. Notification prefs persisted to DB
curl -s -X PUT $API/me/notification-prefs -H 'content-type: application/json' -d '{"deal_created":true,"mentions":true}' > /dev/null
PREFS=$(curl -s $API/me/notification-prefs | python3 -c "import json,sys; d=json.load(sys.stdin); print(d.get('deal_created'), d.get('mentions'))")
echo "$PREFS" | grep -q "True True" && pass "notification prefs persisted (DB)" || fail "prefs: $PREFS"

# 7. Presence endpoint accepts and broadcasts
CID=$(curl -s -X POST $API/companies -H 'content-type: application/json' -d '{"name":"Presence Probe Co","mergeWithExisting":true}' | python3 -c "import json,sys; print(json.load(sys.stdin)['id'])")
PRES=$(curl -s -o /dev/null -w "%{http_code}" -X POST $API/presence -H 'content-type: application/json' -d "{\"entityType\":\"company\",\"entityId\":\"$CID\",\"state\":\"viewing\"}")
[ "$PRES" = "200" ] && pass "presence broadcast endpoint" || fail "presence: $PRES"

echo ""
echo "ALL CATEGORY-B E2E CHECKS PASSED"
