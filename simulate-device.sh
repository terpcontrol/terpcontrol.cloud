#!/bin/bash
# Simulate a grow device against a running stack - see "Simulating a device" in
# CLAUDE.md. Resolves where the stack lives from .env and hands over to
# scripts/simulate-device.mjs, which does the MQTT and HTTP talking.
set -e

cd "$(dirname "${BASH_SOURCE[0]}")"
. scripts/load-env.sh

if [ ! -f "$ENV_FILE" ]; then
  echo "error: $ENV_FILE not found - see \"Launching the stack locally\" in CLAUDE.md." >&2
  exit 1
fi
terpcontrol_load_env

if ! command -v node > /dev/null; then
  echo "error: this needs Node 18 or newer on the host." >&2
  exit 1
fi

# The .env values describe the address devices reach the stack at, which on a
# development machine is usually not the loopback address the tool itself needs.
# Override any of these when driving a stack that is not the local one.
export SIM_API_URL="${SIM_API_URL:-http://localhost:${API_PORT_EXTERNAL:-8081}}"
export SIM_MQTT_HOST="${SIM_MQTT_HOST:-localhost}"
export SIM_MQTT_PORT="${SIM_MQTT_PORT:-${MQTT_PORT_EXTERNAL:-1883}}"
export SIM_REGISTRATION_PASSWORD="${SELF_REGISTRATION_PASSWORD}"
export SIM_USER="${AGENT_TESTING_USERNAME:-$ADMINUSER_USERNAME}"
export SIM_USER_PASSWORD="${AGENT_TESTING_PASSWORD:-$ADMINUSER_PASSWORD}"

# Flagging a device as a demo device is a database property with no API behind
# it, so it is done here rather than in the simulator.
if [ "$1" = "demo" ]; then
  case "$2" in
    on)  flag=true ;;
    off) flag=false ;;
    *)   echo "usage: ./simulate-device.sh demo <on|off> [-d <device-id>]" >&2; exit 1 ;;
  esac

  device_id=sim-fridge
  prev=""
  for arg in "$@"; do
    case "$prev" in -d|--device-id) device_id="$arg" ;; esac
    prev="$arg"
  done

  matched=$(docker compose exec -T mongodb mongosh --quiet \
    -u "$MONGODB_ADMINUSERNAME" -p "$MONGODB_ADMINPASSWORD" --authenticationDatabase admin \
    "$MONGODB_DATABASE" --eval "db.devices.updateOne({device_id:'$device_id'},{\$set:{demoDevice:$flag}}).matchedCount")

  if [ "$matched" = "0" ]; then
    echo "no device $device_id - register it first" >&2
    exit 1
  fi
  if [ "$flag" = true ]; then
    echo "$device_id is now shown to everyone who uses the Demo login"
  else
    echo "$device_id is no longer a demo device"
  fi
  exit 0
fi

exec node scripts/simulate-device.mjs "$@"
