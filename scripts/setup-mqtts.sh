#!/bin/sh
# Generate a self-signed RSA cert/key for the MQTTS broker listener and write
# the base64-encoded PEM values into .env so the next `docker compose up` and
# the next `./build-fw.sh` both pick them up. Idempotent: re-running rotates
# the cert/key in place.
#
# The hostname is taken from MQTT_HOST_EXTERNAL in .env so the cert CN/SAN
# matches what devices actually connect to. Pass an explicit host as the first
# argument to override.
set -eu

ENV_FILE="${TERPCONTROL_ENV_FILE:-.env}"
if [ ! -f "$ENV_FILE" ]; then
  echo "error: $ENV_FILE not found. Copy .env.sample first." >&2
  exit 1
fi

HOST="${1:-}"
if [ -z "$HOST" ]; then
  HOST=$(grep -E '^MQTT_HOST_EXTERNAL=' "$ENV_FILE" | head -n1 | sed 's/^[^=]*=//' | tr -d '"' )
fi
if [ -z "$HOST" ]; then
  echo "error: MQTT_HOST_EXTERNAL is not set in $ENV_FILE and no host was passed." >&2
  echo "usage: $0 [<mqtt-host-or-ip>]" >&2
  exit 1
fi

TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT

openssl req -x509 -newkey rsa:2048 -nodes \
  -keyout "$TMP/server.key" -out "$TMP/server.crt" -days 365 \
  -subj "/CN=$HOST" -addext "subjectAltName=DNS:$HOST,IP:$HOST" 2>/dev/null \
  || openssl req -x509 -newkey rsa:2048 -nodes \
       -keyout "$TMP/server.key" -out "$TMP/server.crt" -days 365 \
       -subj "/CN=$HOST"

# base64 without line wrapping so the value fits a single .env line.
b64() { base64 < "$1" | tr -d '\n'; }
CERT_B64=$(b64 "$TMP/server.crt")
KEY_B64=$(b64 "$TMP/server.key")
# Self-signed: the cert is its own CA. Devices verify the broker against it.
CA_B64=$CERT_B64

# Replace each MQTTS_*_PEM_B64 line in place if present, otherwise append. We
# write to a temp file and atomically move it over the original so a half-
# written .env is never observable.
NEW_ENV=$(mktemp)
trap 'rm -f "$NEW_ENV"; rm -rf "$TMP"' EXIT

awk -v cert="$CERT_B64" -v key="$KEY_B64" -v ca="$CA_B64" '
  /^MQTTS_CERT_PEM_B64=/ { print "MQTTS_CERT_PEM_B64=" cert; seen_cert=1; next }
  /^MQTTS_KEY_PEM_B64=/  { print "MQTTS_KEY_PEM_B64="  key;  seen_key=1;  next }
  /^MQTTS_CA_PEM_B64=/   { print "MQTTS_CA_PEM_B64="   ca;   seen_ca=1;   next }
  { print }
  END {
    if (!seen_cert) print "MQTTS_CERT_PEM_B64=" cert
    if (!seen_key)  print "MQTTS_KEY_PEM_B64="  key
    if (!seen_ca)   print "MQTTS_CA_PEM_B64="   ca
  }
' "$ENV_FILE" > "$NEW_ENV"

mv "$NEW_ENV" "$ENV_FILE"

cat <<EOF
MQTTS cert/key written into $ENV_FILE (CN=$HOST, 365d validity).

Next steps:
  1. docker compose up -d rabbitmq   # picks up the new cert, enables 8883
  2. ./build-fw.sh                   # bakes the CA into the firmware build
EOF
