---
summary: Getting a device onto a server - WiFi setup, "change server" from the display or a phone, claiming it, moving an old Plantalytix module over - and what each refusal means
updated: 2026-10-08
source: PR #75 (2026-08-25, phone setup); commit 7f85cc22 (2026-10-04, steps for old modules in the app); firmware/src/wifi.cpp, firmware/src/fridgecloud.cpp, firmware/html/index.html, the server's device registration and the webapp's claim screen as of 2026-10-08
paths:
  - firmware/src/wifi.cpp
  - firmware/src/fridgecloud.cpp
  - firmware/html/**
  - server/src/modules/device-protocol/device-registration.service.ts
  - webapp/src/screens/claim/**
---
# Connecting a device to a server

Everything here starts in the device's menu under **WiFi Connection**.

## What the server needs

- `ENABLE_SELF_REGISTRATION=true`, and `SELF_REGISTRATION_PASSWORD`: the join password typed on the device.
- A build on the stable channel of the device's class. Registering, the device downloads that build and installs it.
  `./build-fw.sh` puts each build there unless `FW_UPLOAD_VERSION` is set (README,
  [Firmware building](../../README.md#firmware-building)).

## 1. WiFi

A device without WiFi offers two ways:

- **use mobile phone**: the device opens a network of its own, `TERP_` and six characters, and the display says which
  network to join and which address to open (`connect to wifi:` / `open in browser:`). A phone that joins usually
  lands on the setup page by itself. Pick the home network from the scan list (each name appears once) and enter its
  password. Names are trimmed, passwords are used exactly as typed, and the page warns about a space at either end.
- **use display**: pick the network from a scan and type the password with the knob.

## 2. Change server

**change server**, then one of:

- **use display**: the server address (prefilled with the one the firmware was built for) and the join password,
  typed with the knob;
- **use mobile phone**: needs WiFi (`no wifi connection` otherwise). The display shows `open in browser:` and the
  device's address; open it on a phone in the same network and enter the address (prefilled the same way) and the
  join password. The page answers for ten minutes, the display stays on for three.

Either way the device registers at that server, downloads the build the server names, installs it and restarts. The
address lives in that firmware, so the change survives restarts. A refusal shows `connection failed!` on the device
and nothing more; the server's log says why:

| Server log | Cause |
| --- | --- |
| `REGISTRATION DISABLED` | `ENABLE_SELF_REGISTRATION` is not `true` |
| `WRONG PASSWORD` | the join password is not `SELF_REGISTRATION_PASSWORD` |
| `Registration refused: no device class named <type>` | hardware this server does not serve; the classes it creates are `fridge`, `controller`, `plug`, `fan` and `light` |
| `Registering device <id> ...` and no refusal, but the device stays where it was | its class has no build on stable, so there was nothing to download: `./build-fw.sh`, then change server again |
| nothing | the device did not reach the server: address, `http`/`https`, network |

## 3. Claim

**connect to portal** shows a pairing code; enter it in the app when adding a device. A device has a code only once it
is registered at the server the app talks to.

## An old Plantalytix / Fridge Grow 2.0 module

It still talks to the old cloud and shows no code here until it is moved over. Without **change server** in its menu
it needs a newer firmware first: [UPGRADING-FIRMWARE.md](../../UPGRADING-FIRMWARE.md). Then **change server** with
this install's address - the field starts as `http://`, so for `https` delete the `://` before typing the `s` - and
the join password, wait for the update and the restart, and **connect to portal** for the code. The app shows these
steps folded under the code field of the claim's first step and of an empty Start
(`webapp/src/screens/claim/LegacyMove.tsx`).
