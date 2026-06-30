#!/bin/bash
set -e

DEVICE_TYPE="$1"
if [ -z "$DEVICE_TYPE" ]; then
    echo "Usage: $0 <device-type>"
    echo "Device types: fridge, controller, plug, light, fan"
    exit 1
fi

# On the host the shared helper resolves and loads the env file (honouring
# TERPCONTROL_ENV_FILE, then ./.env, then ../.env). Inside the build container
# scripts/ is not copied in and the env arrives via `docker run -e`, so the
# helper is sourced only when present.
ENV_HELPER="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)/scripts/load-env.sh"
if [ -f "$ENV_HELPER" ]; then
    . "$ENV_HELPER"
    terpcontrol_load_env
fi

if [ -z "$FG_AUTOMATION_TOKEN" ]; then
  export FG_AUTOMATION_TOKEN="$AUTOMATION_TOKEN"
fi
if [ -z "$FG_AUTOMATION_URL" ]; then
  export FG_AUTOMATION_URL="$API_URL_EXTERNAL"
fi
if [ -z "$FG_API_URL" ]; then
  export FG_API_URL="$API_URL_EXTERNAL"
fi
if [ -z "$FG_MQTT_HOST" ]; then
  export FG_MQTT_HOST="$MQTT_HOST_EXTERNAL"
fi
if [ -z "$FG_MQTT_PORT" ]; then
  # When a CA is supplied without an explicit port, default to the TLS port.
  if [ -n "$FG_MQTT_CA_PEM_B64" ] || [ -n "$MQTTS_CA_PEM_B64" ]; then
    export FG_MQTT_PORT="${MQTTS_PORT_EXTERNAL:-8883}"
  else
    export FG_MQTT_PORT="$MQTT_PORT_EXTERNAL"
  fi
fi

# Materialize MQTTS_CA_PEM_B64 from .env into a file so cli.py provision can
# bake it into NVS via its existing FG_MQTT_CA_CERT path. Site-specific
# overrides via FG_MQTT_CA_CERT / FG_MQTT_TLS still win.
: "${FG_MQTT_CA_PEM_B64:=${MQTTS_CA_PEM_B64:-}}"
if [ -n "$FG_MQTT_CA_PEM_B64" ] && [ -z "$FG_MQTT_CA_CERT" ]; then
  CA_PATH="/tmp/fg_mqtt_ca.pem"
  printf '%s' "$FG_MQTT_CA_PEM_B64" | base64 -d > "$CA_PATH"
  export FG_MQTT_CA_CERT="$CA_PATH"
  : "${FG_MQTT_TLS:=1}"
  export FG_MQTT_TLS
fi

fgcli.py provision "$DEVICE_TYPE" "$DEVICE_TYPE"