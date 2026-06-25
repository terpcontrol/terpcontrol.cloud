#!/bin/sh
set -eu

CONF=/etc/rabbitmq/conf.d/rabbitmq.conf

if [ -z "${MQTTAUTH_SHARED_SECRET:-}" ]; then
  echo "FATAL: MQTTAUTH_SHARED_SECRET is not set; refusing to start rabbitmq." >&2
  exit 1
fi

# The secret is interpolated into a URL path segment (see rabbitmq.conf, C4),
# so we URL-encode every non-unreserved character. Express's :secret param
# will URL-decode it back to the original value before the auth middleware
# does its constant-time compare.
encoded=$(printf '%s' "$MQTTAUTH_SHARED_SECRET" | awk '
  BEGIN { for (i = 0; i < 256; i++) hex[sprintf("%c", i)] = sprintf("%%%02X", i) }
  {
    for (i = 1; i <= length($0); i++) {
      c = substr($0, i, 1)
      if (c ~ /[A-Za-z0-9._~-]/) printf "%s", c
      else printf "%s", hex[c]
    }
  }')

# Escape sed metacharacters in the (already URL-safe) replacement value.
escaped=$(printf '%s' "$encoded" | sed -e 's/[\\|&]/\\&/g')
sed -i "s|@MQTTAUTH_SHARED_SECRET@|${escaped}|g" "$CONF"

# Enable the TLS MQTT listener only when the cert/key are supplied as
# base64-encoded PEM config values, so deployments without them keep working on
# the plaintext listener alone. The HTTP auth backend from the base config
# applies to this listener too.
CERTS_DIR=/etc/rabbitmq/certs
if [ -n "${MQTTS_CERT_PEM_B64:-}" ] && [ -n "${MQTTS_KEY_PEM_B64:-}" ]; then
  echo "MQTTS cert/key provided; enabling TLS MQTT listener on 8883." >&2
  mkdir -p "$CERTS_DIR"
  printf '%s' "$MQTTS_CERT_PEM_B64" | base64 -d > "$CERTS_DIR/server.crt"
  printf '%s' "$MQTTS_KEY_PEM_B64"  | base64 -d > "$CERTS_DIR/server.key"
  chmod 600 "$CERTS_DIR/server.key"

  cat >> "$CONF" <<EOF

mqtt.listeners.ssl.default = 8883
ssl_options.certfile = $CERTS_DIR/server.crt
ssl_options.keyfile  = $CERTS_DIR/server.key
ssl_options.verify   = verify_none
ssl_options.fail_if_no_peer_cert = false
EOF

  if [ -n "${MQTTS_CA_PEM_B64:-}" ]; then
    printf '%s' "$MQTTS_CA_PEM_B64" | base64 -d > "$CERTS_DIR/ca.crt"
    echo "ssl_options.cacertfile = $CERTS_DIR/ca.crt" >> "$CONF"
  fi
else
  echo "No MQTTS cert/key configured; starting with plaintext MQTT only." >&2
fi

exec docker-entrypoint.sh "$@"

