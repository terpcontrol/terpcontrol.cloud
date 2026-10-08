---
summary: The frozen contract between a device's firmware and the cloud - HTTP, every MQTT topic and payload, hardware-info, the configuration document, commands, camera relay, tunnel; read before changing firmware, the device-protocol module or the simulator
updated: 2026-10-08
source: written from the code for ADR 0001 (2026-09/10); Chris on compatibility (2026-07-09, 2026-09-17, 2026-10-06); PRs #54, #70, #77, #111, #114, #124, #136, #140, #141, #145; verified against firmware/src, firmware/src_hwtype and server/src/modules/device-protocol on 2026-10-08
paths:
  - firmware/src/**
  - firmware/src_hwtype/**
  - server/src/modules/device-protocol/**
  - server/src/modules/mqtt-auth/**
  - server/src/modules/tunnel/**
  - server/src/modules/v1/camera/terpcam-direct.service.ts
  - shared-types/src/v1/socket-report.ts
  - shared-types/src/v1/day-night.ts
  - scripts/simulate-device.mjs
---
# The Terp Control device protocol

Everything a device in the field speaks to the cloud: the HTTP requests its firmware makes, every MQTT topic in
both directions, the payload of each one key by key, and the limits a caller has to respect.

This is a **frozen contract**. ADR 0001 (`docs/adr/0001-app-rewrite-data-model.md`) rewrites the server's HTTP and
persistence layers around it and puts one `device-protocol` module in charge of it; the table in that ADR's
section "The device protocol (frozen)" is a summary and this document is the detail behind it. Not every device
will take a firmware update, so every shape here has to keep working unchanged. Anything new the cloud sends is
sent only to a device that announced it understands it (see [12 Extending it safely](#12-extending-it-safely)).

**Order of authority.** The firmware is the protocol: `firmware/src/fridgecloud.{cpp,h}` (the MQTT client, the
topics, the HTTP requests, the log queue), `firmware/src/wifi.cpp` (the `hardware-info:` reports, the smart-socket
table and its commands), `firmware/src/terpcam.cpp` (camera pairing and capture) and
`firmware/src_hwtype/<type>/` for what each hardware type reports and understands. The server
(`server/src/modules/device-protocol/`) is what currently consumes it - one module owns every route and every
topic below - and `scripts/simulate-device.mjs` is a second witness.
Where they disagree, the firmware wins; the known disagreements are listed in
[13 Where the witnesses disagree](#13-where-the-witnesses-disagree).

Line numbers are as of 2026-10-08. They drift with every firmware change; the function or constant named beside a
reference is what to search for then.

Hardware types in scope: `controller`, `fridge`, `plug`, `fan`, `light`, `cam`. The `dummy` and `*_test` build
environments are out of scope.

---

## 1 Identity, credentials and build-time constants

A device is provisioned once, at the factory, with an identity in a read-only NVS partition, and built against
one cloud. Neither can be changed over the protocol.

| Value | Source | Read at |
| --- | --- | --- |
| `device_id` | NVS partition `nvs_ro`, namespace `fg_provisioning`, key `device_id` | `fridgecloud.cpp:87` |
| MQTT username | same namespace, key `mqtt_user` | `fridgecloud.cpp:88` |
| MQTT password | same namespace, key `mqtt_password` | `fridgecloud.cpp:89` |
| `API_URL`, `MQTT_HOST`, `MQTT_PORT` | compile-time defines | `fridgecloud.cpp:91-93`, `pioenv.py:9-11` |
| `FIRMWARE_VERSION` | compile-time define; the firmware id, a uuid | `fridgecloud.cpp:18-22`, `pioenv.py:8` |
| `HWTYPE` | compile-time define per PlatformIO env | `platformio.ini:31,54,101,158,218,237` |
| TLS flag and CA | NVS `mqtt_tls` / `mqtt_ca_cert`, else the build's default and baked-in PEM | `fridgecloud.cpp:95-110` |

`mqtt_host`, `mqtt_port` and `api_url` also exist as provisioning NVS keys (`fw-buildcontainer/cli.py` writes them)
but are never read — the compile-time values win (`fridgecloud.cpp:91-93`). Changing the cloud a device talks to
therefore means flashing the other cloud's build; see [3.1](#31-post-deviceregister).

TLS is enabled only when both a flag and a CA certificate are present (`fridgecloud.cpp:110`); without a CA the
device stays on plaintext rather than connecting unverified (`:149-156`).

**Custom MQTT mode.** When NVS key `mqtt_enabled` in the read-write `settings` namespace is set, the device takes
its id, host, port, user and password from `mqtt_id`, `mqtt_server`, `mqtt_port`, `mqtt_user` and `mqtt_pass`
instead, and sets `custom_mqtt = true` (`fridgecloud.cpp:77-84`). That flag changes exactly one thing in the
protocol — how readings are published, see [5.2](#52-status-in-custom-mqtt-mode). The menu that turns it on is
compiled in for `fridge`, `plug`, `fan` and `light` only (`-DENABLE_CUSTOM_MQTT`, `platformio.ini:35,105,163,242`);
the `controller` and `cam` builds do not have it.

**The MQTT client.** `EspMQTTClient(host, port, user, password, clientId = device_id)` (`fridgecloud.cpp:141-147`),
socket and write timeout 5 s (`:158-159`), maximum packet size `MAX_PACKET_SIZE = 4096` bytes, set on every connect
(`fridgecloud.h:39`, `.cpp:182`). The client id is the device id, which the broker's `resource` check relies on (see
[4.2](#42-what-the-broker-checks)).

---

## 2 The topics at a glance

Every topic is `/devices/<device_id>/<name>`, with the device's own id. The device builds all of them at init
(`fridgecloud.cpp:116-126`).

| Topic | Direction | Published by | Consumed by |
| --- | --- | --- | --- |
| `status` | device → server | device (custom MQTT mode only, as sub-topics) | server, dropped |
| `bulk` | device → server | device, every 5 s | server: time series, alarms |
| `fetch` | device → server, on every connect | device | server: firmware report, the device's settings while the cloud has none, configuration reply |
| `log` | device → server | device | server: diary entries and `hardware-info:` |
| `configuration` | both ways | device after a change on its own menu; server after a save, on a `fetch`, after correcting an upload | the other side |
| `image` | device → server | firmware older than the camera relay, when asked for a still | server: dropped |
| `tunnel_read` | device → server | device | server: tunnel |
| `command` | server → device | server | device |
| `firmware` | server → device | server | device: OTA |
| `tunnel_write` | server → device | server | device: tunnel |
| `fwupdate` | server → device | nobody today | device: OTA from a URL |
| `control/#` | server → device | nobody today | device: direct output control |

The device subscribes to `configuration`, `firmware`, `fwupdate`, `command`, `control/#` and `tunnel_write`
(`fridgecloud.cpp:186-362`) and publishes on the rest. The server subscribes to `/devices/#`
(`device-ingest.service.ts`) and therefore also sees its own outbound messages echoed back; it ignores the echoes of
`tunnel_write`, `command` and `firmware`, drops `image` (nothing asks for a still that way any more, see
[9](#9-the-still-cycle)) and logs anything else as unhandled. The echo of its own `configuration` cannot be told from
an upload and is read as one; that is harmless because it is the document just stored, already held to every rule, so
it is stored again as it is and not sent back. Messages from one device are handled one at a time in the order they
arrived, because a report depends on the one before it (`sockets_n` before its chunks, `webcam_pwd` before
`webcam_did`).

`fwupdate` and `control/#` are subscribed by every device and **never published by the server today**. They stay
reserved, and the broker's topic rules keep covering them, so a future server can use them without a firmware
change.

---

## 3 HTTP

A device makes four kinds of request. All of them are unauthenticated in the HTTP sense — the device proves
itself with its own provisioning password in the body, or not at all.

| Request | When | Firmware |
| --- | --- | --- |
| `POST {API_URL}/device/register` | "change server" from the menu or the phone form | `fridgecloud.cpp:702-737` |
| `POST {API_URL}/device/claimcode` | "connect to portal" from the menu | `fridgecloud.cpp:675-700` |
| `GET {API_URL}/device/firmware/<id>/firmware.bin` | after a `firmware` message | `fridgecloud.cpp:587-595` |
| `GET <url>` | after an `fwupdate` message | `fridgecloud.cpp:597-673` |

`{API_URL}` is the base URL compiled into the build (`pioenv.py:11`). ADR 0001 puts the new `/v1` API under that
same base, so these four paths keep their place beside it.

### 3.1 `POST /device/register`

Body, `Content-Type: application/json` (`fridgecloud.cpp:709-714`):

| Key | Value |
| --- | --- |
| `registration_password` | the join password typed on the display or in the phone form |
| `device_type` | the `HWTYPE` string of this build |
| `device_id` | provisioning NVS `device_id` |
| `username` | provisioning NVS `mqtt_user` |
| `password` | provisioning NVS `mqtt_password` |

The firmware checks for **201** (`fridgecloud.cpp:719`). On 201 it reads `fw` from the answer and immediately
downloads `<api_url>/device/firmware/<fw>/firmware.bin`, which reboots it into the new cloud's build
(`:727-733`). Anything else is ignored, and the call returns `false` either way (`:736`): it only returns at all
when no new build was installed, and the display then says the connection failed (`wifi.cpp:1718-1724,2112`).

`registerWithCloud` persists nothing at all: the new server's address travels inside the firmware image it
fetches. That is what makes the device a device of the other cloud.

Server side: `device-protocol.controller.ts` → `device-registration.service.ts`. It answers 201 `{ fw }` where `fw` is
the device class's `firmwareIds.stable`, or 401 `{ status: 'unauthorized' }` when self-registration is off
(`ENABLE_SELF_REGISTRATION`), `registration_password` does not match `SELF_REGISTRATION_PASSWORD`, no device class is
named `device_type`, or a device with the same `device_id`, `username` and `device_type` exists and the password does
not verify. What the device signs in to the broker with is stored as `devices.mqtt`, hashed. A device with the same id
that nobody has claimed makes way for the new registration, while one somebody owns makes it fail with the same 401.
A new device is pinned to that build on the `stable` channel, so later releases reach it without anybody switching
updates on. Re-registering an existing device pins it to the same build and keeps whatever channel it follows; it
also forces `state.hardware.claimcode_auth` to `'off'`, which is what lets a re-homed device issue a claim code again.

### 3.2 `POST /device/claimcode`

Body (`fridgecloud.cpp:681-683`):

| Key | Value |
| --- | --- |
| `device_id` | the device id |
| `password` | the device's MQTT password |

The firmware checks for **200** (`:688`) and reads `claim_code` from the answer (`:696`); any other status yields
an empty string and the display shows nothing. Called from the menu entry that shows the claim code
(`wifi.cpp:1730-1733`).

Server side: `device-protocol.controller.ts` → `device-registration.service.ts`. The password is verified
**only when the device has reported `hardware-info:claimcode_auth=on`**; otherwise any caller who
knows the device id gets a code. Current firmware reports `claimcode_auth=on` at every boot
(`fridgecloud.cpp:171`). The answer is `{ claim_code }`, a 6-character code, upserted per device; an unknown
device or a wrong password answers 401 `{ status: 'unauthorized' }`.

### 3.3 `GET /device/firmware/:firmware_id/:binary`

The OTA download. The firmware builds the URL as `<API_URL>/device/firmware/<id>/firmware.bin`
(`fridgecloud.cpp:587-595`) and streams the body straight into the ESP32 `Update` partition.

What the firmware requires of the answer (`fridgecloud.cpp:597-673`):

- It accepts **any** `httpResponseCode > 0` (`:605-606`) — it does **not** check for 200. An error page would be
  written to the OTA partition and rejected later by `Update.end()`, which is a silent failure.
- `Content-Length` matters: `http.getSize()` sizes `Update.begin()` so only the bytes that will be written are
  erased (`:618`). A missing length means `UPDATE_SIZE_UNKNOWN` and a full ~2 MiB erase, during which a flaky
  link can stall the download.
- The body is read in 128-byte chunks with the watchdog fed between them (`:623,632-657`), and `ESP.restart()`
  follows a successful `Update.end(true)` (`:659-661`).

Server side: `device-protocol.controller.ts`, which streams the row of `firmwareBinaries` that carries the
build and the file name: `Content-Type: application/octet-stream`,
`Content-Disposition: attachment; filename=firmware.bin`, `Content-Length` and `Cache-Control: no-transform`.
The route is public — a device has nothing but the firmware id to offer. A build or a file name the server does
not hold answers 404, which the firmware, as above, cannot tell from an image.

The `:binary` segment is a name, not a fixed value: `firmware.bin` is what a device asks for, while
`bootloader.bin`, `partitions.bin` and `boot_app0.bin` are uploaded under the same firmware id for the
provisioning flow (`fw-buildcontainer/cli.py`).

### 3.4 The legacy `/auth/v0.0.1/device/...` aliases

| Alias | Identical to |
| --- | --- |
| `POST /auth/v0.0.1/device/claimcode` | `POST /device/claimcode` |
| `GET /auth/v0.0.1/device/firmware/:firmware_id/:binary` | `GET /device/firmware/:firmware_id/:binary` |

They are served by `LegacyDeviceProtocolController` (`device-protocol.controller.ts`) and excluded from the API
document. **No build in this repository uses them**: current firmware calls `/device/claimcode`
(`fridgecloud.cpp:678`) and `/device/firmware/...` (`:589`). They exist for builds shipped before the paths were
shortened, and have to stay until no device in the field asks for them.

### 3.5 What a device never does over HTTP

It never authenticates with a session token, never polls, and never reports readings over HTTP. Everything else
is MQTT. The outbound HTTP calls a device makes to other hosts — Tasmota commands to a smart socket
(`sendSocketPower`, `wifi.cpp:899-913`), the camera's CGI over its P2P transport, and the target of a tunnel
([9.2](#92-the-tunnel)) — are not part of this protocol.

---

## 4 The broker: authentication and authorisation

The broker is RabbitMQ with the MQTT and HTTP-auth-backend plugins (`rabbitmq/Dockerfile`). The plaintext
listener on 1883 is always on, for firmware that cannot speak TLS; a TLS listener on 8883 is added at container
start when a certificate is configured (`rabbitmq/rabbitmq.conf`, `rabbitmq/docker-entrypoint-wrapper.sh`).
Anonymous access is off.

### 4.1 How a device authenticates

With the username and password from its provisioning NVS, and its `device_id` as the MQTT client id
(`fridgecloud.cpp:141-147`). The broker asks the server over HTTP, form-encoded, at
`POST /mqttauth/<shared-secret>/{user,vhost,resource,topic}` (`rabbitmq/rabbitmq.conf`); the answer is the bare
word `allow` or `deny` with status 200 (`mqtt-auth.controller.ts`). A few refusals come as an error status instead,
which the broker reads as a refusal too: a topic outside the device's prefix (403), a resource that is neither
`amq.topic` nor the device's subscription queue (409), and a wrong shared secret (401 `deny`,
`mqtt-auth-secret.guard.ts`). These four routes are part of the frozen contract (ADR 0001).

Device passwords are stored bcrypt-hashed in `devices.mqtt`; a legacy plaintext row is compared in constant time
and re-hashed on the first successful authentication (`mqtt-auth.service.ts:44-54`,
`server/src/utils/devicepassword.ts`).

### 4.2 What the broker checks

| Check | Rule for a device |
| --- | --- |
| `user` | a device with that `username` exists and the password verifies |
| `vhost` | the device exists and `vhost === '/'` |
| `topic` | `resource` is `topic`, `name` is `amq.topic`, `routing_key` begins `.devices.<device_id>.` |
| `resource` | `vhost === '/'`, and exchange `amq.topic` or queue `mqtt-subscription-<client_id>qos0` |

Source: `mqtt-auth.service.ts:30-127`; the fields the broker posts are in `mqtt-auth.types.ts`. The server's own
connection is recognised by its username in `vhost`, `topic` and `resource` (`mqtt-auth.service.ts:64,76,104`);
its password is checked once, at `user` (`mqtt-auth.service.ts:35`).

Two consequences a caller must know:

1. **The `permission` field is never inspected.** Read and write are not told apart, so a device may both publish
   and subscribe on any topic under `/devices/<its own id>/`, including the server-only ones (`command`,
   `firmware`, `configuration`, `tunnel_write`). The protocol's direction column is a convention the firmware
   and the server keep, not something the broker enforces.
2. **The prefix is exact.** A device cannot subscribe to `/devices/#` or to another device's subtree, and the id
   in the prefix is the one **stored** against its username, not one it can claim.

### 4.3 What the server does on the wire

One subscription, `/devices/#` (`device-ingest.service.ts`). Dispatch takes `device_id` from the third segment
of the topic and the topic name from the fourth; a deeper segment says only that the message arrived below the
topic rather than on it, which is how a device in custom-MQTT mode is told from one sending a document. A message
from an id with no device document is dropped silently, and any throw while handling one is caught and logged so
one malformed message cannot end the process.

Publishing is QoS 0 with mqtt.js defaults; a publish attempted before the first successful handshake returns
`false` instead of throwing (`mqtt-client.service.ts:49-51,161-169`), which is what turns into a 503 for the
HTTP caller behind a command. After that first connection mqtt.js queues what it is given while it reconnects, so
a message sent during a blip of the server's own connection goes out when it is back; the broker keeps nothing
for a device that is not connected.

---

## 5 Readings

### 5.1 `bulk` — the normal path

**device → server.** The payload is one reading document:

```json
{ "sensors": { "temperature": 24.6, "humidity": 58 },
  "outputs": { "heater": 0.4, "light": 100 },
  "timestamp": 1758100000 }
```

- `sensors` and `outputs` are flat objects of numbers. Which keys a device sends depends on its hardware type;
  see [5.4](#54-which-keys-each-hardware-type-reports).
- `timestamp` is **epoch seconds**, added only when the device's clock is plausible (`> 1e9`,
  `fridgecloud.cpp:522-525`). Without a valid clock the sample is discarded rather than sent undated.

Cadence and buffering (`fridgecloud.cpp:503-578`, constants in `fridgecloud.h:33-35`): `updateStatus()` is
called once per control tick, and `main.cpp:284-287` runs the control tick every second. One sample in
`SAMPLE_INTERVAL = 5` is kept, so a document is produced every 5 s. It is serialised into a 512-byte buffer
(`fridgecloud.cpp:527-528`) and pushed onto a deque of at most `MAX_BUFFER_LEN = 120` entries; because
`UPLOAD_INTERVAL = 1`, the buffer is drained immediately, so the wire sees **one `bulk` message every five
seconds**. When the buffer is full the sample is dropped and `message-buffer-overflow` is logged once at severity 1
(`fridgecloud.cpp:511-517`). The drain stops on the first failed publish and keeps the rest for the next attempt
(`fridgecloud.cpp:563-575`).

Server side (`device-ingest.service.ts`): the ingest stamps `devices.state.lastSeenAt`, then hands the document
on with the instant the device dated it. Readings are written to InfluxDB, measurement `status`, tagged
`device_id` — the `user_id` tag is no longer written — sensors under their own names and outputs prefixed `out_`.
The same reading is evaluated by the alarms under the names the contract gives them, which the ingest translates
to. **A device with no owner has its readings dropped** — `lastSeenAt` is still updated.

Only known keys are stored: the fields the metric tables in `shared-types/src/v1` name, plus the controller
diagnostics beside them. A key outside those lists is silently ignored, which is the safe way to add a sensor
before the server knows it.

The firmware's "there is nothing here" figures ([5.4](#54-which-keys-each-hardware-type-reports)) are not
readings and are dropped at ingest: a `co2` at or below zero, and an `out_co2` below zero or at `4294967295`
(`server/src/common/v1/sentinels.ts`, which also drops them again where older points are read).

### 5.2 `status` in custom-MQTT mode

**device → server.** A device in custom-MQTT mode does not buffer and does not publish on `bulk`. It publishes
each value on its own sub-topic, as a bare value with no JSON envelope (`fridgecloud.cpp:543-553`):

```
/devices/<id>/status/sensors/<key>     23.5
/devices/<id>/status/outputs/<key>     1
```

These are meant for a third-party broker of the owner's choosing. If such a device is pointed at this server,
the message is taken and dropped: it arrived below `status` rather than on it, and a bare value is not a reading
document. `lastSeenAt` is stamped first, so the device still counts as online.

The server also accepts a full JSON reading document on `status` itself, and **discards its timestamp**,
recording the sample at server time. No firmware build publishes that; the simulator does.

### 5.3 `fetch` — what a device asks for when it connects

**device → server**, published synchronously at the end of every (re)connect, after the subscriptions are in
place (`publishFetchMessage`, `fridgecloud.cpp:364,370-404`):

```json
{ "firmware_id": "<FIRMWARE_VERSION>",
  "configuration": { "workmode": "small", "daynight": { "day": 21600, "night": 79200, … }, … } }
```

`configuration` is the settings document the device runs, nested as an object: the same document it publishes on
`configuration` after a change on its own menu (`serializeSettings`, handed to the cloud client with
`reportConfigWith` by the controller, fridge, plug, fan and light; the cam sends none). It arrived with #141
(2026-10-07); older builds send `firmware_id` alone. The message is built in `FETCH_DOCUMENT_SIZE = 4096` bytes,
and where that overflows, or the packet would not fit `MAX_PACKET_SIZE = 4096` with its topic, the device sends
`firmware_id` alone rather than lose it with the settings (`fridgecloud.cpp:388-395`, `fridgecloud.h:39-40`).

Server side (`device-ingest.service.ts`, `fetch`):

1. An id that differs from the stored one is handed to the rollout and then stored as
   `devices.state.firmwareId` — see [10 The OTA path](#10-the-ota-path).
2. If `devices.configuration` is not null, the server **replies** by publishing it on `configuration`, with every
   figure the firmware would misread put right first ([7](#7-the-configuration-document)). The document is stored
   as the object it is and serialised again for the reply, so a key may come back in another order than the
   device sent it in; the device parses key by key and never compares the string. The settings the device sent
   along are ignored: **a configuration the cloud holds always wins**, because the device's copy may be older
   than a change made while it was offline, and a reconnect after a dropped connection must never take back what
   the owner set (Chris, 2026-10-06).
3. If it is null - a device registered afresh, a database restored from before the device was set up - the
   settings the device sent are adopted the way an upload on `configuration` is, but by a conditional write
   (`updateOne({ id, configuration: null })`), so an app save that lands between reading the device and writing
   is kept. A build that sends none leaves the configuration null until a setting is changed on the device
   itself.
4. If the cloud keeps a maintenance window with at least a minute left, the `maintenance` command is sent again
   for the whole minutes that remain ([8.2](#82-maintenance)): the broker stores no command, so one sent while the
   device was reconnecting was lost.
5. `state.lastSeenAt` is stamped, and the rollout arms the upgrade instruction if one is pending.

A payload that is not JSON carries no `firmware_id` and is dropped rather than rejected.

### 5.4 Which keys each hardware type reports

- **controller** (`controller.cpp:1053-1086`) — sensors `temperature`, `humidity`, `sensor_type`, `co2`,
  `leaf_temperature`\*, `lux`\*; outputs `dehumidifier`, `heater`, `light`, `co2`.
- **fridge** (`fridge.cpp:1126-1150`) — sensors `temperature`, `humidity`, `co2`; outputs `co2`, `dehumidifier`,
  `heater`, `light`, `fan-internal`, `fan-external`, `fan-backwall`.
- **plug** (`plug.cpp:825-841`) — sensors `temperature`, `humidity`, `co2`, `sensor_type`; output `relais`.
- **fan** (`fan.cpp:190-209`) — sensors `temperature`†, `humidity`†, `rpm`, `day`; output `fan`.
- **light** (`light.cpp:101-120`) — sensors `temperature`†, `humidity`†; output `light`.
- **cam** — nothing; it never calls `updateStatus` (`cam.cpp:64-66`).

\* sent only when the optional sensor was detected, so no placeholder lands in the history
(`controller.cpp:1065-1073`).

† sent only once the device's sensor has given a reading since boot; until then a light sends `sensors` as an
empty object and a fan only `rpm` and `day`, so a light or fan whose sensor is missing or dead leaves nothing in
the history (`light.cpp:107-117`, `fan.cpp:196-204`, `state` in `light.h` and `fan.h`). A read that fails later
repeats the last good one, as on every type. Light and fan builds from before 2026-10-08 send `20` and `20` in
place of a reading, which the server stores like any other: no rule tells them from air.

Units and conventions:

- `sensor_type` is an enumeration, not a measurement: `0` none, `1` SHT, `2` SCD, `3` a daisy-chained slave
  (`controller.h:74-77`, `plug.h:146-149`). Only the plug ever reports `3` (`plug.cpp:731`); the controller
  sets only the first three (`controller.cpp:180,681,720`).
- When no SCD sensor is fitted, the controller reports the `co2` sensor as `-1` and the `co2` output as `4294967295`:
  the conditional that sends the output converts its `-1` to the `uint32_t` of `state.out_co2`
  (`controller.cpp:1063,1080`). A plug without one reports `co2` as `0` (`plug.cpp:84`). None of these is a reading,
  and the server drops them ([5.1](#51-bulk--the-normal-path)).
- The `co2` **output** is not a level: it is the number of ticks the valve was open since the last sample, reset
  to zero after a successful publish (`controller.cpp:1083-1086`, `fridge.cpp:1148-1150`).
- `heater` is the PID output, 0..1. `light` is a percentage, 0..100: the lamp's level after the temperature
  dimming, the sunrise and sunset ramps and the `lights.limit` cap (`state.out_light = light_current * 100`,
  `controller.cpp:316`, `fridge.cpp:382`). `dehumidifier` and `relais` are 0 or 1. The fridge's three fans are
  0..1 (`fridge.cpp:1143-1145`). The fan's `fan` output is a percentage, and its `day` sensor is `1.0` or `0.0`
  derived from a light sensor rather than the clock (`fan.cpp:57,206`).
- Only the fan reports `day`. For a controller or a fridge the cloud works day and night out of the configuration
  the way the firmware does - the schedule and the work mode, never the light output, because a lamp can be dark
  in the day ([7.3](#73-times-of-day); `shared-types/src/v1/day-night.ts`).

---

## 6 `log` and the `hardware-info:` sub-protocol

### 6.1 The log topic

**device → server.** One message per entry (`fridgecloud.cpp:438-455`):

```json
{ "severity": 0, "message": "message-device-booted:POWERON" }
```

The firmware sends exactly these two keys. The queue holds `MAX_LOG_QUEUE_LEN = 32` entries and **silently drops
anything beyond that** (`fridgecloud.h:37`, `fridgecloud.cpp:406-411`); each entry is serialised into a fixed
**384-byte** buffer (`:442-443`), which is the hard bound on how long a message may be. Publishing stops on the
first failure and resumes with the same entry at the head (`:445-453`). The queue is published from the client's
loop only, never from inside a handler. A queued reboot waits for the queue to drain (`:457-461`); the restart after
an OTA does not ([10](#10-the-ota-path)).

`message` is a `message-key:param` line. The keys resolve against `webapp/public/assets/i18n/en.json`; anything
without a translation is shown verbatim.

Server side (`device-ingest.service.ts`), in order:

1. A message starting with `hardware-info:` goes to [6.2](#62-hardware-info) and is **never** written to the
   diary.
2. Every `message-cam-capture:ok…` line is dropped, and any other `message-cam-capture:…` and
   `message-aux-command-failed:cam_capture` unless the camera the device answers for has `logErrors` on. It is off
   unless somebody turns it on, where the old setting was on unless somebody turned it off.
3. Everything else becomes a row of `entries`: `source: device`, the line parsed once into
   `message { key, params }` (the parameter is everything after the **first** colon) or kept as `text` where it
   is not a `message-` line, the severity as the model names it (0 info, 1 warning, 2 and above critical), and
   the space the device stands in. A line about the camera is attached to the camera
   (`server/src/common/v1/device-messages.ts`). The two keys the firmware sends are the two that are read — a
   `title`, `time`, `data` or `images` beside them would be ignored, where the old server stored whatever the
   object carried.

A `message-maintenance-mode-activated[-remote]:<minutes>` line additionally sets `devices.state.maintenanceUntil`.

The messages current firmware sends:

| Key | Severity | Emitted by | Where |
| --- | --- | --- | --- |
| `message-device-booted:<reason>` | 0 | every type, at init | `fridgecloud.cpp:45-59,165-169` |
| `message-device-firmware-update` | 0 | every type, queued before an OTA download; it reaches the cloud only from an attempt that failed ([10](#10-the-ota-path)) | `fridgecloud.cpp:197,217` |
| `message-buffer-overflow` | 1 | every type, reading buffer full | `fridgecloud.cpp:514` |
| `message-co2-low` | 0 | controller, fridge: CO2 under 200 ppm for 60 passes; once per low episode, re-armed by a reading at or above it (before #145 the latch was never cleared, so it practically never fired) | `controller.cpp:984-997`, `fridge.cpp:1107-1118` |
| `message-ext-sensor-deviate`, `message-ext-sensor-fail` | 0 | fridge, when the fault appears and **at most once per 15 min** each (`SENSOR_FAULT_LOG_INTERVAL`, `fridge.cpp:19,90-104`) | `fridge.cpp:206,220` |
| `message-maintenance-mode-activated:<min>` | 0 | controller, fridge, from the device's menu | `controller.cpp:1118`, `fridge.cpp:1184` |
| `message-maintenance-mode-activated-remote:<min>` | 0 | controller, fridge, on the `maintenance` command | `controller.cpp:586`, `fridge.cpp:731` |
| `message-smart-socket-connected:<role>` | 0 | pairing or `socket_set` | `wifi.cpp:3073,3408` |
| `message-smart-socket-disconnected:<role>` | 0 | removal | `wifi.cpp:2951` |
| `message-smart-socket-tested:<role>` | 0 | `socket_test` | `wifi.cpp:3236` |
| `message-smart-socket-readdressed:<role>` | 0 | LAN search found it elsewhere | `wifi.cpp:2526` |
| `message-smart-socket-address-lost:<role>` | 1 | identity probe mismatch | `wifi.cpp:555,597` |
| `message-smart-socket-cmd-failed:<role>:<on\|off\|test>` | 1 | a socket HTTP command failed | `wifi.cpp:648,3232` |
| `message-aux-command-failed:<what>` | 1 | a failed `socket_*`; `cam_capture` on firmware older than the relay | `wifi.cpp:3188,3210,3223` |
| `message-terp-cam-connected` | 0 | camera pairing | `wifi.cpp:1374` |
| `message-terp-cam-found` / `-not-found` | 0 / 1 | background camera search | `terpcam.cpp:560` |
| `message-cam-reset:ok` / `:no-response` | 0 / 1 | camera factory reset | `terpcam.cpp:738` |
| `message-cam-capture:…` | 1 | a failed capture, on firmware older than the relay only | — |

Boot reasons are `POWERON`, `EXT`, `SW`, `PANIC`, `INT_WDT`, `TASK_WDT`, `WDT`, `DEEPSLEEP`, `BROWNOUT`, `SDIO`,
`UNKNOWN`, plus `REMOTE` for a reboot the cloud asked for (`fridgecloud.cpp:45-59,161-169`).

The two external-sensor lines carry a floor of their own, for the reason the socket report's does: the fault behind
them is looked at on every control pass, so a sensor sitting on its threshold would otherwise write a line every
couple of seconds for as long as it sat there. Each of the two keeps its own last time, so one flapping cannot silence
the other. That time is wall clock seconds in RTC memory rather than a tick count, because ticks start at zero on
every boot and a panic, a watchdog or the connection watchdog's recovery reboot would otherwise let a device with a
standing fault report it again each time it came back; a power-on or a brownout clears it, which is what a device that
was just switched on should do. While the clock is still unset nothing is written at all and the fault is looked at
again on the next pass: the interval cannot be measured yet, and a device in that state is discarding its readings for
the same reason.

Builds from before #111 (2026-09-23) clear the fail latch on every pass that does not log, so a fridge on one of them
writes `message-ext-sensor-fail` every other control pass, about every two seconds, for as long as its SHT stays
broken. That is what filled the old device log ([ADR 0001](adr/0001-app-rewrite-data-model.md#transform-rules),
`devicelogs`), and the ingest stores every such line a device on an older build still sends: it throttles nothing.

### 6.2 `hardware-info:`

A device tells the cloud what hardware it has by riding the same log topic:

```
{"severity":0,"message":"hardware-info:<key>=<value>"}
```

The server splits at the **first** `=` — a value may contain more — trims the key, and requires
`/^[a-zA-Z0-9_-]{1,64}$/` for the key and at most 512 characters for the value; anything else is dropped without
a word (`hardware-report.service.ts`). The key becomes part of a MongoDB update path, which is why it may hold
no `.` or `$`. What passes is stored as `devices.state.hardware.<key>`, flat as the device sends it — except the
camera's credentials, which never reach that report, because it is handed out with the sockets: `webcam_pwd`
goes to the camera row's `secret` and to the device row's `cameraSecret`, and `webcam_url`, a legacy RTSP URL
with credentials in it, is not stored at all. Nothing is ever written to the diary, and there is no reply.

Because it rides the log topic, a report inherits the log's limits: the queue may drop it when it is full, and
the whole message has to fit the 384-byte serialisation buffer. That is why the firmware caps a reported value
at `MAX_REPORTED_VALUE_LEN = 288` characters and splits the socket table into chunks of three
(`wifi.cpp:53-79`). Three rows at their longest are asserted against that cap at compile time, because a value
over it would serialise into truncated JSON and the server would drop the whole chunk without a word.

**Every key a device reports today:**

| Key | Value | Emitted by | Where |
| --- | --- | --- | --- |
| `claimcode_auth` | `on` | every type, at init | `fridgecloud.cpp:171` |
| `firmware_version` | the build's uuid | every type, at init | `fridgecloud.cpp:172` |
| `co2` | `on` / `off` | controller, on its first pass and when SCD presence changes | `controller.cpp:836-841` |
| `leaf_temp` | `on` / `off` | controller, likewise for the MLX90632 | `controller.cpp:845-850` |
| `ppfd` | `on` / `off` | controller, likewise for the VEML7700 | `controller.cpp:852-857` |
| `protections` | `on`: this build enforces the `limits.*` protections of its document | plug, at init | `plug.cpp:581` |
| `sockets` | csv of roles that have a socket, or `none` | controller, fridge | `wifi.cpp:2776` |
| `socket_ips` | `role@ip` per role, first socket only, or `none` | controller, fridge | `wifi.cpp:2777` |
| `sockets_n` | how many rows the table holds | controller, fridge | `wifi.cpp:2784` |
| `socket_list<k>` | up to three `role\|id\|ip\|state\|override-or-timer` entries | controller, fridge | `wifi.cpp:2786-2800` |
| `socket_roles` | csv of the roles this build accepts | controller, fridge, at init | `wifi.cpp:2843` |
| `caps` | csv of what it accepts beyond the frozen commands | controller, fridge, at init | `wifi.cpp:2844` |
| `socket_pulse` | `role:seconds`: the failsafe each role's socket is given | controller, fridge, at init | `wifi.cpp:2845` |
| `webcam_did` | the camera's device id, or `none` | at boot, on pairing, on disconnect | `wifi.cpp:2870`, `:1375`, `:1398` |
| `webcam_ip` | where the camera last answered, or `none` | at boot, on discovery, on disconnect | `wifi.cpp:2876`, `terpcam.cpp:188`, `wifi.cpp:1400` |
| `webcam_url` | a legacy stored RTSP URL, or `none` | at boot, on disconnect | `wifi.cpp:2885`, `:1401` |
| `webcam_uid` | the camera's 20-byte P2P id, formatted, or `none` | at boot, on pairing, when learnt, on disconnect | `wifi.cpp:2881`, `:1376`, `terpcam.cpp:192`, `wifi.cpp:1399` |
| `webcam_pwd` | the password the device set on the camera | at boot when one is stored, after each securing attempt | `wifi.cpp:2893-2896`, `terpcam.cpp:672` |

The `socket_*` keys come from the controller and the fridge only — no other type calls
`wifiInitAuxCloudReporting`. The `webcam_*` keys come from every type that pairs a Terp Cam: the controller and
the fridge, and the fan and the plug, which call `wifiInitTerpCamCloudReporting` alone (`fan.cpp:419`,
`plug.cpp:605`). `reportCamIp` (`terpcam.cpp:185-196`) sends `webcam_ip` and `webcam_uid` whenever the device
has learnt a new value, and only while no relay is running, because the relay task never logs
(`terpcam.cpp:1073`). Pairing secures the camera before it reports the new id, so `webcam_pwd` arrives before the
`webcam_did` it belongs to (`wifi.cpp:1371-1376`). Disconnecting the camera in the menu forgets everything stored
about it and reports `none` for all four keys (`forgetTerpCam`, `wifi.cpp:1384-1403`).

The `none` sentinel matters. A device reports `webcam_did=none` and `sockets=none` rather than staying silent, because
silence cannot clear a stale value: the cloud would keep whatever it last heard, and a camera unpaired while the
module was offline would look connected forever (`wifi.cpp:2864-2868`, `:2685-2689`).

`webcam_pwd` is reported on **every** attempt to secure the camera, including the failed ones, where its value is
the empty string (`terpcam.cpp:672`).

Server-side handling beyond storage (`hardware-report.service.ts`):

| Key | Extra effect |
| --- | --- |
| `claimcode_auth` | `'on'` makes `POST /device/claimcode` require the device password |
| `firmware_version` | the build is reported to the rollout and stored as `devices.state.firmwareId` |
| `sockets_n` | superseded `socket_list<k>` chunks from a larger table are unset |
| `socket_list<k>` | a row whose state left the one the last report gave stamps `devices.state.socketStateChangedAt.<slot>`, falling silent included; a row that had no state yet stamps nothing, so a build that starts reporting the column does not read as every socket having just moved |
| `webcam_did` | the camera the device pairs is reconciled into a row of `cameras`; `none` also resets the device's `cameraSecret` |
| `webcam_pwd` | the camera's `secret`, which the cloud logs in with over the relay; an empty value means "the default". Kept on the device row as well, because pairing reports it before the id that makes the camera row |
| `webcam_uid`, `webcam_ip` | the camera's `uid` and `ip`, kept for the record; the relay finds the camera itself |
| `webcam_url` | none: dropped unread |

`webcam_did`, `webcam_uid` and `webcam_pwd` also end a hold the cloud keeps on a camera that turned it away: a
different camera, or one that refused the password, is left alone for 30 minutes unless the device says
something new about it ([9](#9-the-still-cycle)).

The reconciliation requires `/^[A-Za-z0-9_-]{4,32}$/` of the reported id. A device that reports one is given the
camera row it already has, or a new one whose entitlement runs twelve months from that first pairing
(`ENTITLEMENT_MONTHS`); `none` and the empty string retire the row rather than deleting it, so the pictures it took
keep their camera and pairing it again gives it back the entitlement it had. A device nobody owns gets no camera row —
a camera belongs to somebody — and the row is made when the device is claimed or the next time it reports.

### 6.3 The socket table, chunked and reassembled

The full table cannot travel as one value, so it is reported as a count followed by chunks
(`reportSocketsHardwareInfo`, `wifi.cpp:2771-2801`):

```
hardware-info:sockets=heater,light,pump
hardware-info:socket_ips=heater@192.0.2.60,light@192.0.2.61,pump@192.0.2.63
hardware-info:sockets_n=4
hardware-info:socket_list0=heater|4C7525A1B2C3|192.0.2.60|on|,heater|4C7525A1B2C4|192.0.2.62||,light|4C7525A1B2C5|192.0.2.61|off|override=off@120
hardware-info:socket_list1=pump|4C7525A1B2C6|192.0.2.63|off|timer=30/900
```

Four sockets: a heater that is on, a second heater the module could not reach and so says nothing about, a light
an override is holding off for another two minutes, and a pump on a timer.

Rules a reader has to follow:

- Entry *n* of chunk *k* is the socket in slot `k * SOCKETS_PER_REPORT_CHUNK + n`, with
  `SOCKETS_PER_REPORT_CHUNK = 3` (`wifi.cpp:57`). That slot number is what a command names in `slot`.
- `sockets_n` bounds the table. Chunks left over from a larger table must be ignored; the server also unsets
  them (`hardware-report.service.ts`).
- The count is always sent **before** the chunks, so the cleanup never removes a chunk that is about to arrive.
- Each entry is `role|id|ip|state|override-or-timer` (`socketReportRow`, `wifi.cpp:2741-2769`). `id` is the
  socket's Tasmota MAC in upper hex, learned after pairing; `ip` is empty for a row whose address was lost and
  which is being looked for again, and for one stored by an older build with an address too long to report
  (`wifi.cpp:2767`). `role` is empty for a socket nobody has assigned one to.
- `state` is `on` or `off` when the module has commanded the socket and it answered, and **empty when it has
  not**: a socket that stops answering, or one nobody drives, says nothing rather than repeating what it was
  last told. A reader turns an empty state into "unknown".
- The last column is `override=<on\|off>@<seconds>` with the seconds the override has left, `timer=<onS>/<everyS>`
  for a socket that repeats on one, or empty. An override takes the column when both exist. `auto` is a state a
  command may carry and one a report never does: it ends an override rather than being one. The server reads the
  seconds against the instant the report arrived, which it stamps as `state.socketsReportedAt`.
- A row from a build without the socket change ends after the third column, and a reader that stops there reads
  every row the same way it always did. That is why the columns were added at the end.
- The address a row can carry is bounded at `SOCKET_ADDRESS_MAX_LEN = 40` characters (`wifi.cpp:68-72`): three rows
  have to fit one log message, and the address is the only column without a length of its own. Forty holds every
  IPv4 and IPv6 literal and a short hostname; a longer one is refused by `socket_set` rather than stored and then
  left out of the table.
- `sockets` and `socket_ips` are the older, lossy summary: one entry per role. They stay because readers that
  predate the table understand them.
- A whole report is re-sent on boot, on every change of the table (`wifi.cpp:2771`, called from
  `wifiInitAuxCloudReporting` `:2856` and from each mutation at `:600,606,2560,2965,3075,3410`), and **when a row's
  state or override changes, at most once per 30 s** (`SMART_SOCKET_REPORT_MIN_INTERVAL`, `wifi.cpp:63`,
  `reportSocketStateChanges`, `:2806-2819`). Without that last rule a socket that stopped answering would keep the
  state of the boot report forever; with no limit, an output oscillating around its threshold would fill the log queue
  with tables. The seconds an override has left are deliberately not part of what counts as a change — they tick down
  every second.

How the report is spelled — `MAX_SOCKETS = 32`, `SOCKETS_PER_REPORT_CHUNK = 3`, `socketListKey`,
`socketChunkCount` — is declared once in `shared-types/src/v1/socket-report.ts`, and the server and the simulator
both read it from there. The decoders that turn a report into the rows the API answers with are in
`server/src/modules/device-protocol/sockets.ts`; the web app reads those rows and never the report.

Roles are a fixed list in the firmware (`getSocketRolesList`, `wifi.cpp:2639-2656`; the first entry `back` is a
menu sentinel and never a role):

| Role | What its socket follows |
| --- | --- |
| `dehumidifier` | the dehumidifier output, except in `breed`, where nothing dries the air and it stays off |
| `heater` | the heater output - and off, whatever else would hold it on, while the air is more than 5 °C above its target |
| `light` | the light output |
| `secondary_light` | the light output, but only from the middle of the sunrise ramp to the middle of the sunset ramp, and never during maintenance; an override holds it like `light` |
| `co2` | the CO2 valve |
| `humidifier` | the dehumidifier's band read the other way round: on below the target minus `targetHumidityDiff` (never less than 5 points, `HUMIDIFIER_MIN_BAND`), off at the target - and once on, it stays on until the target is reached, without reading the band. In `breed` the target is the night's humidity, which the cloud sets to germination's 75 % (`GERMINATION_HUMIDITY`) whenever it puts a device into `breed`, by whatever way, and puts back afterwards. A grower who rests the humidifier there gets a band of 100 (`HUMIDIFIER_REST_BAND`) and a night humidity of 0 (`HUMIDIFIER_REST_HUMIDITY`) from the cloud, so one that is running stops and none switches on; the cloud stores the night humidity it keeps, reads the 0 back to it when the device uploads, and sends both back once the humidifier may hold again |
| `exhaust` | the cooling decision the temperature mode, and a fridge's breeding mode, compute; in the standard modes (`small`, `full`) and a controller's `breed` the same rule on its own: on above the target by 0.8 °C, off below 0.3 °C over it |
| `circulation`, `fan` | no output: on whenever the module regulates (its mode is not `off`) and is not in maintenance |
| `pump`, `custom_timer` | the row's own timer, and nothing else |
| `manual` | nothing: off unless an override holds it |
| *(empty)* | nothing at all: an unassigned socket is never commanded |

The five in the first block are what every build in the field knows; the rest arrive with the socket firmware
change and are only ever sent to a device that announced them in `socket_roles`
([12](#12-extending-it-safely)). Any number of sockets may share a role, up to `MAX_SMART_SOCKETS = 32` rows in
total (`wifi.h:84`). A row with a role the build does not know is dropped when the table is loaded
(`wifi.cpp:2502`), which is also what a rollback to a build without the new roles does with them.

---

## 7 The configuration document

**The configuration is the device's own.** The cloud stores a copy and hands it back, but the device decides what
it means and which keys exist. The server holds only the keys a type's firmware reads (section 7.1) to what the
firmware reads there, because `loadIfAvaliable` takes each with ArduinoJson's `as<float>()` or `as<uint32_t>()`,
which reads anything that is not a number - an object such as Extended JSON's `{"$numberInt": "24"}`, a list, a
word - as 0 without a word. A client's document, plan step or template that breaks one, sets a figure outside
the firmware's range, or names a work mode (or a socket's CO2 dosing) no branch of the firmware takes, is refused
with 400 `validation_failed` naming each place - except a figure sent exactly as it is stored, which a page that
sends the whole document back never touched and so is not refused for. Anything else that would carry a bad
figure to a device - a step stored before steps were checked, a document the device itself sent, the reply to a
`fetch` - has digits turned into the number they spell, and anything else replaced by the figure the device ran
or left out so the firmware keeps its default (`withFiguresHeld`, `document-figures.ts`). Every other key is kept
as it came.

**The cloud never writes the first document.** The firmware reads every key a document leaves out as its
compile-time default, so a document the cloud made up would reset whatever was tuned at the hardware - the work
mode, the dehumidifier timings, the light ramps - which the cloud has never seen and cannot put back. While
`devices.configuration` is null the server refuses a change by name, a plan step and a CO2 fan coupling with 422
`device_sent_no_settings`, a climate preset passes the device by, and the app's screens write nothing to it
(`awaitingClimate`, `webapp/src/ui/climate-hardware.ts`). Current firmware ends that state on its next connect
([5.3](#53-fetch--what-a-device-asks-for-when-it-connects)); an older build only when a setting is changed on the
device itself.

| Direction | Payload | Where |
| --- | --- | --- |
| server → device | the stored document, serialised | `device-configuration.service.ts` |
| server → device | the same document, as the reply to a `fetch` | `device-ingest.service.ts` |
| device → server | the device's whole settings object as JSON, after a change on its own menu | `fridgecloud.cpp:580-585` |
| device → server | the same object, inside every `fetch`; kept only while the cloud has none | `fridgecloud.cpp:370-404` |

When a device receives one it parses it, adopts it silently, writes it to NVS key `config` and re-runs its
control loop (`controller.cpp:569-578`). It sends **no acknowledgement and no echo**. The `fridge`, `plug`, `fan`
and `light` types skip the NVS store while `mqttcontrol` is true, so direct control does not overwrite the saved
settings (`fridge.cpp:685-691`, `plug.cpp:589-595`, `fan.cpp:395-401`, `light.cpp:357-363`).

When a setting is changed on the device itself, the device publishes its whole document on the same topic
(`saveAndUploadSettings` over `serializeSettings`, e.g. `controller.cpp:521-553`). The server overwrites
`devices.configuration` with it (`device-ingest.service.ts`, `configuration`) - a menu change on the device is the
one write from the device that beats the cloud's copy - holding it to the type's rules (`class-rules.ts`) and
reading the night humidity of a rested humidifier back to the one it keeps (`offTheWire`). A device that left
germination from its own menu gets back what germination kept - the night from before it, the humidifier's band -
and the server lets that memory and the grower's germination choices go, as it does when germination ends from
the cloud. Times of day set on the device were set by today's clock, so the clock the old ones were kept on is let
go ([7.3](#73-times-of-day)). A plug's day and CO2 dosing windows are passed on to the AIR fan it slows, and a
fan's upload, which never carries the `co2inject` section, keeps the one the server wrote from the plug
([7.1](#71-keys-per-hardware-type)). Where any of this changed the document, the server sends it back; otherwise
it answers nothing.

**A key a device does not know is ignored, and disappears.** Parsing is key by key
(`loadIfAvaliable`, `controller.cpp:442-458`): a key that is missing takes the struct's compile-time default -
not the value the device ran before - and logs a line to the serial console; a key that is present but unknown is
never looked at. And because the echo is rebuilt from the struct rather than from the received document, an
unknown key is **not** written back — so a key the cloud adds survives only until the device next uploads its
settings, and is then gone from the stored copy as well. That is why what the cloud has to remember beside the
document - the mode to go back to (`baseWorkmode`, `standardWorkmode`), what drying and germination put aside, the
clock the times were kept on (`scheduleClock`) - lives on the device row, never in the document. A document that
does not parse at all resets every setting to its defaults (`controller.cpp:463-469`).

### 7.1 Keys per hardware type

**controller** (`controller.cpp:473-493`, echo `:521-544`, defaults `controller.h:15-60`):

| Key | Type | Default |
| --- | --- | --- |
| `workmode` | `off`, `breed`, `temp`, `small`, `dry`; legacy `full` maps to `small` | `off` |
| `daynight.day` / `daynight.night` | uint32, seconds past midnight UTC ([7.3](#73-times-of-day)) | 21600 / 79200 |
| `daynight.maxDehumidifySeconds` | float | 0 |
| `daynight.targetHumidityDiff` | float | 5.0 |
| `daynight.useLongHumidityAvg` | float, `> 0` = long average | 1.0 |
| `daynight.minimalDehumidifierOffTime` | uint32, seconds | 240 |
| `co2.target` | float ppm; forced to 0 without an SCD sensor | 300 |
| `co2.night` | float, `> 0` = dose in the dark period too | 0 |
| `day.temperature` / `day.humidity` | float | 25.0 / 60.0 |
| `night.temperature` / `night.humidity` | float | 25.0 / 60.0 |
| `lights.sunrise` / `lights.sunset` | float minutes | 15 / 15 |
| `lights.limit` | float percent | 100 |

`lights.maintenanceOn` exists in the controller's struct (`controller.h:55`) and is echoed nowhere and read
nowhere — the controller has no `loadIfAvaliable` line for it, so the code that would use it
(`controller.cpp:946`) never fires.

The controller reads `full` as `small` (`controller.cpp:474-479`): the mode was removed from it, and a device that
still had it stored has to keep running rather than fall back to `off` - the case Chris's rule in
[12](#12-extending-it-safely) is about.

**fridge** (`fridge.cpp:574-594`, echo `:623-651`): the controller's keys plus `mqttcontrol` (bool, default
false, read at `:574`, **not echoed**), `daynight.linearChange` (float, 0), `co2.sunsetOff` (float, 0),
`lights.maintenanceOn` (float, 0 — here it is both read and used), `fans.external` and `fans.internal` (float
percent, 100). `workmode` additionally accepts `full` and `exp` (`fridge.h:18-24`); the server refuses `exp`
from a client, because it regulates nothing. The server writes a fridge's `daynight.linearChange: 1`,
`co2.sunsetOff: 1` and its dehumidifier tuning (`maxDehumidifySeconds`, `targetHumidityDiff`,
`useLongHumidityAvg`, worked out from the humidity the fridge holds) into every document, the device's own upload
included, and keeps `minimalDehumidifierOffTime` at 240 s or more (`class-rules.ts`).

**plug** (`plug.cpp:409-455`, echo `:502-560`): `mqttcontrol`; `workmode` ∈ `off`, `heater`, `cooler`,
`humidify`, `dehumidify`, `co2`, `timer`, `watering` (`plug.h:23-30`); `usedaynight`; `daynight.day` /
`daynight.night`; `timer.timeframes[]` of `{ ontime (seconds UTC), duration (minutes) }`;
`<heater|cooler|humidify|dehumidify>.<day|night>.<on|off>` thresholds; `co2.mode` (`const` or `periodic`),
`co2.period`, `co2.duration`, `co2.on`, `co2.off`; `limits.overtemperature.{enabled,limit,hysteresis}`,
`limits.undertemperature.{…}`, `limits.time.{enabled,min_off,min_on}` - enforced only by a build that reports
`hardware-info:protections=on`; `fan`, a JSON string `{"device_id":"<fan>","speed":<percent>}` naming the AIR fan
the plug slows while it doses CO2, which the firmware keeps without reading it and echoes only in `co2` workmode
(`""` otherwise).

**fan** (`fan.cpp:443-462`, echo `:242-259`): `mqttcontrol`; `mode` (uint32: 0 fixed, 1 temperature, 2 humidity,
3 both); `min_speed`; `<day|night>.<temperature|humidity|fixed_speed|max_speed>`;
`co2inject.device_id` (its presence enables the block) with `co2inject.{speed,usedaynight,day,night,period,
duration}`. `mqttcontrol` and the `co2inject` block are not echoed. The fan knows nothing of the plug: the server
writes `co2inject` from the plug's document - its id, its dosing windows and day, and the speed - whenever the
plug's document is written, from the cloud or from the plug's own menu, and an empty section where the plug no
longer names the fan or doses in no windows (`followCo2Fan`, `co2InjectFor`).

**light** (`light.cpp:419-425`, echo `:132-145`): flat, not nested — `mqttcontrol` (not echoed), `day`, `night`
(seconds UTC), `max_temperature`, `limit`, `sunrise`, `sunset`. A plan step or a climate preset never writes to
a light, because its `day` and `night` are a schedule, not climate sections: a preset passes it by, and the server
refuses a plan for it with 422 `device_states_no_climate`.

**cam**: `loadSettings` is empty (`cam.cpp:38-39`). A document is accepted and nothing is read from it, and the
cam sends none ([5.3](#53-fetch--what-a-device-asks-for-when-it-connects)).

### 7.2 `mqttcontrol` and the `control/#` topic

Setting `mqttcontrol: true` on a `fridge`, `plug`, `fan` or `light` hands its outputs to whoever publishes on
`/devices/<id>/control/<output>` — the topic suffix is the output name and the payload is a bare value
(`fridgecloud.cpp:243-246`). Accepted names: fridge `heater`, `dehumidifier`, `co2`, `light`, `fan-internal`,
`fan-external`, `fan-backwall` (`fridge.cpp:766-801`); plug `relais` (`plug.cpp:607-614`); fan `fan`
(`fan.cpp:422-429`); light `light` (`light.cpp:369-376`). The controller has no `onControl` handler at all.

Direct control expires 60 seconds after the last configuration message, after which the NVS configuration is
reloaded (`DIRECTMODE_TIMEOUT`, `fridge.h:124`, `fridge.cpp:974-978`; `plug.cpp:767-771`; `fan.cpp:174-178`;
`light.cpp:84-88`). This server has never published on `control/#`.

### 7.3 Times of day

Every firmware keeps a time of day as seconds past midnight UTC and knows no zone: the controller's, the fridge's
and the plug's `daynight.day` and `daynight.night`, the light's `day` and `night`, the plug's
`timer.timeframes[].ontime` and the fan's `co2inject.day` / `co2inject.night` (`gmtime` in each type's
`checkDayCycle`; the controller's menu says "Dayrise (UTC)", `controller.cpp:1186`). `day` is when the light comes
on and `night` when it goes off, and the comparison is strict: with `day < night` it is day between the two, with
`day > night` the window runs across midnight UTC, and with `day == night` it is never day
(`controller.cpp:196-205`, `fridge.cpp:245-254`, `light.cpp:62-70`, `plug.cpp:151-159`). A controller has a day
only in `small` and `temp`, a fridge in `small`, `full`, `temp` and `exp`; `off`, `breed` and `dry` hold the
night's figures round the clock (`controller.cpp:196`, `fridge.cpp:245`). `shared-types/src/v1/day-night.ts`
does the same arithmetic for the server, the screens and the simulator.

The ramps are worked out in unsigned arithmetic without going round the clock (`controller.cpp:285-292`,
`fridge.cpp:260-279`), so some windows have to be written in a form of their own. The cloud writes every window
through one function, `lightWindowTimes` (`day-night.ts`), and `withHeldWindow` (`class-rules.ts`) puts the same
right in every controller and fridge document it stores, the device's own upload included:

- **24 hours of light** is `night = 172800 + on` and `day = night + 1`: both lie past any time of day, so every
  second is day, the evening ramp never begins and the morning ramp's factor overflows to full, and the hour the
  light came on survives in the times. Two equal times would be always night, and the one-second-short window
  written before (`night = day - 1`) left two seconds of night a day with both ramps dimming the lamp around them.
  The controller's menu then shows the times as hours from 48.
- **Off at 00:00 UTC** (`night = 0`) makes the evening ramp run all day, clamp to full and vanish, so the lamp
  goes out hard and a fridge stops gliding into the night. It is written as `86399`.
- **0 hours** is `day == night`.

A controller's window across midnight UTC also comes on without its morning ramp, because the evening-ramp branch
overwrites it (`controller.cpp:289-291`); a fridge works the two ramps out separately. A stored legacy pair is
rewritten on the next write: `night = day - 1` becomes the 24-hour form, `night = 0` becomes `86399`.

The grower sets these times on a wall clock that moves twice a year, so the server moves every time of day in the
document by the change of the owner's UTC offset (summer time, another zone chosen) and sends it again; the
firmware never learns why. The device row remembers the clock the seconds were meant on (`scheduleClock`), only a
zone the owner chose anchors anything, and an upload that moves the times (set on the device's own menu, by today's
clock) drops the anchor (`schedule-clock.ts`, a pass a minute in `schedule-clock.service.ts`). Why, and the rest:
[ADR 0005](adr/0005-device-times-on-the-wall-clock.md); why the cloud reads day and night exactly as the firmware
does: [ADR 0006](adr/0006-day-and-night-by-the-device-clock.md).

---

## 8 Commands

**server → device** on `/devices/<id>/command`, one JSON object with an `action`. The device parses it into a
1024-byte document and drops it without a word if it does not parse (`fridgecloud.cpp:225-231`). `reboot` is
handled in the cloud client itself, for every hardware type; everything else is handed to the hardware type's
own handler (`:233-239`).

| `action` | Arguments | Honoured by |
| --- | --- | --- |
| `reboot` | — | every type |
| `maintenance` | `durationMinutes` (number; `0` ends a window) | controller, fridge |
| `test` | `outputs: { heater, dehumidifier, co2, lights, fanint, fanext, fanbw }` | fridge, fan |
| `stoptest` | — | fridge, fan |
| `socket_set` | `role`, `ip`, optional `slot`, `user`, `password`, `append`, `timer { onS, everyS }` | controller, fridge |
| `socket_remove` | `role`, optional `slot` | controller, fridge |
| `socket_test` | `role`, optional `slot` | controller, fridge |
| `socket_override` | `slot` **or** `output`, `state: on \| off \| auto`, `seconds` | controller, fridge announcing `socket_override` |
| `cam_relay` | `url`, `token`, `key` | controller, fridge, fan, plug |

`socket_set`'s `timer` and `socket_override` are the two additions since the builds in the field. They are sent
only to a device that announced `socket_timer` and `socket_override` in `caps`, and a role outside `socket_roles`
is never sent at all, because an old build drops what it does not know without a word
([12](#12-extending-it-safely)).

`light` and `cam` have empty command handlers (`light.cpp:378-385`, `cam.cpp:56-58`) and so honour nothing
beyond `reboot`; the `plug` honours `cam_relay` and nothing else (`plug.cpp:601-603`). None of `plug`, `fan`,
`light` or `cam` calls `wifiInitAuxCloudReporting` or `wifiHandleAuxCommand`, so they never report sockets and
ignore `socket_*`; the fan and the plug hand `cam_relay` to `wifiHandleTerpCamCommand` directly
(`fan.cpp:415`, `plug.cpp:602`). The server sends `socket_set` and `socket_override` only to a controller or a
fridge (`SOCKET_HOST_TYPES`) and answers 409 `not_for_this_device` for anything else.

**An action a device does not know is dropped silently.** There is no negative acknowledgement, no error log and
no reply of any kind: the command subject fires, the type's handler matches nothing,
`wifiHandleAuxCommand` returns `false` (`wifi.cpp:3241`), and the message ends there. That is the single most
important property for anything new: a caller cannot tell an unimplemented action from one that worked. Nor does
the broker keep a command for a device that is not connected: a command is published once at QoS 0, and one sent
while the device was away is lost. The server tells its caller only whether the device had been heard from inside
the offline window (`deviceOnline`), and 503 when the broker would not take the message.

### 8.1 `reboot`

`{ "action": "reboot" }`. The device writes a marker word into RTC memory and defers the restart until the log
queue has drained, so pending messages still reach the cloud (`fridgecloud.cpp:33-34,233-237,457-461`). The word
lives in `.rtc_noinit`, which a software reset leaves alone, so the next boot reports
`message-device-booted:REMOTE` instead of the generic `SW` (`:161-169`). Builds before that change kept the flag in
`RTC_DATA_ATTR`, which the bootloader reinitialises on a software reset: they report every portal reboot as `SW`.
Published by `device-publisher.service.ts` for `POST /v1/devices/{id}/commands` with `{ "kind": "reboot" }`, the
route `maintenance` goes through as well.

### 8.2 `maintenance`

`{ "action": "maintenance", "durationMinutes": <number> }`. For that long the device holds its heater,
dehumidifier and CO2 valve off, dims the light to at most 15 % (`lights.maintenanceOn`, fridge only, keeps it at
15 % at night too), and stops the humidifier, exhaust, circulation and fan sockets, which follow whether the module
is controlling. It answers with `message-maintenance-mode-activated-remote:<minutes, rounded>`
(`controller.cpp:581-588`, `fridge.cpp:726-733`). The value is read as a float and becomes the pause in ticks, so
`0` ends a window at once (and is answered with `…-remote:0`). The tick arithmetic is overflow-safe across the
~49-day tick wrap for pauses under ~24 days (`isPaused`, `controller.h:159-164`). The same window set from the
device's own menu is logged as `message-maintenance-mode-activated:<minutes>`.

The server keeps its own window, `devices.state.maintenanceUntil`: set before the command is published, so it
survives a device that never heard it; set again from either log line when it arrives; and sent to the device again
on its next `fetch` while a minute or more of it is left ([5.3](#53-fetch--what-a-device-asks-for-when-it-connects)).
The minutes the server sends are its seconds rounded, and on the repeat rounded down, so the device never holds
past the end the screens name (`device-publisher.service.ts`, `device-ingest.service.ts`). Ending a window sends
`durationMinutes: 0` and moves the server's end only where a window is open.

### 8.3 `test` and `stoptest`

`{ "action": "test", "outputs": { … } }`. The cloud does not send either action: `/v1` has no command for them,
because the mode is an assembly check with every safeguard off and nothing a grower should reach. A caller on the
broker has to send all seven fields, because the firmware reads each one out of the document and a missing one
reads as `0` - an output left out of the command is an output switched off, not one left alone.

The output names are the fridge's (`fridge.cpp:698-707`): `dehumidifier` and `co2` go to their pins as raw 8-bit
values; `lights`, `fanint`, `fanext` and `fanbw` are percentages, multiplied by 2.55 into PWM; `heater` is a
percentage of the control tick the heater is held on (`fridge.cpp:968`). Test mode lasts
`TESTMODE_MAX_DURATION = 10`, decremented once per control tick of one second — about ten seconds after the last
`test` (`fridge.h:126`, `fridge.cpp:965-966`; the `// times 10sec` comment at `fridge.h:126` is stale).
`stoptest` ends it at once (`fridge.cpp:724-725`).

The fan accepts both actions but reads none of the values (`fan.cpp:408-413`). The controller, plug, light and
cam ignore them entirely.

### 8.4 The socket commands

All four are composed server-side from a typed command (`device-publisher.service.ts`), so the action can only
ever be one of `socket_remove`, `socket_test`, `socket_set`, `socket_override`; the role must be one a device has
announced; `socket_remove` and `socket_test` name the row by its slot and take the role from the table the device
reported, or carry the role alone, which addresses every socket of it - the only address a build that reports no
table has. A `socket_set` from the server always names a slot or sets `append`, so the firmware's slotless meaning
below is left to older callers. A socket test asks the firmware for the pulse it already gives — two seconds —
because the command carries no duration and old firmware would ignore one. Socket commands always run on the
device itself (cloud → MQTT → device → LAN), so they need nothing of the tunnel.

Every rule the firmware refuses one of these by is checked again before the publish, because a refusal never travels
back: a slot the device reports no socket in, an address over `SOCKET_ADDRESS_MAX_LEN` or with a space in it,
credentials over 48 characters, a timer that is on for at least as long as its period or that names a role which does
not run on one, a role or capability the device has not announced (409 `capability_not_announced`), an override of any
output but `light`, and an override that carries no duration while it is not `auto`. The caller is told which one; the
firmware, asked anyway, would say nothing at all.

**`slot` is optional everywhere and means one row of the table**, as reported in `socket_list<k>`. Left out, the
command addresses every socket of the role for `socket_remove` and `socket_test`, and the single existing socket
of the role for `socket_set` — which is all a command could mean back when a role could hold only one
(`wifi.h:114-118`, `addressedSockets`, `wifi.cpp:2915-2934`).

`socket_set` (`wifi.cpp:2969-3077`) assigns or re-addresses a socket. It fails — logging
`message-aux-command-failed:socket_set:<role>` — for an unknown role, an empty address or one over
`SOCKET_ADDRESS_MAX_LEN = 40` characters, an address containing a space, credentials over 48 characters, a timer
that names one half without the other, is on for at least as long as its period or has a period over a day, a
slot outside the table, a role that already holds several sockets when no `slot` was named and `append` was not
set, or a full table. Three subtleties:

- **Credentials are only touched when the command carries them.** The firmware keys that on
  `command.containsKey("password")` (`wifi.cpp:3200`), and the server only includes `user`/`password` in the
  payload when the caller supplied either (`device-publisher.service.ts`). Sending an empty password
  explicitly puts the socket back on the device's default credentials; leaving both out re-addresses the socket
  and keeps whatever it had, which is what stops a re-addressing from locking the device out of a socket with
  its own web password.
- **`append: true` adds a socket to a role** instead of configuring the one it has, because a caller who wants a
  second heater has no slot to name yet (`wifi.cpp:3203`). An address the table already holds always
  configures that existing row rather than adding a duplicate (`:3020-3031`).
- **The timer is part of the row a set writes**, the way the role and the address are: a command that carries
  none leaves the socket without one (`wifi.cpp:3049-3053`). That is the opposite of how credentials behave,
  and deliberately so — the caller sends the row it wants, and the credentials are the one thing it cannot
  read back to send again. `timer { onS, everyS }` means on for `onS` seconds out of every `everyS`, is stored
  in the socket's own NVS row and so survives a restart, and is only consulted for `pump` and `custom_timer`.
  A restart starts the cycle again from its beginning.

`socket_override` (`wifi.cpp:3114-3170`, `:3215-3226`) forces one socket, or an output the module drives itself, for
`seconds`; the state `auto` hands it back and carries no duration. The override **lives in RAM with an expiry** and is
consulted before the row's timer and before its role's target, so it survives neither the expiry nor a reboot. That is
the failsafe, and it is the point: with the socket's own `PulseTime` watchdog
([11.2](#112-the-failsafe-that-switches-sockets-off)) it means nothing outside the firmware can hold a socket on for
longer than it asked for. One thing outranks an override: a heater socket is off whenever the air is more than
`HEATER_OVERTEMP_MARGIN = 5` °C above its target, an override to `on` included; the override stays and is followed
again once the air has cooled (`socketTarget`, `wifi.cpp:713-734`). It fails — logging
`message-aux-command-failed:socket_override:<slot or output>` — for a slot outside the table, a state that is not
`on`, `off` or `auto`, a duration of zero or over `SOCKET_HOLD_MAX_SECONDS = 86400`, and for any `output` but `light`.
A socket under an override is re-asserted on the next control pass rather than at the end of its role's send interval,
because somebody is waiting with a finger on a switch.

`{ "action": "socket_override", "output": "light", … }` holds the module's own light output instead of a socket:
the light runs at the configured `lights.limit` while the override says on, and at nothing while it says off
(`controller.cpp:951-957`, `fridge.cpp:1075-1081`). The light sockets follow the output, so they are held with it.
This is the `light_override` capability, and it is the only output that takes one. The device reports no hold on
its light output back - the socket rows carry only their own overrides - so a screen that shows one remembers
what it sent until it runs out.

The light's level and its hold are two different mechanisms. The level is the configuration key `lights.limit`,
stored and delivered on the next connect, so it reaches builds that announced nothing and devices that are
offline; the hold is this command, gated on `light_override` and gone with a reboot. A light socket has no level
at all: it is on whenever the light output is above zero.

`socket_remove` (`wifi.cpp:2936-2967`) erases the rows, logs `message-smart-socket-disconnected:<role>` for each,
best-effort sends `Reset 1` to each socket so it reopens its pairing AP, and re-reports the table. It is
idempotent for a known role and fails only on an unknown role or an out-of-range slot.

`socket_test` (`wifi.cpp:3079-3097`) pulses the addressed sockets ON for two seconds and back OFF, blocking with
the watchdog fed, and answers `message-smart-socket-tested:<role>` or
`message-smart-socket-cmd-failed:<role>:test`. The control loop re-asserts the real target within its resend
window afterwards.

### 8.5 `cam_relay`

```json
{ "action": "cam_relay", "url": "https://api.example.com/terpcam/relay", "token": "<32 hex>", "key": "<64 hex>" }
```

Handled by `wifiHandleTerpCamCommand` (`wifi.cpp:3099-3112`) on every type that pairs a Terp Cam: the controller
and the fridge through `wifiHandleAuxCommand`, the fan and the plug directly. It starts the relay task
(`terpCamStartRelay`, `terpcam.cpp:1044-1070`) and returns at once, so a slow relay never holds the control loop.
A relay already running, no paired camera, an empty token, a URL that is not `http://` or `https://`, or a key
that is not 32 bytes of hex make it do nothing - and there is no reply either way. The camera pipeline asks for
it, through the protocol module's `requestRelay`; it is not a `/v1` device command. See
[9 The still cycle](#9-the-still-cycle).

**Firmware older than the relay drops `cam_relay` without a word, so a device on such a build delivers no Terp Cam
still until it is updated.** The same holds for the first relay builds (2026-09-29 to 2026-10-01), which read
`host` and `port` instead of `url` and so find nothing to dial: server and firmware of the `url` relay had to ship
together. The cloud no longer sends `cam_capture`, the command the oldest builds answered with still fragments on
`image`; what they still log about a capture (`message-cam-capture:…`, `message-aux-command-failed:cam_capture`)
is read as before.

---

## 9 The still cycle

A camera is paired on the device, in its menu - the controller, the fridge, the fan and the plug carry the
entry. The device stores the camera's printed id in NVS and reports it as `hardware-info:webcam_did=<did>`; the
cloud makes that a row of `cameras` of kind `terpcam_controller` and starts asking for pictures
(`hardware-report.service.ts`). One camera per device.

The poller (`server/src/modules/v1/camera/camera-poller.service.ts`) runs a pass every 5 s and asks each configured
camera at most every `stillIntervalSeconds`, with a failure backoff of `min(interval × 2^failures, 120 min)`. It
skips one whose previous read is still in flight, and where the camera says so, a device in maintenance or with
`workmode: off` (`maintenanceOff`) and a light that is out (`nightOff`). A Terp Cam, and a stream tunnelled through
a device, is skipped while its device is offline: each try could only wait out its timeouts. That is decided before
the schedule, so an offline spell does not grow the backoff.

One read, of either kind, has `CAPTURE_BUDGET_SECONDS = 180` (`shared-types/src/v1/capture.ts`) from the moment it
is asked for, its wait for a turn at ffmpeg included; every step inside it gets what is left of that where it is
less than the step's own limit. The test-image button runs the same read - it joins one already under way - and is
answered at once: `POST /v1/cameras/{id}/test-captures` returns a capture id, which the app asks after with
`GET /v1/cameras/{id}/test-captures/{captureId}` every two seconds until it is `done` or `failed`. No request is held
open while a camera is read.

### 9.1 The relay

The camera speaks only its vendor's P2P transport on the LAN, and the cloud cannot find it from outside. So the
device bridges it and the cloud runs the P2P client itself (`server/src/modules/v1/camera/terpcam-direct.service.ts`,
`firmware/src/terpcam.cpp:765-1074`). The MQTT tunnel ([9.2](#92-the-tunnel)) is not used for it: it wraps every
datagram in base64 and JSON and publishes it as a blocking write, which starves the control loop and loses the
keyframe burst.

1. The cloud publishes `cam_relay` ([8.5](#85-cam_relay)) with a fresh random `token` and `key`, and the URL to
   dial back: `TERPCAM_RELAY_URL`, which `docker-compose.yaml` defaults to `API_URL_EXTERNAL/terpcam/relay`; an
   empty value turns Terp Cam stills off. It waits `RELAY_DIAL_MS = 45 s` for the device to dial in.
2. The relay runs in a task of its own (8 KB of stack, 12 KB with TLS). Where the device does not know the camera's
   P2P id yet it learns it first, from a session of its own that checks the camera is the paired one, and reports it
   as `webcam_uid`. A stored id that nothing answers to - left by a camera swapped since - is dropped by the
   background search that follows ten failed attempts to find it (`MISSES_BEFORE_SEARCH`, `terpCamSearch`,
   `message-terp-cam-not-found`), and the next relay learns the id the camera really has (`openSession`). It finds the
   camera on the LAN and opens the URL as an HTTP upgrade - `GET <path>` with `Upgrade: terpcam-relay` and
   `Connection: Upgrade` - and needs a `101` back. TLS is not verified: everything after the response head is
   enciphered under the key that came over the verified MQTT link. The API's own HTTP server takes the upgrade, so it
   needs no port of its own. For the relay, a reverse proxy in front of the API only has to pass it on for
   `/terpcam/relay`, as it would a WebSocket (the `Upgrade` and `Connection` headers); its default timeouts suffice,
   because a relay carries traffic throughout and ends within the device's two minutes.
3. Every frame, both ways, is a 2-byte big-endian length and its payload, under AES-128-CTR with a zero counter -
   the key's first 16 bytes for what the device sends, the last 16 for what it receives. The first frame is the
   header: the token in the clear, a NUL, and the camera's 20-byte P2P id, which is the first thing enciphered.
   The server matches the token to a waiting capture within `RELAY_HEADER_MS = 20 s` and drops a dial-in it
   cannot match. Every later frame is one datagram between the cloud and the camera.
4. The cloud logs in to the camera over the relay and checks that the camera that answered is the paired one and
   took the password. A different camera, or a refused password, ends the attempt, and the device is then left
   alone for 30 minutes - or until it reports `webcam_did`, `webcam_uid` or `webcam_pwd` again. Otherwise the
   cloud takes a full-resolution keyframe off the camera's main stream and decodes it to JPEG, which is stored
   like any other still.
5. An empty frame from the cloud means it has its still. The device frees the camera's session slot on the LAN
   itself and hangs up; the server waits for that (`RELAY_CLOSE_MS = 10 s`) rather than closing first, because
   the device takes no new relay until the last one has ended.

One relay per device, on both sides: the device ignores `cam_relay` while a relay runs, and the server runs one
capture per device, so the test-image button pressed during a poll waits for the poll's picture. A capture makes
attempts for as long as its budget leaves room for one - a new one is started only with `MIN_ATTEMPT_MS = 20 s`
left, and at least `ATTEMPT_SPACING_MS = 10 s` after the last one began. Each is bounded by the dial-in, `LOGIN_MS =
15 s` (`LOGIN_SILENT_MS = 10 s` when nothing comes back at all), `TRANSFER_MS = 60 s` and the close, and by what is
left of the budget: a capture whose relay never opens has asked four times and fails at three minutes. The keyframe
is then decoded to JPEG, which takes a moment more: decodes have two ffmpeg runs of their own beside the streams'
eight, so a decode never waits behind stream reads that hang. The device ends a relay after 2 minutes, or 30
seconds without traffic, whatever the cloud does. The hold on a refusing camera lives in the server's memory and
ends with a restart.

A standalone Terp Cam has no device to open the relay, so the server has no way to reach one and refuses to
create one (400 `not_yet`).

What the firmware and the server need of the camera's own CGI and P2P transport is in the code in this
repository; internal notes on the camera exist and are not reproduced here.

### 9.2 The tunnel

A stream camera on the grower's network (`camera.tunnel`) and an alarm webhook marked `tunnel` are reached through
the device. The server opens a local TCP proxy for the target (`createTunnelProxyServer`,
`server/src/modules/tunnel/tunnel.service.ts`; the port defaults by scheme, `rtsp` 554), ffmpeg or the webhook
client connects to it, and every byte crosses MQTT. The tunnel lives in the cloud client, so every hardware type
carries it, with three slots (`TUNNEL_COUNT`, `fridgecloud.h:102`).

**server → device** on `tunnel_write` (`fridgecloud.cpp:249-362`):

```json
{ "connection_id": "<uuid>", "host": "192.0.2.20", "port": 554, "payload": "<base64>" }
{ "connection_id": "<uuid>", "disconnected": true }
```

- The device uses the slot that holds `connection_id`, else a free one, else closes the oldest and takes it. A TCP
  slot that is not connected connects to `host:port`, then the decoded payload is written. `disconnected: true`
  closes the slot; one for an id no slot holds is ignored.
- The server sends at most 128 raw bytes per message, drops the connection rather than send JSON over 1000
  characters, runs one connection per device at a time (`PARALLEL_TUNNEL_CONNECTIONS = 1`), closes a connection
  after 30 s without traffic, and stops accepting on a proxy after 300 s.
- `udp: true` makes the slot a UDP relay: each message sends one datagram to `host:port` from an ephemeral port, and
  only `disconnected` ends it. Nothing on the server uses it any more (`openUdpTunnel` has no caller); the Terp Cam
  went to the relay ([9.1](#91-the-relay)).

**device → server** on `tunnel_read` (`handleTunnelReads`, `handleTunnelCloses`, `fridgecloud.cpp:740-850`):

```json
{ "connection_id": "<uuid>", "length": 97, "sequence": 12, "payload": "<base64>" }
{ "connection_id": "<uuid>", "sequence": 13, "disconnected": true }
```

- TCP data travels in frames of at most 127 raw bytes; `sequence` counts per connection from 0, and the server
  delivers in sequence order, holding back what arrives early. A socket the target closed is reported as
  `disconnected` in the same sequence. A UDP datagram travels whole, with `udp: true` and the peer's `host` and
  `port`.
- At most six TCP and 41 UDP messages per loop, shared by the slots, and none while somebody is at the display
  (`ui.isIdle()`, 30 s after the last input).
- Data for a connection the server does not know is answered with `disconnected`.

---

## 10 The OTA path

1. The device reports what it runs on every connect: `fetch {"firmware_id": "<FIRMWARE_VERSION>", …}`
   (`fridgecloud.cpp:364,370-404`), and queues `hardware-info:firmware_version=<id>` at init (`:172`).
2. The rollout loop picks online devices of a class whose firmware differs from the channel's and sets a pending
   firmware id (`firmware-rollout.service.ts`). The next `status`, `bulk` or `fetch` arms a timer:
   the instruction goes out 30 s later, and the delay doubles on each resend up to 24 h
   (`INSTRUCTION_INITIAL_DELAY_MS`, `INSTRUCTION_MAX_DELAY_MS`). The backoff resets when the pending id changes or
   the device reports it.
3. The server publishes the pending firmware id on `firmware` as a **bare string, not JSON**
   (`firmware-rollout.service.ts`).
4. The device trims it and compares it against `FIRMWARE_VERSION` (`fridgecloud.cpp:192-202`). An empty or
   identical id is ignored. Otherwise it queues `message-device-firmware-update`, fires its update subject, and
   downloads `<API_URL>/device/firmware/<id>/firmware.bin` - all inside the `firmware` handler, so the line is
   published only when the download returns without a reboot ([6.1](#61-the-log-topic)). In the diary it marks an
   attempt that failed, and the rollout calls the update failed ten minutes after the first such line
   (`closeFailedUpdates` in `firmware-rollout.service.ts`, whose comment assumes the line precedes every download).
5. The update subject is what makes the OTA safe: the controller and the fridge zero every output, drop every
   socket override and flush every smart socket OFF **synchronously**, because the download blocks the loop task
   until the reboot and nothing else would push the OFF command out (`controller.cpp:596-615`,
   `fridge.cpp:743-764`, `wifiForceAllSmartSocketsOff`, `wifi.cpp:473-513`). The plug, fan and light have no
   update handler. A download that fails fires the subject again with `false` and the device carries on
   (`fridgecloud.cpp:672`).
6. On success the device restarts, and the new id goes out on `fetch` and as `hardware-info:firmware_version`.
7. The server compares the reported id: equal to the one it was running, nothing happens; different from the
   pending one, `devices.state.firmwareId` is updated and no more; equal to the pending one, the update is closed
   with `state.updateEndedAt` and an entry `message-firmware-update-complete-with-ids:<old> -> <new>`, named by
   the builds' version labels where the server has them. The protocol module tells the rollout what was reported
   before it stores it, because that comparison is what the rollout is deciding from.

**`fwupdate` is the second, unused door.** A device also subscribes to `/devices/<id>/fwupdate` and accepts
`{ "version": "<id>", "url": "<url>" }`, applying the same guard and then downloading from that arbitrary URL
(`fridgecloud.cpp:205-222`). The server has never published it.

A build compiled without `FIRMWARE_VERSION` defines `NO_FIRMWARE_UPDATE` and ignores both topics
(`fridgecloud.cpp:18-22,195,215`).

---

## 11 Timing and limits

| Limit | Value | Where |
| --- | --- | --- |
| MQTT maximum packet size | 4096 bytes, set on every connect | `fridgecloud.h:39`, `.cpp:182` |
| MQTT socket / write timeout | 5 s | `fridgecloud.cpp:158-159` |
| `fetch` document | 4096 bytes; without the settings where they do not fit | `fridgecloud.h:40`, `.cpp:388-395` |
| Reading document serialisation buffer | 512 bytes | `fridgecloud.cpp:527-528` |
| Reading buffer | 120 documents, then `message-buffer-overflow` and drop | `fridgecloud.h:33`, `.cpp:511-517` |
| Reading cadence | one sample per 5 control ticks → one `bulk` / 5 s | `fridgecloud.h:34-35`, `main.cpp:70` |
| Log queue | 32 entries; further entries dropped silently | `fridgecloud.h:37`, `.cpp:406-411` |
| Log message serialisation buffer | 384 bytes | `fridgecloud.cpp:442-443` |
| `hardware-info` value cap (firmware) | 288 characters | `wifi.cpp:58` |
| `hardware-info` key / value cap (server) | `[A-Za-z0-9_-]{1,64}` / 512 characters | `hardware-report.service.ts` |
| Sockets per `socket_list` chunk | 3 | `wifi.cpp:57`, `shared-types/src/v1/socket-report.ts` |
| Smart sockets per device | 32 | `wifi.h:84`, `shared-types/src/v1/socket-report.ts` |
| Consecutive failed publishes before a forced reconnect | 3 | `fridgecloud.h:99`, `.cpp:465-480` |
| Command document | 1024 bytes; one that does not parse is dropped | `fridgecloud.cpp:226-231` |
| Tunnel slots | 3 | `fridgecloud.h:102` |
| Tunnel TCP frame | ≤ 127 raw bytes, base64-encoded | `fridgecloud.h:21`, `.cpp:813-830` |
| Tunnel messages per loop | ≤ 6 TCP and ≤ 41 UDP, shared across slots | `fridgecloud.h:22,27`, `.cpp:774,786,816` |
| Tunnel activity | only while the display is idle (30 s after the last input) | `fridgecloud.cpp:741-743,770-772` |
| Tunnel frame / connection idle / proxy (cloud side) | 128 raw bytes / 30 s / 300 s | `tunnel.service.ts` |
| Relay dial-in / header / close (cloud side) | 45 s / 20 s / 10 s | `terpcam-direct.service.ts` |
| Login / transfer per attempt (cloud side) | 15 s / 60 s | `terpcam-direct.service.ts` |
| One read of a camera, every attempt included (cloud side) | 3 min | `shared-types/src/v1/capture.ts` |
| Relay length / silence (device side) | 2 min / 30 s | `terpcam.cpp:932-933` |
| Hold on a camera that refused the cloud | 30 min, or until the device reports it again | `terpcam-direct.service.ts` |
| Still poll interval | the camera's own `stillIntervalSeconds`, backoff to 120 min | `camera-poller.service.ts` |
| Upgrade instruction | first after 30 s, doubling to at most 24 h | `firmware-rollout.service.ts` |
| Maintenance repeated on `fetch` | while at least 60 s of the window are left | `device-ingest.service.ts` |
| Schedule clock check | once a minute | `schedule-clock.service.ts` |

### 11.1 How "online" is decided

A device is online when its `state.lastSeenAt` is younger than ten minutes, which is `VALUE_AGE.staleSeconds` in
`shared-types/src/v1/value-age.ts` — the same threshold a reading is called stale at, so a dimmed card and the
`offline` metric say the same thing about the same device. It is stamped by the ingest on every `status`, `bulk`
and `fetch` — and on nothing else. A device that only logs, only reports hardware info or only answers commands
does **not** count as alive. Since a healthy device publishes `bulk` every five
seconds, ten minutes is a hundred and twenty missed samples.

### 11.2 The failsafe that switches sockets off

A smart socket is a Tasmota plug the controller drives over plain HTTP. If the controller goes quiet, the socket
has to switch itself off, and it does, using Tasmota's own `PulseTime` watchdog, which every `Power` command
restarts:

| Role | `PulseTime` |
| --- | --- |
| `heater` | 300 s |
| `dehumidifier`, `humidifier` | 600 s |
| `co2`, `pump` | 120 s |
| `light`, `secondary_light` | 1800 s |
| `exhaust`, `circulation`, `fan` | 1800 s |
| anything else | 300 s |

The three air roles get the light's long watchdog on purpose: a fan still running when the module falls silent
is the harmless end of it, where a fan switched off in a closed tent is not.

Source: `socketRolePulseTimeValue`, `wifi.cpp:818-833`; the value is written at pairing (`wifi.cpp:3315-3320`), and
the same seconds are announced per role as `hardware-info:socket_pulse` ([6.2](#62-hardware-info)). A socket added by
address from the cloud rather than paired through the module's own flow is never given one, because nothing but the
pairing flow configures the plug. The controller resends every socket's state at least every
`SMART_SOCKET_RESEND_PERIOD = 60 s` (`wifi.cpp:30,612`), so the timeout outlives normal operation and expires soon
after a controller drops off the network. **Nothing outside the firmware can hold a socket on or off for longer than
one resend period** — an override included: it is held in the module's RAM, and a reboot ends it as surely as its
expiry does.

Around that: at most one command per role per 30 s, except `co2`, `pump` and `custom_timer`, which are exempt at 1 s
because their ON is a pulse of seconds a 30 s floor would stretch (`wifi.cpp:846-852`); three consecutive failures
back a socket off for 300 s (`wifi.cpp:32-33,651-654`); ten failures trigger a LAN sweep that re-finds the socket by
its MAC, with a 900 s cooldown (`wifi.cpp:39-42`); a reachable socket is asked for its hardware id every 600 s, and a
mismatch clears the stored address and logs `message-smart-socket-address-lost` (`wifi.cpp:52,571-607`). One control
pass spends at most 2 s on sockets, and the pre-OTA flush at most 20 s (`wifi.cpp:46,48`).

---

## 12 Extending it safely

**A device announces what it can do; the cloud never assumes.** The keys that carry a capability today:

| Key | Announces |
| --- | --- |
| `firmware_version` | the build, as an opaque id |
| `claimcode_auth` | whether `POST /device/claimcode` needs the device password |
| `co2`, `leaf_temp`, `ppfd` | which optional sensors are fitted |
| `protections` | that a plug enforces the `limits.*` protections of its document; the app greys them out for a plug that does not say so |
| `sockets`, `sockets_n`, `socket_list<k>` | that this build reports a socket table, and what is in it |
| `socket_roles` | every role this build accepts, the empty "unassigned" one aside |
| `caps` | what it accepts beyond the frozen commands: `socket_override`, `socket_timer`, `light_override` |
| `socket_pulse` | the failsafe seconds each role's socket is programmed with at pairing |
| `webcam_did`, `webcam_uid`, `webcam_pwd`, `webcam_ip`, `webcam_url` | that a camera is paired, and how to reach it |

Note the difference between a key with the value `none` and a key that is absent. `sockets=none` and
`webcam_did=none` mean "this build reports, and there is nothing"; the key missing altogether means "firmware too
old to report". That distinction is deliberate (`wifi.cpp:2685-2689`, `:2864-2868`) and is the only reliable feature
test in the protocol. The socket keys (`socket_roles`, `caps`, `socket_pulse`) follow the same rule: a device
that reports none of them is a build from before the socket change, is offered exactly the five roles every
build knows, and is never sent `socket_override` or a `timer`. `socket_roles` cannot carry the unassigned role,
which is the empty string and would vanish from a comma-separated list; every build takes it.

**A version comparison cannot be used as a gate.** The firmware version a device reports — in `fetch` and as
`hardware-info:firmware_version` — is `FIRMWARE_VERSION`, a compile-time define whose value is the **uuid** the
server minted for that build (`pioenv.py:8`; `fleet.service.ts` mints a firmware's `id` with `uuidv4()`).
It is not ordered, not comparable, and carries no date; the human-readable `version` label lives only in the
server's firmware record and never reaches the device. So there is no "if newer than X" anywhere in this
protocol. The only thing a device's id is good for is equality against the id it was told to install.

**An unknown command is dropped silently by old firmware.** No error, no log line, no reply
(`fridgecloud.cpp:225-240`, `wifi.cpp:3241`). A new action sent to a device that does not know it looks
exactly like one that worked. The same holds for a configuration key a device does not parse: it is ignored, and
it also vanishes from the stored copy the next time the device uploads its settings
([7](#7-the-configuration-document)).

Together those three facts give the rule: **send a device only what it has announced it understands.** A device
that announces nothing new gets nothing new, and a control that depends on something it has not announced is
drawn as unavailable, with the reason, rather than tried (409 `capability_not_announced`, "needs a newer
firmware").

How a change is made, so that old firmware and old readers keep working:

- **Additively.** A new key, column or field is optional, and its absence means what it always meant: `slot` and
  `append` on the socket commands, the fourth and fifth column of a socket row, the settings in `fetch`. An
  existing key keeps its meaning - `sockets` and `socket_ips` stayed the per-role summary when the table came -
  and new columns go at the end.
- **Server → device** additions are sent only to a device that announced them (above).
- **Device → server** additions need no announcement the other way round, because the server reads what it knows
  and ignores the rest; but the server has to go on handling the message without them, since most devices will
  keep sending the old shape (#141 added the settings to `fetch` that way).
- **A configuration value that is removed or renamed**, such as a work mode, stays understood in three places
  (Chris, 2026-07-09): recipes and plan steps map the old value when they are loaded, a device that still has it
  in its own stored settings keeps working, and configurations stored in the cloud are mapped too. For the
  controller's `full`: its firmware reads it as `small`, the server reads it as the standard mode
  (`work-modes.ts`), and plan steps drop it (`stepSettingsHeld`, `class-rules.ts`).

Two further things that stay fixed because a device depends on them:

- **The topic prefix is the device's identity.** The broker's authorisation is a literal prefix match on
  `.devices.<device_id>.` (`mqtt-auth.service.ts:91`), so a topic cannot be moved or renamed without changing
  what every deployed device may publish.
- **The configuration is the device's.** The server stores the object and hands it back. It holds the keys a
  type's firmware reads to what that firmware can read and adds no key the firmware does not read; what it needs
  to remember beside the document lives on the device row ([7](#7-the-configuration-document)).

---

## 13 Where the witnesses disagree

The firmware decides. These are the places where the server or the simulator does something else, and what a
reader of either should not conclude from it.

- **Live readings.** The firmware uses `bulk` in cloud mode and bare `status` sub-topics in custom-MQTT mode; it
  never publishes a JSON document on `status`. The server accepts one there anyway and discards its timestamp,
  and the simulator sends its live samples exactly that way.
- **Extra `log` keys.** The firmware sends `severity` and `message` and nothing else, as does the simulator, and
  those two are what the server reads. Until the rewrite it spread every key of the object into the entry, so a
  `title`, `time`, `data` or `images` a device sent would have been stored.
- **`message-device-firmware-update`.** The firmware sends it without an argument, and only after an attempt that
  failed ([10](#10-the-ota-path)); the simulator appends the firmware id and sends it on every update.
- **`message-cam-capture`.** Only firmware older than the relay sends it, and only failures. The server drops
  `…:ok` at ingest in any case, and the failures too unless webcam error logging is on. The simulator never sends
  the key.
- **A failing external sensor.** Only the fridge has one, in the firmware and in the simulator alike — `--fault`
  refuses any other type. What differs is where the fault comes from and where the interval lives. The simulator
  is told to have one rather than measuring it, and `--fault <kind>=<seconds>` makes the sensor flap on that
  period rather than stay broken, which is the shape that produced the flood. Its last-written times are ordinary
  memory: its `boot` command keeps them, as a soft reset does, while restarting the process clears them, as a
  power-on does. And it always has a clock, so it never reaches the case the firmware guards hardest — one that
  SNTP has not set yet, where the firmware writes nothing.
- **`test` and `stoptest`.** The server sends neither: `/v1` has no command for them ([8.3](#83-test-and-stoptest)).
  The simulator still answers a `test` sent on the broker for every type, mapping the fridge's seven names to its
  own keys and dividing the three fan percentages by 100, where only the fridge acts on one and the fan reads
  nothing out of it.
- **The camera.** The simulator answers `cam_relay` the way the firmware does - the same upgrade, header and
  cipher - but the camera at the far end is emulated in the script, so the cloud's P2P client is exercised and
  the camera's own quirks are not. It reports `webcam_did` and `webcam_uid` and no password, so the cloud logs in
  with the default, and it pairs a camera whatever type it is started as, where the firmware has the menu entry
  on the controller, fridge, fan and plug only. At boot it reports `webcam_did` only while a camera is paired,
  where the firmware sends `none` - so a simulated device cannot clear a stale camera by restarting.
- **Optional sensors.** A simulated controller always reports `co2`, `leaf_temp` and `ppfd` as `on`; the firmware
  reports what it detected.
- **The new control laws.** The firmware decides a humidifier from the dehumidifier's band and hysteresis and an
  exhaust from the cooling decision the mode computed or, in the standard modes, from the same over-temperature
  rule with its own hysteresis, and stops both in maintenance. The simulator keeps the humidifier's hysteresis but
  has no PID, reads the exhaust off the sample it has just published by the over-temperature rule alone, and knows
  no maintenance pause — the same shape, not the same code. What a socket does in the field is what the firmware
  does.
- **The socket state column.** The firmware reports `on` or `off` only for a socket that answered its last
  command, and nothing for one it could not reach, because the socket is HTTP away. Nothing in the simulator can
  fail to answer, so its rows never report an unknown state after the first command.
- **The tunnel.** The simulator relays a TCP connection like the firmware, but in frames of up to 4096 bytes
  rather than 127, and ignores `udp: true`, which the server no longer sends. The firmware relays only while its
  display is idle; the simulator always.
- **Settings in `fetch`.** The simulator sends its document with every `fetch`, whatever its type; of the
  firmware, the cam sends none and a build before #141 none at all.
- **`fwupdate` and `control/#`.** Subscribed by every device; published by neither the server nor the simulator.

The simulator is the cheapest way to exercise the cloud side of all of this — `./simulate-device.sh` registers,
claims and then speaks these same topics — but where this document and `scripts/simulate-device.mjs` differ, the
firmware is what a device in the field does.
