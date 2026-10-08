---
summary: Running MQTTS beyond the README's setup - certificate lifetimes, rotating on a deploy host, rolling TLS firmware out without stranding devices, switching MQTTS off again, and what losing the CA key means
updated: 2026-10-08
source: PR #28 (2026-06-30, CA key in a file because terminals truncate a pasted line at 1024 bytes); scripts/setup-mqtts.sh, rabbitmq/, build-fw.sh, firmware/dev-build.sh, firmware/dev-provision.sh and firmware/src/fridgecloud.cpp as of 2026-10-08
paths:
  - scripts/setup-mqtts.sh
  - rabbitmq/**
  - build-fw.sh
  - firmware/dev-build.sh
  - firmware/dev-provision.sh
  - firmware/src/fridgecloud.cpp
---
# MQTTS certificates

Setting MQTTS up and rotating the server certificate are in the README
([MQTT transport](../../README.md#mqtt-transport)). This is the rest.

## Lifetimes

`scripts/setup-mqtts.sh` signs the server certificate for 365 days and makes the CA for 20 years. The end date of the
certificate in use:

```sh
grep '^MQTTS_CERT_PEM_B64=' .env | cut -d= -f2- | base64 -d | openssl x509 -noout -subject -enddate
```

Rotate before that date. A rotation needs no firmware, because devices trust the CA, not the certificate. The
certificate names `MQTT_HOST_EXTERNAL`, or the host passed as the script's argument; a new host name therefore takes a
rotation and new firmware, since devices connect to the host built into theirs.

## On a deploy host

- The script rewrites the env file it resolves: run it from the deploy directory with the deploy's
  `TERPCONTROL_ENV_FILE`.
- Keep the CA key outside the deploy directory and point `MQTTS_CA_KEY_FILE` at it. The default `./mqtts-ca.key`
  would be removed by the next deploy's `rsync --delete`.
- Serve the new certificate with `./up.sh rabbitmq`, given the deploy's `TERPCONTROL_ENV_FILE` and
  `COMPOSE_OPTIONS`. The script's closing hint, `docker compose up -d rabbitmq`, reaches the right stack only where
  project name and env file are the defaults.

## Turning MQTTS on for devices in the field

1. `./scripts/setup-mqtts.sh`, a copy of the CA key somewhere safe, `./up.sh rabbitmq`. The TLS listener has to be
   up before any device gets TLS firmware; the plaintext listener stays.
2. Make sure devices reach `MQTTS_PORT_EXTERNAL` (port forwarding, firewall). A device on TLS firmware that cannot
   reach it drops off the broker and hears no further firmware instructions.
3. Try one device first. `FW_UPLOAD_VERSION=<label> ./build-fw.sh <type>` uploads the build without moving any
   channel and prints its id; as an administrator pin one device to it, `PATCH /v1/devices/<id>` with
   `{ "firmware": { "channel": "manual", "targetId": "<build id>" } }`, and watch it come back online. Plain
   `./build-fw.sh` puts each build on the stable and beta channels of its class straight away
   ([ci-and-release.md](../knowledge/ci-and-release.md#firmware-releases)).
4. Then the rest: `./build-fw.sh`, and the pinned device back on its channel (`"channel": "stable", "targetId": null`).

## Switching MQTTS off

1. Empty `MQTTS_CERT_PEM_B64`, `MQTTS_KEY_PEM_B64` and `MQTTS_CA_PEM_B64` in the env file (keep the values), and leave
   the broker running: devices on TLS firmware need the TLS listener to receive the next firmware.
2. `./build-fw.sh`. Without a CA it builds for the plaintext port. Wait until every device reports the new firmware.
3. `./up.sh rabbitmq`. The broker comes back without the TLS listener.

Anything that recreates the broker between steps 1 and 3 - every deploy runs `./up.sh` - drops the TLS listener
early. Put the values back and `./up.sh rabbitmq` until the devices have moved.

Devices provisioned over USB (`./provision-fw.sh`) while MQTTS was configured carry the CA and a TLS flag in their
NVS, which wins over the build settings: on plaintext firmware they speak TLS to the plaintext port. Re-provision them
over USB, or keep the TLS listener.

## The CA key

Without `mqtts-ca.key` nothing more can be signed by that CA, and a new CA means new firmware on every device. The
script never creates a new CA while `MQTTS_CA_PEM_B64` is set and never overwrites an existing key file. The key is
not in `./backup.sh` either ([backup-and-restore.md](backup-and-restore.md#what-a-backup-holds)).
