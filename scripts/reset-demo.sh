#!/usr/bin/env bash
#
# Reset PashuRaksha's demo data to a known-good state.
#
# Rebuilds exactly what the dashboards need to look alive: a national spread of
# reports with real outbreak clusters, plus one case owned by a demo farmer so
# the farmer-facing "My Reports" tab isn't empty.
#
# Safe to run repeatedly. DESTRUCTIVE: it deletes every existing report and lab
# sample first. The Pashu Aadhaar registry is never touched -- the backend
# re-seeds that from livestock_registry.py on startup.
#
#   ./scripts/reset-demo.sh                                  # localhost:8000, asks first
#   ./scripts/reset-demo.sh --api https://<backend>/api/v1   # a deployment
#   ./scripts/reset-demo.sh --yes                            # no prompt (CI)
#
# Requires: curl, python3.

set -euo pipefail

API="${PASHU_API:-http://localhost:8000/api/v1}"
ADMIN_ID="${PASHU_ADMIN_ID:-admin_01}"
FARMER_ID="ravi_kumar"
FARMER_TAG="900412781024"   # a Cattle registered to ravi_kumar
ASSUME_YES=0

# Pinned so a reset reproduces the same dataset every time. seed is only
# meaningful because the seeder orders its query by primary key -- see the
# order_by note in backend/main.py:seed_demo_reports.
COUNT=700
DAYS=30
HOTSPOTS=14
SEED=42
RADIUS_KM=5
MIN_CASES=3

while [[ $# -gt 0 ]]; do
  case "$1" in
    --api)      API="$2"; shift 2 ;;
    --yes|-y)   ASSUME_YES=1; shift ;;
    --count)    COUNT="$2"; shift 2 ;;
    --seed)     SEED="$2"; shift 2 ;;
    --hotspots) HOTSPOTS="$2"; shift 2 ;;
    -h|--help)  sed -n '2,20p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) echo "Unknown option: $1" >&2; exit 2 ;;
  esac
done

API="${API%/}"
ADMIN=(-H "X-User-ID: ${ADMIN_ID}" -H "X-User-Role: ADMIN")
VET=(-H "X-User-ID: vet_01" -H "X-User-Role: VET")
FARMER=(-H "X-User-ID: ${FARMER_ID}" -H "X-User-Role: FARMER")

say()  { printf '\033[1m%s\033[0m\n' "$*"; }
warn() { printf '\033[33m%s\033[0m\n' "$*" >&2; }
die()  { printf '\033[31m%s\033[0m\n' "$*" >&2; exit 1; }

# Pull one field out of a JSON response without depending on jq.
jget() { python3 -c "import json,sys; d=json.load(sys.stdin); print(eval('d'+sys.argv[1]))" "$1"; }

say "Target: ${API}"

# --- 1. Reachability -------------------------------------------------------
# A cold Vercel function plus a sleeping Neon compute can take a few seconds on
# the first request, so this gets a generous timeout before anything else runs.
curl -fsS -m 45 "${API}/health" >/dev/null 2>&1 \
  || die "Backend not reachable at ${API}/health"

# --- 2. Registry present ---------------------------------------------------
# The registry is what every report's location and ownership resolves against.
# If it's empty, seeding produces nothing useful -- and the fix is a backend
# restart (which re-seeds it), not this script.
ANIMALS=$(curl -fsS -m 45 "${API}/meta/registry-stats" | jget "['animals']")
if [[ "${ANIMALS}" -lt 1 ]]; then
  die "Livestock registry is empty. Restart the backend to re-seed it, then re-run."
fi
say "Registry: ${ANIMALS} animals present (left untouched)"

# --- 3. Confirm ------------------------------------------------------------
EXISTING=$(curl -fsS -m 45 "${ADMIN[@]}" "${API}/reports" | jget "'len(d)'" 2>/dev/null || echo "?")
if [[ "${ASSUME_YES}" -ne 1 ]]; then
  warn ""
  warn "This DELETES all ${EXISTING} existing reports and every lab sample at:"
  warn "  ${API}"
  warn "The Pashu Aadhaar registry is not affected."
  warn ""
  read -r -p 'Type "reset" to continue: ' reply
  [[ "${reply}" == "reset" ]] || die "Aborted."
fi

# --- 4. Wipe ---------------------------------------------------------------
say "Clearing reports and samples..."
curl -fsS -m 60 -X DELETE "${ADMIN[@]}" "${API}/reports" >/dev/null

# --- 5. Seed ---------------------------------------------------------------
say "Seeding ${COUNT} reports over ${DAYS} days across ${HOTSPOTS} epicentres (seed=${SEED})..."
SEED_OUT=$(curl -fsS -m 120 -X POST "${ADMIN[@]}" \
  "${API}/admin/seed-demo?count=${COUNT}&days=${DAYS}&hotspots=${HOTSPOTS}&seed=${SEED}")
python3 - "$SEED_OUT" <<'PY'
import json, sys
d = json.loads(sys.argv[1])
print(f"  created {d['reports_created']}, {d['active_cases']} active")
print("  epicentres: " + ", ".join(f"{e['district']} ({e['state']})" for e in d["epicentres"]))
PY

# --- 6. Cluster detection --------------------------------------------------
# This is what stamps cluster_id onto reports and makes the rings appear on the
# map. Without it the data is seeded but the map shows no outbreaks.
say "Running DBSCAN cluster detection (${RADIUS_KM}km, min ${MIN_CASES} cases)..."
CLUSTERS=$(curl -fsS -m 120 "${VET[@]}" \
  "${API}/analytics/clusters?radius_km=${RADIUS_KM}&min_cases=${MIN_CASES}")
python3 - "$CLUSTERS" <<'PY'
import json, sys
d = json.loads(sys.argv[1])
print(f"  {d['active_clusters_count']} active clusters")
for c in d["clusters"][:5]:
    print(f"    {c['cluster_id']}  {c['case_count']:>2} cases  {c['primary_disease']}")
if d["active_clusters_count"] > 5:
    print(f"    ... and {d['active_clusters_count'] - 5} more")
PY

# --- 7. One farmer-owned case ----------------------------------------------
# The random seed may or may not hit a given farmer's animals, so the
# farmer-facing "My Reports" tab can come up empty even on a full dataset.
# A 400 here means the seed already gave this animal an active case, which is
# the desired end state anyway -- so it is not treated as a failure.
say "Ensuring ${FARMER_ID} has a case to view..."
if curl -fsS -m 60 -X POST "${FARMER[@]}" -H "Content-Type: application/json" \
     "${API}/reports" \
     -d "{\"pashu_aadhaar\":\"${FARMER_TAG}\",\"symptoms\":[\"skin_nodules\",\"high_fever\",\"enlarged_lymph_nodes\"],\"mortality_count\":0}" \
     >/dev/null 2>&1; then
  echo "  filed a new case for ${FARMER_ID}"
else
  echo "  ${FARMER_ID} already has an active case (left as-is)"
fi

# --- 8. Verify -------------------------------------------------------------
say "Verifying..."
curl -fsS -m 60 "${ADMIN[@]}" "${API}/analytics/summary?days=30" | python3 -c "
import json, sys
d = json.load(sys.stdin)
t = d['totals']
print(f\"  reported {t['reported']} | active {t['active']} | critical {t['critical']} \"
      f\"| resolved {t['resolved']} | mortality {t['mortality']}\")
print(f\"  {len(d['states'])} states reporting, {len(d['timeseries'])}-day series, \"
      f\"registry {d['registry_size']} animals\")
assert t['reported'] > 0, 'no reports after reset'
assert len(d['states']) > 1, 'reports did not spread across states'
"
say ""
say "Done. Reload the dashboard."
