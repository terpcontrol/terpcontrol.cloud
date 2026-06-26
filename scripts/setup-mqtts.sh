#!/bin/sh
# Configure MQTTS for the broker and firmware using a proper CA.
#
# The firmware pins the CA certificate (not the server leaf), so the broker's
# server certificate can be rotated as often as you like by re-signing it with
# the same CA — no firmware rebuild, no fleet outage. This is the whole reason
# for a CA: the trust anchor on the device outlives any single server cert.
#
# First run (no MQTTS_CA_PEM_B64 in .env):
#   - generates a CA (cert + key) and a server cert signed by it
#   - writes MQTTS_CERT/KEY/CA_PEM_B64 into .env
#   - prints the CA PRIVATE KEY (base64) once. Save it somewhere safe; it is
#     the secret required to issue future server certs and is deliberately NOT
#     stored in .env.
#
# Rotation run (MQTTS_CA_PEM_B64 already in .env):
#   - asks for the saved CA private key (or read from $MQTTS_CA_KEY_B64)
#   - issues a fresh server cert signed by the existing CA
#   - leaves MQTTS_CA_PEM_B64 unchanged so devices keep trusting it
#
# The host (cert CN/SAN) defaults to MQTT_HOST_EXTERNAL from .env; pass an
# explicit host as the first argument to override.
set -eu

ENV_FILE="${TERPCONTROL_ENV_FILE:-.env}"
if [ ! -f "$ENV_FILE" ]; then
  echo "error: $ENV_FILE not found. Copy .env.sample first." >&2
  exit 1
fi

HOST="${1:-}"
if [ -z "$HOST" ]; then
  HOST=$(grep -E '^MQTT_HOST_EXTERNAL=' "$ENV_FILE" | head -n1 | sed 's/^[^=]*=//' | tr -d '"')
fi
if [ -z "$HOST" ]; then
  echo "error: MQTT_HOST_EXTERNAL is not set in $ENV_FILE and no host was passed." >&2
  echo "usage: $0 [<mqtt-host-or-ip>]" >&2
  exit 1
fi

env_value() { grep -E "^$1=" "$ENV_FILE" | head -n1 | sed 's/^[^=]*=//'; }
b64() { base64 < "$1" | tr -d '\n'; }

# Where the CA private key is saved on first run and read from on rotation.
# Override with MQTTS_CA_KEY_FILE. It is gitignored; treat it as a secret.
CA_KEY_FILE="${MQTTS_CA_KEY_FILE:-./mqtts-ca.key}"

# SAN must use IP: for a literal IPv4 and DNS: for a hostname, otherwise
# OpenSSL rejects the value.
if printf '%s' "$HOST" | grep -Eq '^[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+$'; then
  SAN="IP:$HOST"
else
  SAN="DNS:$HOST"
fi

TMP=$(mktemp -d)
NEW_ENV=$(mktemp)
trap 'rm -rf "$TMP"; rm -f "$NEW_ENV"' EXIT

EXISTING_CA=$(env_value MQTTS_CA_PEM_B64)

if [ -n "$EXISTING_CA" ]; then
  # --- Rotation: re-sign a new server cert with the existing CA ---
  echo "Existing MQTTS CA detected in $ENV_FILE; rotating the server certificate." >&2
  printf '%s' "$EXISTING_CA" | base64 -d > "$TMP/ca.crt"

  # Load the CA private key into $TMP/ca.key. Pasting a ~2KB base64 blob at a
  # prompt is unreliable — terminals cap one line of canonical input at 1024
  # bytes (MAX_CANON) and silently truncate — so the key is read from a FILE.
  # Sources, in order: $MQTTS_CA_KEY_B64 (automation), $CA_KEY_FILE if it
  # exists, otherwise prompt for a path. A file may hold either the PEM itself
  # or its base64 encoding; both are accepted.
  load_ca_key() {
    src="$1"
    # PEM or base64? Detect on the first line.
    if head -n1 "$src" | grep -q 'BEGIN .*PRIVATE KEY'; then
      cp "$src" "$TMP/ca.key"
    else
      tr -d '\n' < "$src" | base64 -d > "$TMP/ca.key" 2>/dev/null \
        || { echo "error: $src is neither a PEM key nor valid base64." >&2; return 1; }
    fi
  }

  if [ -n "${MQTTS_CA_KEY_B64:-}" ]; then
    printf '%s' "$MQTTS_CA_KEY_B64" | base64 -d > "$TMP/ca.key" 2>/dev/null \
      || { echo "error: MQTTS_CA_KEY_B64 is not valid base64." >&2; exit 1; }
  elif [ -f "$CA_KEY_FILE" ]; then
    echo "Using CA private key from $CA_KEY_FILE." >&2
    load_ca_key "$CA_KEY_FILE" || exit 1
  else
    printf 'Path to the saved CA private key file: ' >&2
    IFS= read -r KEY_PATH
    [ -n "$KEY_PATH" ] && [ -f "$KEY_PATH" ] \
      || { echo "error: no readable CA key file provided; cannot sign a new server cert." >&2; exit 1; }
    load_ca_key "$KEY_PATH" || exit 1
  fi

  # Fail early if the supplied key does not match the CA cert on file.
  CRT_MOD=$(openssl x509 -noout -modulus -in "$TMP/ca.crt" | openssl md5)
  KEY_MOD=$(openssl rsa  -noout -modulus -in "$TMP/ca.key" 2>/dev/null | openssl md5)
  if [ "$CRT_MOD" != "$KEY_MOD" ]; then
    echo "error: the provided CA private key does not match MQTTS_CA_PEM_B64 in $ENV_FILE." >&2
    exit 1
  fi
else
  # --- First run: create the CA ---
  echo "No MQTTS CA in $ENV_FILE; generating a new CA and server certificate." >&2
  openssl genrsa -out "$TMP/ca.key" 2048 2>/dev/null
  openssl req -x509 -new -nodes -key "$TMP/ca.key" -sha256 -days 3650 \
    -subj "/CN=$HOST MQTTS CA" -out "$TMP/ca.crt" 2>/dev/null

  # Persist the CA key to a file so rotation can read it back without an
  # error-prone interactive paste. Refuse to clobber an unrelated key file.
  if [ -e "$CA_KEY_FILE" ]; then
    echo "error: $CA_KEY_FILE already exists; refusing to overwrite. Move it aside or set MQTTS_CA_KEY_FILE." >&2
    exit 1
  fi
  cp "$TMP/ca.key" "$CA_KEY_FILE"
  chmod 600 "$CA_KEY_FILE"
fi

# Issue the server cert signed by the CA (same path for first run and rotation).
openssl genrsa -out "$TMP/server.key" 2048 2>/dev/null
openssl req -new -key "$TMP/server.key" -subj "/CN=$HOST" -out "$TMP/server.csr" 2>/dev/null
printf 'subjectAltName=%s\n' "$SAN" > "$TMP/ext.cnf"
openssl x509 -req -in "$TMP/server.csr" \
  -CA "$TMP/ca.crt" -CAkey "$TMP/ca.key" -CAcreateserial \
  -days 365 -sha256 -extfile "$TMP/ext.cnf" -out "$TMP/server.crt" 2>/dev/null

CERT_B64=$(b64 "$TMP/server.crt")
KEY_B64=$(b64 "$TMP/server.key")
CA_B64=$(b64 "$TMP/ca.crt")

# Rewrite the three MQTTS_*_PEM_B64 lines in place (append if missing). Written
# to a temp file and moved over atomically so a half-written .env is never seen.
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

if [ -n "$EXISTING_CA" ]; then
  cat >&2 <<EOF

Rotated the MQTTS server certificate (CN=$HOST, 365d). The CA is unchanged, so
devices already trusting it need no firmware update.

Next steps:
  1. docker compose up -d rabbitmq   # serve the new server cert on 8883
EOF
else
  cat >&2 <<EOF

Generated a new MQTTS CA and server certificate (CN=$HOST).
MQTTS_CERT/KEY/CA_PEM_B64 written into $ENV_FILE.

>>> The CA PRIVATE KEY was saved to: $CA_KEY_FILE  (chmod 600, gitignored)
>>> This is the secret needed to rotate the server cert later. Keep a backup
>>> somewhere safe; rotation reads it from this path automatically.

Next steps:
  1. docker compose up -d rabbitmq   # picks up the new cert, enables 8883
  2. ./build-fw.sh                   # bakes the CA into the firmware build
EOF
fi
