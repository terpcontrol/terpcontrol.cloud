# MQTTS certificates

Drop the broker's TLS material in this directory to enable the encrypted MQTT
listener on port 8883. The plaintext listener on 1883 stays available regardless,
so legacy firmware keeps working.

Expected files:
- `server.crt` — broker certificate (required)
- `server.key` — broker private key (required)
- `ca.crt` — CA certificate (optional; enables `cacertfile`)

If `server.crt` and `server.key` are absent, RabbitMQ starts with the plaintext
listener only.

## Generate a self-signed cert for testing

```sh
openssl req -x509 -newkey rsa:2048 -nodes \
  -keyout server.key -out server.crt -days 365 \
  -subj "/CN=your-mqtt-host"
```

Use the host clients connect to as the `CN` (or add a Subject Alternative Name).
The current config sets `verify_none`, so clients are not required to present a
certificate; for production, supply a proper CA and tighten `ssl_options.verify`.
