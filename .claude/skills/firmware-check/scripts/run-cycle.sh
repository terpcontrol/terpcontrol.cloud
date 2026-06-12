#!/usr/bin/env bash
# One firmware-check cycle: pre-create a firmware record per hardware type,
# build each one with that fixed id, then update each device class to point
# at the new firmware (rollout).
#
# Caller is responsible for polling /device until devices report the new id
# (see verify.py).
#
# Usage:
#   run-cycle.sh <tag> <hw1> [<hw2> ...]
#
# Env:
#   API_URL_EXTERNAL  - server URL (read from .env)
#   AUTOMATION_TOKEN  - admin token (read from .env)
#
# Writes:
#   /tmp/fw_state_<tag>   - "<hw> <firmware_id>" per line, for verify.py

set -euo pipefail

if [ $# -lt 2 ]; then
  echo "usage: $0 <tag> <hw1> [<hw2> ...]" >&2
  exit 2
fi

TAG="$1"; shift
HARDWARES="$@"

# bash 3.2-compatible (macOS default): no associative arrays — use a state file.
STATE=/tmp/fw_state_${TAG}
: > "$STATE"

# Load API_URL_EXTERNAL and AUTOMATION_TOKEN from .env if not already set.
if [ -z "${API_URL_EXTERNAL:-}" ] || [ -z "${AUTOMATION_TOKEN:-}" ]; then
  if [ -f .env ]; then
    # shellcheck disable=SC2046
    export $(grep -v '^#' .env | grep -v CUSTOM_LINKS_HTML | xargs)
  fi
fi
: "${API_URL_EXTERNAL:?must be set}"
: "${AUTOMATION_TOKEN:?must be set}"

get_admin() {
  curl -s -X POST "$API_URL_EXTERNAL/tokenlogin" -H 'Content-Type: application/json' \
    -d "{\"token\":\"$AUTOMATION_TOKEN\"}" \
    | python3 -c "import json,sys; print(json.load(sys.stdin)['userToken']['token'])"
}

ADMIN=$(get_admin)

for HW in $HARDWARES; do
  RESP=$(curl -s -X POST "$API_URL_EXTERNAL/device/firmware" \
    -H "Authorization: Bearer $ADMIN" -H 'Content-Type: application/json' \
    -d "{\"name\":\"$HW\",\"version\":\"$TAG\"}")
  ID=$(echo "$RESP" | python3 -c "import json,sys; print(json.load(sys.stdin)['firmware_id'])")
  echo "$HW $ID" >> "$STATE"
  echo "[$HW] pre-created firmware_id=$ID"
done

# Build sequentially. The </dev/null is mandatory — build-fw.sh uses
# `docker run -i` / `docker exec -i`, which consume the while-read loop's
# stdin and skip later iterations otherwise.
while read HW ID; do
  echo "[$HW] building..."
  FW_VERSION_ID="$ID" FW_UPLOAD_VERSION="$TAG" \
    ./build-fw.sh "$HW" </dev/null >/tmp/build_${HW}_${TAG}.log 2>&1
  echo "[$HW] built"
done < "$STATE"

# Admin token has a 5 min TTL and the build can take longer; refresh it.
ADMIN=$(get_admin)

while read HW ID; do
  CLASS=$(curl -s "$API_URL_EXTERNAL/device/class/find/$HW" \
    -H "Authorization: Bearer $ADMIN")
  CLASS_ID=$(echo "$CLASS" | python3 -c "import json,sys; print(json.load(sys.stdin)['class_id'])")
  BODY=$(echo "$CLASS" | python3 -c "
import json,sys
c=json.load(sys.stdin)
c['firmware_id']='$ID'
c['beta_firmware_id']='$ID'
print(json.dumps({k:c[k] for k in ('name','description','firmware_id','beta_firmware_id','concurrent','maxfails')}))
")
  RESP=$(curl -s -X POST "$API_URL_EXTERNAL/device/class/$CLASS_ID" \
    -H "Authorization: Bearer $ADMIN" -H 'Content-Type: application/json' -d "$BODY")
  echo "[$HW] rollout: $RESP target=$ID"
done < "$STATE"

echo "[done] rollout sent at $(date +%s); targets in $STATE"
