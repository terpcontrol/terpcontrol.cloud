#!/bin/sh
# Generate a self-signed cert/key for the MQTTS listener and print the
# base64-encoded PEM values to paste into .env. For testing only; use a
# properly issued certificate in production.
set -eu

HOST="${1:-}"
if [ -z "$HOST" ]; then
  echo "usage: $0 <mqtt-host-or-ip>" >&2
  echo "  <mqtt-host-or-ip> must match what clients connect to (CN/SAN)." >&2
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

echo "# Paste these into your .env:"
echo "MQTTS_CERT_PEM_B64=$(b64 "$TMP/server.crt")"
echo "MQTTS_KEY_PEM_B64=$(b64 "$TMP/server.key")"
echo "# Self-signed: the cert is its own CA. Provision it to devices as the CA cert."
echo "MQTTS_CA_PEM_B64=$(b64 "$TMP/server.crt")"
