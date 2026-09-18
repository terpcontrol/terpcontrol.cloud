#!/usr/bin/env bash
# One firmware-check cycle: pre-create a firmware record per hardware type,
# build each one with that fixed id, then point each device class at the new
# firmware (rollout).
#
# Caller is responsible for polling the fleet until devices report the new id
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

# Everything below is the versioned API; only the device's own routes are
# unversioned, and the build container is the only thing that calls those.
API="${API_URL_EXTERNAL}/v1"

get_admin() {
  curl -s -X POST "$API/sessions/automation" -H 'Content-Type: application/json' \
    -d "{\"token\":\"$AUTOMATION_TOKEN\"}" \
    | python3 -c "import json,sys; print(json.load(sys.stdin)['userToken']['token'])"
}

# The id of the device class with this name. There are a handful of classes, so
# one page holds them all and the name is matched here.
class_id() {
  curl -s "$API/admin/device-classes?limit=200" -H "Authorization: Bearer $ADMIN" \
    | python3 -c "
import json,sys
for c in json.load(sys.stdin)['items']:
    if c['name'] == sys.argv[1]:
        print(c['id'])
        break
" "$1"
}

ADMIN=$(get_admin)

for HW in $HARDWARES; do
  CLASS=$(class_id "$HW")
  if [ -z "$CLASS" ]; then
    echo "[$HW] no device class of that name" >&2
    exit 1
  fi
  RESP=$(curl -s -X POST "$API/admin/firmwares" \
    -H "Authorization: Bearer $ADMIN" -H 'Content-Type: application/json' \
    -d "{\"classId\":\"$CLASS\",\"name\":\"$HW\",\"version\":\"$TAG\"}")
  ID=$(echo "$RESP" | python3 -c "import json,sys; print(json.load(sys.stdin)['id'])")
  echo "$HW $ID" >> "$STATE"
  echo "[$HW] pre-created firmware id=$ID"
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
  CLASS=$(class_id "$HW")
  # All three channels get the same id: a device is only offered an update from
  # the channel its `firmware.channel` names, so leaving one alone means devices
  # on that channel silently sit on their old firmware while the cycle waits for
  # them. `firmwareIds` is written whole, which is what sets all three at once.
  RESP=$(curl -s -X PATCH "$API/admin/device-classes/$CLASS" \
    -H "Authorization: Bearer $ADMIN" -H 'Content-Type: application/json' \
    -d "{\"firmwareIds\":{\"stable\":\"$ID\",\"beta\":\"$ID\",\"alpha\":\"$ID\"}}")
  echo "[$HW] rollout: $RESP target=$ID"
done < "$STATE"

echo "[done] rollout sent at $(date +%s); targets in $STATE"
