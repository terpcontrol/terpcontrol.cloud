# The Terp Control device protocol

Everything a device in the field speaks to the cloud: the HTTP requests its firmware makes, every MQTT topic in
both directions, the payload of each one key by key, and the limits a caller has to respect.

This is a **frozen contract**. ADR 0001 (`docs/adr/0001-app-rewrite-data-model.md`) rewrites the server's HTTP and
persistence layers around it and puts one `device-protocol` module in charge of it; the table in that ADR's
section "The device protocol (frozen)" is a summary and this document is the detail behind it. Not every device
will take a firmware update, so every shape here has to keep working unchanged. Additions are allowed only when a
device announces that it understands them (see [12 Extending it safely](#12-extending-it-safely)).

**Order of authority.** The firmware is the protocol: `firmware/src/fridgecloud.{cpp,h}` (the MQTT client, the
topics, the HTTP requests, the log queue), `firmware/src/wifi.cpp` (the `hardware-info:` reports, the smart-socket
table and its commands), `firmware/src/terpcam.cpp` (camera pairing and capture) and
`firmware/src_hwtype/<type>/` for what each hardware type reports and understands. The server
(`server/src/modules/device-protocol/`) is what currently consumes it - one module owns every route and every
topic below - and `scripts/simulate-device.mjs` is a second witness.
Where they disagree, the firmware wins; the known disagreements are listed in
[13 Where the witnesses disagree](#13-where-the-witnesses-disagree).

Hardware types in scope: `controller`, `fridge`, `plug`, `fan`, `light`, `cam`. The `dryer`, `dummy` and `*_test`
build environments are out of scope.

---

## 1 Identity, credentials and build-time constants

A device is provisioned once, at the factory, with an identity in a read-only NVS partition, and built against
one cloud. Neither can be changed over the protocol.

| Value | Source | Read at |
| --- | --- | --- |
| `device_id` | NVS partition `nvs_ro`, namespace `fg_provisioning`, key `device_id` | `fridgecloud.cpp:81` |
| MQTT username | same namespace, key `mqtt_user` | `fridgecloud.cpp:82` |
| MQTT password | same namespace, key `mqtt_password` | `fridgecloud.cpp:83` |
| `API_URL`, `MQTT_HOST`, `MQTT_PORT` | compile-time defines | `fridgecloud.cpp:85-87`, `pioenv.py:9-11` |
| `FIRMWARE_VERSION` | compile-time define; the firmware id, a uuid | `fridgecloud.cpp:18-22`, `pioenv.py:8` |
| `HWTYPE` | compile-time define per PlatformIO env | `platformio.ini:52,76,124,182,243,262` |
| TLS flag and CA | NVS `mqtt_tls` / `mqtt_ca_cert`, else the baked-in PEM | `fridgecloud.cpp:94-104` |

`mqtt_host`, `mqtt_port` and `api_url` also exist as provisioning NVS keys but are never read — the compile-time
values win (`fridgecloud.cpp:85-87`). Changing the cloud a device talks to therefore means flashing the other
cloud's build; see [3.1](#31-post-deviceregister).

TLS is enabled only when both a flag and a CA certificate are present (`fridgecloud.cpp:104`); without a CA the
device stays on plaintext rather than connecting unverified (`:144-151`).

**Custom MQTT mode.** When NVS key `mqtt_enabled` in the read-write `settings` namespace is set, the device takes
its id, host, port, user and password from `mqtt_id`, `mqtt_server`, `mqtt_port`, `mqtt_user` and `mqtt_pass`
instead, and sets `custom_mqtt = true` (`fridgecloud.cpp:71-78`). That flag changes exactly one thing in the
protocol — how readings are published, see [5.2](#52-status-in-custom-mqtt-mode). The menu that turns it on is
compiled in for `fridge`, `plug`, `fan` and `light` only (`-DENABLE_CUSTOM_MQTT`, `platformio.ini:56,128,187,267`);
the `controller` and `cam` builds do not have it.

**The MQTT client.** `EspMQTTClient(host, port, user, password, clientId = device_id)`
(`fridgecloud.cpp:136-142`), socket and write timeout 5 s (`:153-154`), maximum packet size 4096 bytes, set on
every connect (`:175`). The client id is the device id, which the broker's `resource` check relies on
(see [4.2](#42-what-the-broker-checks)).

---

## 2 The topics at a glance

Every topic is `/devices/<device_id>/<name>`, with the device's own id. The device builds all of them at init
(`fridgecloud.cpp:110-121`).

| Topic | Direction | Published by | Consumed by |
| --- | --- | --- | --- |
| `status` | device → server | device (custom MQTT mode only, as sub-topics) | server, dropped |
| `bulk` | device → server | device, every 5 s | server: time series, alarms |
| `fetch` | device → server, on every connect | device | server: firmware report, configuration reply |
| `log` | device → server | device | server: diary entries and `hardware-info:` |
| `configuration` | both ways | device after a local change; server after a save | the other side |
| `image` | device → server | device, during a capture | server: still assembly |
| `tunnel_read` | device → server | device | server: tunnel |
| `command` | server → device | server | device |
| `firmware` | server → device | server | device: OTA |
| `tunnel_write` | server → device | server | device: tunnel |
| `fwupdate` | server → device | nobody today | device: OTA from a URL |
| `control/#` | server → device | nobody today | device: direct output control |

The device subscribes to `configuration`, `firmware`, `fwupdate`, `command`, `control/#` and `tunnel_write`
(`fridgecloud.cpp:179-355`) and publishes on the rest. The server subscribes to `/devices/#`
(`device-ingest.service.ts`) and therefore also sees its own outbound messages echoed back; it ignores the
echoes of `tunnel_write`, `command` and `firmware` and logs anything else as unhandled.

`fwupdate` and `control/#` are subscribed by every device and **never published by the server today**. They stay
reserved, and the broker's topic rules keep covering them, so a future server can use them without a firmware
change.

---

## 3 HTTP

A device makes four kinds of request. All of them are unauthenticated in the HTTP sense — the device proves
itself with its own provisioning password in the body, or not at all.

| Request | When | Firmware |
| --- | --- | --- |
| `POST {API_URL}/device/register` | "change server" from the menu or the phone form | `fridgecloud.cpp:678-713` |
| `POST {API_URL}/device/claimcode` | "connect to portal" from the menu | `fridgecloud.cpp:651-676` |
| `GET {API_URL}/device/firmware/<id>/firmware.bin` | after a `firmware` message | `fridgecloud.cpp:563-571` |
| `GET <url>` | after an `fwupdate` message | `fridgecloud.cpp:573-649` |

`{API_URL}` is the base URL compiled into the build (`pioenv.py:11`). ADR 0001 puts the new `/v1` API under that
same base, so these four paths keep their place beside it.

### 3.1 `POST /device/register`

Body, `Content-Type: application/json` (`fridgecloud.cpp:685-691`):

| Key | Value |
| --- | --- |
| `registration_password` | the join password typed on the display or in the phone form |
| `device_type` | the `HWTYPE` string of this build |
| `device_id` | provisioning NVS `device_id` |
| `username` | provisioning NVS `mqtt_user` |
| `password` | provisioning NVS `mqtt_password` |

The firmware checks for **201** (`fridgecloud.cpp:695`). On 201 it reads `fw` from the answer and immediately
downloads `<api_url>/device/firmware/<fw>/firmware.bin`, which reboots it into the new cloud's build
(`:703-709`). Anything else is ignored, and the call returns `false` either way (`:712`) — the display flow does
not distinguish success from failure.

`registerWithCloud` persists nothing at all: the new server's address travels inside the firmware image it
fetches. That is what makes the device a device of the other cloud.

Server side: `device-protocol.controller.ts` → `device-registration.service.ts`. It answers 201 `{ fw }`
where `fw` is the device class's `firmwareIds.stable`, or 401 `{ status: 'unauthorized' }` when self-registration
is off, `registration_password` does not match `SELF_REGISTRATION_PASSWORD`, no device class is named
`device_type`, or a device with the same `device_id`, `username` and `device_type` exists and the password does
not verify. What the device signs in to the broker with is stored as `devices.mqtt`, hashed. Re-registering an
existing device forces `state.hardware.claimcode_auth` to `'off'`, which is what lets a re-homed device issue a
claim code again.

### 3.2 `POST /device/claimcode`

Body (`fridgecloud.cpp:657-659`):

| Key | Value |
| --- | --- |
| `device_id` | the device id |
| `password` | the device's MQTT password |

The firmware checks for **200** (`:664`) and reads `claim_code` from the answer (`:672`); any other status yields
an empty string and the display shows nothing. Called from the menu entry that shows the claim code
(`wifi.cpp:1701`).

Server side: `device-protocol.controller.ts` → `device-registration.service.ts`. The password is verified
**only when the device has reported `hardware-info:claimcode_auth=on`**; otherwise any caller who
knows the device id gets a code. Current firmware reports `claimcode_auth=on` at every boot
(`fridgecloud.cpp:164`). The answer is `{ claim_code }`, a 6-character code, upserted per device.

### 3.3 `GET /device/firmware/:firmware_id/:binary`

The OTA download. The firmware builds the URL as `<API_URL>/device/firmware/<id>/firmware.bin`
(`fridgecloud.cpp:563-571`) and streams the body straight into the ESP32 `Update` partition.

What the firmware requires of the answer (`fridgecloud.cpp:573-649`):

- It accepts **any** `httpResponseCode > 0` (`:581-582`) — it does **not** check for 200. An error page would be
  written to the OTA partition and rejected later by `Update.end()`, which is a silent failure.
- `Content-Length` matters: `http.getSize()` sizes `Update.begin()` so only the bytes that will be written are
  erased (`:594`). A missing length means `UPDATE_SIZE_UNKNOWN` and a full ~2 MiB erase, during which a flaky
  link can stall the download.
- The body is read in 128-byte chunks with the watchdog fed between them (`:599,608-633`), and `ESP.restart()`
  follows a successful `Update.end(true)` (`:635-637`).

Server side: `device-protocol.controller.ts`, which streams the row of `firmwareBinaries` that carries the
build and the file name: `Content-Type: application/octet-stream`,
`Content-Disposition: attachment; filename=firmware.bin`, `Content-Length` and `Cache-Control: no-transform`.
The route is public — a device has nothing but the firmware id to offer.

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
(`fridgecloud.cpp:654`) and
`/device/firmware/...` (`:565`). They exist for builds shipped before the paths were shortened, and have to stay
until no device in the field asks for them.

### 3.5 What a device never does over HTTP

It never authenticates with a session token, never polls, and never reports readings over HTTP. Everything else
is MQTT. The two outbound HTTP calls a device makes to other hosts — Tasmota commands to a smart socket
(`wifi.cpp:887-892`) and the camera's CGI over its P2P transport — are not part of this protocol.

---

## 4 The broker: authentication and authorisation

The broker is RabbitMQ with the MQTT and HTTP-auth-backend plugins (`rabbitmq/Dockerfile`). The plaintext
listener on 1883 is always on, for firmware that cannot speak TLS; a TLS listener on 8883 is added at container
start when a certificate is configured (`rabbitmq/rabbitmq.conf`, `rabbitmq/docker-entrypoint-wrapper.sh`).
Anonymous access is off.

### 4.1 How a device authenticates

With the username and password from its provisioning NVS, and its `device_id` as the MQTT client id
(`fridgecloud.cpp:136-142`). The broker asks the server over HTTP, form-encoded, at
`POST /mqttauth/<shared-secret>/{user,vhost,resource,topic}`; the answer is the bare word `allow` or `deny`
with status 200 (`mqtt-auth.controller.ts`).

Device passwords are stored bcrypt-hashed; a legacy plaintext row is compared in constant time and re-hashed on
the first successful authentication (`mqtt-auth.service.ts:36-45`, `server/src/utils/devicepassword.ts`).

### 4.2 What the broker checks

| Check | Rule for a device |
| --- | --- |
| `user` | a device with that `username` exists and the password verifies |
| `vhost` | the device exists and `vhost === '/'` |
| `topic` | `resource` is `topic`, `name` is `amq.topic`, `routing_key` begins `.devices.<device_id>.` |
| `resource` | `vhost === '/'`, and exchange `amq.topic` or queue `mqtt-subscription-<client_id>qos0` |

Source: `mqtt-auth.service.ts:20-129`; the fields the broker posts are in `mqtt-auth.types.ts`. The server's own
connection is recognised by its username in `vhost`, `topic` and `resource` (`:55,74,103`); its password is
checked once, at `user`.

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
`false` instead of throwing (`mqtt-client.service.ts:48-50,160-168`), which is what turns into a 503 for the
HTTP caller behind a command.

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
  `fridgecloud.cpp:500-501`). Without a valid clock the sample is discarded rather than sent undated.

Cadence and buffering (`fridgecloud.cpp:479-530`, constants in `fridgecloud.h:31-33`): `updateStatus()` is
called once per control tick, and `main.cpp:284-287` runs the control tick every second. One sample in
`SAMPLE_INTERVAL = 5` is kept, so a document is produced every 5 s. It is serialised into a 512-byte buffer
(`:503-504`) and pushed onto a deque of at most `MAX_BUFFER_LEN = 120` entries; because `UPLOAD_INTERVAL = 1`,
the buffer is drained immediately, so the wire sees **one `bulk` message every five seconds**. When the buffer is
full the sample is dropped and `message-buffer-overflow` is logged once at severity 1 (`:487-495`). The drain
stops on the first failed publish and keeps the rest for the next attempt (`:539-551`).

Server side (`device-ingest.service.ts`): the ingest stamps `devices.state.lastSeenAt`, then hands the document
on with the instant the device dated it. Readings are written to InfluxDB, measurement `status`, tagged
`device_id` — the `user_id` tag is no longer written — sensors under their own names and outputs prefixed `out_`.
The same reading is evaluated by the alarms under the names the contract gives them, which the ingest translates
to. **A device with no owner has its readings dropped** — `lastSeenAt` is still updated.

Only known keys are stored: the fields the metric tables in `shared-types/src/v1` name, plus the controller
diagnostics beside them. A key outside those lists is silently ignored, which is the safe way to add a sensor
before the server knows it.

### 5.2 `status` in custom-MQTT mode

**device → server.** A device in custom-MQTT mode does not buffer and does not publish on `bulk`. It publishes
each value on its own sub-topic, as a bare value with no JSON envelope (`fridgecloud.cpp:519-528`):

```
/devices/<id>/status/sensors/<key>     23.5
/devices/<id>/status/outputs/<key>     1
```

These are meant for a third-party broker of the owner's choosing. If such a device is pointed at this server,
the message is taken and dropped: it arrived below `status` rather than on it, and a bare value is not a reading
document. `lastSeenAt` is stamped first, so the device still counts as online. (Until the rewrite this went
through the reading path and ended as a caught `Failed writing measurements for device …`.)

The server also accepts a full JSON reading document on `status` itself, and **discards its timestamp**,
recording the sample at server time. No firmware build publishes that; the simulator does.

### 5.3 `fetch` — what a device asks for when it connects

**device → server**, published synchronously at the end of every (re)connect, after the subscriptions are in
place (`fridgecloud.cpp:357,363-380`):

```json
{ "firmware_id": "<FIRMWARE_VERSION>" }
```

Serialised into a 128-byte buffer (`:370-371`).

Server side (`device-ingest.service.ts`):

1. The reported id is handed to the rollout and then stored as `devices.state.firmwareId` — see
   [10 The OTA path](#10-the-ota-path).
2. If `devices.configuration` is not null, the server **replies** by publishing it on `configuration`. This is
   the only reply in the protocol. The document is stored as the object it is and serialised again for the
   reply, so a key may come back in another order than the device sent it in; the device parses key by key and
   never compares the string.
3. `state.lastSeenAt` is stamped, and the rollout arms the upgrade instruction if one is pending.

A payload that is not JSON carries no `firmware_id` and is dropped rather than rejected.

### 5.4 Which keys each hardware type reports

- **controller** (`controller.cpp:1004-1037`) — sensors `temperature`, `humidity`, `sensor_type`, `co2`,
  `leaf_temperature`\*, `lux`\*; outputs `dehumidifier`, `heater`, `light`, `co2`.
- **fridge** (`fridge.cpp:1004-1028`) — sensors `temperature`, `humidity`, `co2`; outputs `co2`, `dehumidifier`,
  `heater`, `light`, `fan-internal`, `fan-external`, `fan-backwall`.
- **plug** (`plug.cpp:810-826`) — sensors `temperature`, `humidity`, `co2`, `sensor_type`; output `relais`.
- **fan** (`fan.cpp:182-194`) — sensors `temperature`, `humidity`, `rpm`, `day`; output `fan`.
- **light** (`light.cpp:99-109`) — sensors `temperature`, `humidity`; output `light`.
- **cam** — nothing; it never calls `updateStatus` (`cam.cpp:64-66`).

\* sent only when the optional sensor was detected, so no placeholder lands in the history
(`controller.cpp:1019-1026`).

Units and conventions:

- `sensor_type` is an enumeration, not a measurement: `0` none, `1` SHT, `2` SCD, `3` a daisy-chained slave
  (`controller.h:74-77`, `plug.h:144-147`). Only the plug ever reports `3` (`plug.cpp:716`); the controller
  sets only the first three (`controller.cpp:180,669,708`).
- `co2` on the controller is `-1` when no SCD sensor is fitted, for both the sensor and the output
  (`controller.cpp:1014,1031`).
- The `co2` **output** is not a level: it is the number of ticks the valve was open since the last sample, reset
  to zero after a successful publish (`controller.cpp:1033-1036`, `fridge.cpp:1026-1028`).
- `heater` is the PID output, 0..1. `light` is a percentage, 0..100. `dehumidifier` and `relais` are 0 or 1. The
  fridge's three fans are 0..1 (`fridge.cpp:1021-1023`). The fan's `fan` output is a percentage, and its `day`
  sensor is `1.0` or `0.0` derived from a light sensor rather than the clock (`fan.cpp:191-192`).

---

## 6 `log` and the `hardware-info:` sub-protocol

### 6.1 The log topic

**device → server.** One message per entry (`fridgecloud.cpp:414-431`):

```json
{ "severity": 0, "message": "message-device-booted:POWERON" }
```

The firmware sends exactly these two keys. The queue holds `MAX_LOG_QUEUE_LEN = 32` entries and **silently drops
anything beyond that** (`fridgecloud.h:35`, `fridgecloud.cpp:382-387`); each entry is serialised into a fixed
**384-byte** buffer (`:418-419`), which is the hard bound on how long a message may be. Publishing stops on the
first failure and resumes with the same entry at the head (`:421-429`). A queued reboot waits for the queue to
drain (`:433-437`).

`message` is a `message-key:param` line. The keys resolve against `webapp/public/assets/i18n/en.json`; anything
without a translation is shown verbatim.

Server side (`device-ingest.service.ts`), in order:

1. A message starting with `hardware-info:` goes to [6.2](#62-hardware-info) and is **never** written to the
   diary.
2. Every `message-cam-capture:ok…` line is dropped, and any other `message-cam-capture:…` unless the camera the
   device answers for has `logErrors` on. It is off unless somebody turns it on, where the old setting was on
   unless somebody turned it off.
3. Everything else becomes a row of `entries`: `source: device`, the line parsed once into
   `message { key, params }` or kept as `text` where no key is known, the severity as the model names it, and
   the space the device stands in. A line about the camera is attached to the camera. The two keys the firmware
   sends are the two that are read — a `title`, `time`, `data` or `images` beside them would be ignored, where
   the old server stored whatever the object carried.

A `message-maintenance-mode-activated[-remote]:<minutes>` line additionally sets `devices.state.maintenanceUntil`.

The messages current firmware sends:

| Key | Severity | Emitted by | Where |
| --- | --- | --- | --- |
| `message-device-booted:<reason>` | 0 | every type, at init | `fridgecloud.cpp:39-53,157-162` |
| `message-device-firmware-update` | 0 | every type, before an OTA | `fridgecloud.cpp:190,210` |
| `message-buffer-overflow` | 1 | every type, reading buffer full | `fridgecloud.cpp:490` |
| `message-co2-low` | 0 | controller, fridge | `controller.cpp:931-944`, `fridge.cpp:981-992` |
| `message-ext-sensor-deviate`, `message-ext-sensor-fail` | 0 | fridge, when the fault appears and **at most once per 15 min** each (`SENSOR_FAULT_LOG_INTERVAL`, `fridge.cpp:64-78`) | `fridge.cpp:174,188` |
| `message-maintenance-mode-activated:<min>` | 0 | controller, fridge | `controller.cpp:1069`, `fridge.cpp:1062` |
| `message-maintenance-mode-activated-remote:<min>` | 0 | controller, fridge | `controller.cpp:574`, `fridge.cpp:634` |
| `message-smart-socket-connected:<role>` | 0 | pairing or `socket_set` | `wifi.cpp:3021,3347` |
| `message-smart-socket-disconnected:<role>` | 0 | removal | `wifi.cpp:2899` |
| `message-smart-socket-tested:<role>` | 0 | `socket_test` | `wifi.cpp:3175` |
| `message-smart-socket-readdressed:<role>` | 0 | LAN search found it elsewhere | `wifi.cpp:2494` |
| `message-smart-socket-address-lost:<role>` | 1 | identity probe mismatch | `wifi.cpp:553,595` |
| `message-smart-socket-cmd-failed:<role>:<on\|off\|test>` | 1 | a socket HTTP command failed | `wifi.cpp:646,3171` |
| `message-aux-command-failed:<what>` | 1 | a failed `cam_capture` or `socket_*` | `wifi.cpp:3114,3127,3149,3162` |
| `message-terp-cam-connected` | 0 | camera pairing | `wifi.cpp:1357` |
| `message-terp-cam-found` / `-not-found` | 0 / 1 | background camera search | `terpcam.cpp:473` |
| `message-cam-reset:ok` / `:no-response` | 0 / 1 | camera factory reset | `terpcam.cpp:627` |
| `message-cam-capture:skipped-low-heap …` | 1 | capture refused for want of heap | `terpcam.cpp:654-662` |
| `message-cam-capture:incomplete res=… bytes=… …` | 1 | a failed capture only | `terpcam.cpp:934-947` |

Boot reasons are `POWERON`, `EXT`, `SW`, `PANIC`, `INT_WDT`, `TASK_WDT`, `WDT`, `DEEPSLEEP`, `BROWNOUT`, `SDIO`,
`UNKNOWN`, plus `REMOTE` for a reboot the cloud asked for (`fridgecloud.cpp:39-53,156-162`).

The two external-sensor lines carry a floor of their own, for the reason the socket report's does: the fault
behind them is looked at on every control pass, so a sensor sitting on its threshold would otherwise write a line
every couple of seconds for as long as it sat there. Each of the two keeps its own last time, so one flapping
cannot silence the other. That time is wall clock seconds in RTC memory rather than a tick count, because ticks
start at zero on every boot and a panic, a watchdog or the connection watchdog's recovery reboot would otherwise
let a device with a standing fault report it again each time it came back; a power-on clears it, which is what a
device that was just switched on should do. While the clock is still unset nothing is written at all and the
fault is looked at again on the next pass: the interval cannot be measured yet, and a device in that state is
discarding its readings for the same reason.

### 6.2 `hardware-info:`

A device tells the cloud what hardware it has by riding the same log topic:

```
{"severity":0,"message":"hardware-info:<key>=<value>"}
```

The server splits at the **first** `=` — a value may contain more — trims the key, and requires
`/^[a-zA-Z0-9_-]{1,64}$/` for the key and at most 512 characters for the value; anything else is dropped without
a word (`hardware-report.service.ts`). What passes is stored as `devices.state.hardware.<key>`, flat as the
device sends it — except `webcam_pwd` and `webcam_url`, which are the camera's own credentials and go to the
camera record instead, where nothing serialises them. Nothing is ever written to the diary, and there is no
reply.

Because it rides the log topic, a report inherits the log's limits: the queue may drop it when it is full, and
the whole message has to fit the 384-byte serialisation buffer. That is why the firmware caps a reported value
at `MAX_REPORTED_VALUE_LEN = 288` characters and splits the socket table into chunks of three
(`wifi.cpp:53-79`). Three rows at their longest are asserted against that cap at compile time, because a value
over it would serialise into truncated JSON and the server would drop the whole chunk without a word.

**Every key a device reports today:**

| Key | Value | Emitted by | Where |
| --- | --- | --- | --- |
| `claimcode_auth` | `on` | every type, at init | `fridgecloud.cpp:164` |
| `firmware_version` | the build's uuid | every type, at init | `fridgecloud.cpp:165` |
| `co2` | `on` / `off` | controller, when SCD presence changes | `controller.cpp:802` |
| `leaf_temp` | `on` / `off` | controller, MLX90632 presence | `controller.cpp:811` |
| `ppfd` | `on` / `off` | controller, VEML7700 presence | `controller.cpp:818` |
| `sockets` | csv of roles that have a socket, or `none` | controller, fridge | `wifi.cpp:2744` |
| `socket_ips` | `role@ip` per role, first socket only, or `none` | controller, fridge | `wifi.cpp:2745` |
| `sockets_n` | how many rows the table holds | controller, fridge | `wifi.cpp:2752` |
| `socket_list<k>` | up to three `role\|id\|ip\|state\|override-or-timer` entries | controller, fridge | `wifi.cpp:2754-2767` |
| `socket_roles` | csv of the roles this build accepts | controller, fridge, at init | `wifi.cpp:2811` |
| `caps` | csv of what it accepts beyond the frozen commands | controller, fridge, at init | `wifi.cpp:2812` |
| `socket_pulse` | `role:seconds`: the failsafe each role's socket is given | controller, fridge, at init | `wifi.cpp:2813` |
| `webcam_did` | the camera's device id, or `none` | at boot and on pairing | `wifi.cpp:2833-2835`, `:1358` |
| `webcam_ip` | where the camera last answered, or `none` | at boot, and on discovery | `wifi.cpp:2839-2841` |
| `webcam_url` | a legacy stored RTSP URL, or `none` | at boot | `wifi.cpp:2843-2845` |
| `webcam_uid` | the camera's 20-byte P2P id, formatted | when discovery learns it | `terpcam.cpp:225-228` |
| `webcam_pwd` | the password the controller set on the camera | after each securing attempt | `terpcam.cpp:566-571` |

The `socket_*` and `webcam_*` keys come from the controller and the fridge only — no other type calls
`wifiInitAuxCloudReporting`. `reportCamIp` (`terpcam.cpp:220-229`) sends `webcam_ip` and `webcam_uid` whenever
discovery has learnt a new value, which is at the end of every capture.

The `none` sentinel matters. A device reports `webcam_did=none` and `sockets=none` rather than staying silent,
because silence cannot clear a stale value: the cloud would keep whatever it last heard, and a camera unpaired
while the module was offline would look connected forever (`wifi.cpp:2828-2833`, `:2653-2657`).

`webcam_pwd` is reported on **every** attempt to secure the camera, including the failed ones, where its value is
the empty string (`terpcam.cpp:566-571`). Since securing is retried on every capture, a camera that cannot be
secured makes the controller report an empty password roughly every 30 s.

Server-side handling beyond storage (`hardware-report.service.ts`):

| Key | Extra effect |
| --- | --- |
| `claimcode_auth` | `'on'` makes `POST /device/claimcode` require the device password |
| `firmware_version` | the build is reported to the rollout and stored as `devices.state.firmwareId` |
| `sockets_n` | superseded `socket_list<k>` chunks from a larger table are unset |
| `socket_list<k>` | a row whose state left the one the last report gave stamps `devices.state.socketStateChangedAt.<slot>`, falling silent included; a row that had no state yet stamps nothing, so a build that starts reporting the column does not read as every socket having just moved |
| `webcam_did` | the camera the controller pairs is reconciled into a row of `cameras` |
| `webcam_pwd` | the camera's `secret`; an empty value means "none" |
| `webcam_uid`, `webcam_ip` | the camera's `uid` and `ip`, which is how the cloud reaches it directly |

The reconciliation requires `/^[A-Za-z0-9_-]{4,32}$/` of the reported id. A device that reports one is given the
camera row it already has, or a new one with its twelve months of Premium; `none` and the empty string retire
the row rather than deleting it, so the pictures it took keep their camera and pairing it again gives it back
the entitlement it had. A device nobody owns gets no camera row — a camera belongs to somebody — and the row is
made when the device is claimed or the next time it reports.

### 6.3 The socket table, chunked and reassembled

The full table cannot travel as one value, so it is reported as a count followed by chunks
(`wifi.cpp:2739-2767`):

```
hardware-info:sockets=heater,light,pump
hardware-info:socket_ips=heater@192.168.1.60,light@192.168.1.61,pump@192.168.1.63
hardware-info:sockets_n=4
hardware-info:socket_list0=heater|4C7525A1B2C3|192.168.1.60|on|,heater|4C7525A1B2C4|192.168.1.62||,light|4C7525A1B2C5|192.168.1.61|off|override=off@120
hardware-info:socket_list1=pump|4C7525A1B2C6|192.168.1.63|off|timer=30/900
```

Four sockets: a heater that is on, a second heater the module could not reach and so says nothing about, a light
an override is holding off for another two minutes, and a pump on a timer.

Rules a reader has to follow:

- Entry *n* of chunk *k* is the socket in slot `k * SOCKETS_PER_REPORT_CHUNK + n`, with
  `SOCKETS_PER_REPORT_CHUNK = 3` (`wifi.cpp:57`). That slot number is what a command names in `slot`.
- `sockets_n` bounds the table. Chunks left over from a larger table must be ignored; the server also unsets
  them (`hardware-report.service.ts`).
- The count is always sent **before** the chunks, so the cleanup never removes a chunk that is about to arrive.
- Each entry is `role|id|ip|state|override-or-timer` (`wifi.cpp:2731-2737`). `id` is the socket's Tasmota MAC in
  upper hex, learned after pairing; `ip` may be empty for a row whose address was lost and which is being looked
  for again (`wifi.cpp:2732`). `role` is empty for a socket nobody has assigned one to.
- `state` is `on` or `off` when the module has commanded the socket and it answered, and **empty when it has
  not**: a socket that stops answering, or one nobody drives, says nothing rather than repeating what it was
  last told. A reader turns an empty state into "unknown".
- The last column is `override=<on\|off>@<seconds>` with the seconds the override has left, `timer=<onS>/<everyS>`
  for a socket that repeats on one, or empty. An override takes the column when both exist. `auto` is a state a
  command may carry and one a report never does: it ends an override rather than being one.
- A row from a build without the socket change ends after the third column, and a reader that stops there reads
  every row the same way it always did. That is why the columns were added at the end.
- The address a row can carry is bounded at `SOCKET_ADDRESS_MAX_LEN = 40` characters (`wifi.cpp:69-73`): three rows
  have to fit one log message, and the address is the only column without a length of its own. Forty holds every
  IPv4 and IPv6 literal and a short hostname; a longer one is refused by `socket_set` rather than stored and then
  left out of the table.
- `sockets` and `socket_ips` are the older, lossy summary: one entry per role. They stay because readers that
  predate the table understand them.
- A whole report is re-sent on boot, on every change of the table (`wifi.cpp:2739`, called from
  `wifiInitAuxCloudReporting` `:2824` and from each mutation at `:598,604,2528,2913,3023,3347`), and **when a
  row's state or override changes, at most once per 30 s** (`SMART_SOCKET_REPORT_MIN_INTERVAL`,
  `wifi.cpp:2769-2787`). Without that last rule a socket that stopped answering would keep the state of the boot
  report forever; with no limit, an output oscillating around its threshold would fill the log queue with
  tables. The seconds an override has left are deliberately not part of what counts as a change — they tick
  down every second.

How the report is spelled — `MAX_SOCKETS = 32`, `SOCKETS_PER_REPORT_CHUNK = 3`, `socketListKey`,
`socketChunkCount` — is declared once in `shared-types/src/v1/socket-report.ts`, and the server and the simulator
both read it from there. The decoders that turn a report into the rows the API answers with are in
`server/src/modules/device-protocol/sockets.ts`; the web app reads those rows and never the report.

Roles are a fixed list in the firmware (`wifi.cpp:2607-2624`; the first entry `back` is a menu sentinel and never
a role):

| Role | What its socket follows |
| --- | --- |
| `dehumidifier` | the dehumidifier output |
| `heater` | the heater output |
| `light`, `secondary_light` | the light output |
| `co2` | the CO2 valve |
| `humidifier` | the dehumidifier's band read the other way round: on below the target minus `targetHumidityDiff`, off at the target |
| `exhaust` | the cooling decision the temperature and breeding modes compute |
| `circulation`, `fan` | anything: on whenever the module is controlling and not paused |
| `pump`, `custom_timer` | the row's own timer, and nothing else |
| `manual` | nothing: off unless an override holds it |
| *(empty)* | nothing at all: an unassigned socket is never commanded |

The five in the first block are what every build in the field knows; the rest arrive with the socket firmware
change and are only ever sent to a device that announced them in `socket_roles`
([12](#12-extending-it-safely)). Any number of sockets may share a role, up to `MAX_SMART_SOCKETS = 32` rows in
total (`wifi.h:80`). A row with a role the build does not know is dropped when the table is loaded
(`wifi.cpp:2470`), which is also what a rollback to a build without the new roles does with them.

---

## 7 The configuration document

**The configuration is the device's own.** The cloud stores a copy and hands it back, but the device decides what
it means and which keys exist; the server never validates or interprets it.

| Direction | Payload | Where |
| --- | --- | --- |
| server → device | the stored document, serialised | `device-configuration.service.ts` |
| server → device | the same document, as the reply to a `fetch` | `device-ingest.service.ts` |
| device → server | the device's whole settings object as JSON | `fridgecloud.cpp:556-561` |

When a device receives one it parses it, adopts it silently, writes it to NVS key `config` and re-runs its
control loop (`controller.cpp:557-566`). It sends **no acknowledgement and no echo**. The `fridge`, `plug`, `fan`
and `light` types skip the NVS store while `mqttcontrol` is true, so direct control does not overwrite the saved
settings (`fridge.cpp:588-594`, `plug.cpp:576-582`, `fan.cpp:371-377`, `light.cpp:332-338`).

When a setting is changed on the device itself, the device publishes its whole document on the same topic
(`saveAndUploadSettings`, e.g. `controller.cpp:516-543`). The server overwrites `devices.configuration` with it
and echoes nothing (`device-ingest.service.ts`).

**A key a device does not know is ignored, and disappears.** Parsing is key by key
(`loadIfAvaliable`, `controller.cpp:437-453`): a key that is missing keeps the struct default and logs a line to
the serial console; a key that is present but unknown is never looked at. And because the echo is rebuilt from
the struct rather than from the received document, an unknown key is **not** written back — so a key the cloud
adds survives only until the device next uploads its settings, and is then gone from the stored copy as well.
A document that does not parse at all resets every setting to its defaults (`controller.cpp:461-464`).

### 7.1 Keys per hardware type

**controller** (`controller.cpp:468-488`, echo `:516-543`, defaults `controller.h:15-60`):

| Key | Type | Default |
| --- | --- | --- |
| `workmode` | `off`, `breed`, `temp`, `small`, `dry`; legacy `full` maps to `small` | `off` |
| `daynight.day` / `daynight.night` | uint32, seconds UTC | 21600 / 79200 |
| `daynight.maxDehumidifySeconds` | float | 0 |
| `daynight.targetHumidityDiff` | float | 5.0 |
| `daynight.useLongHumidityAvg` | float, `> 0` = long average | 1.0 |
| `daynight.minimalDehumidifierOffTime` | uint32, seconds | 240 |
| `co2.target` | float ppm; forced to 0 without an SCD sensor | 300 |
| `day.temperature` / `day.humidity` | float | 25.0 / 60.0 |
| `night.temperature` / `night.humidity` | float | 25.0 / 60.0 |
| `lights.sunrise` / `lights.sunset` | float minutes | 15 / 15 |
| `lights.limit` | float percent | 100 |

`lights.maintenanceOn` exists in the controller's struct (`controller.h:55`) and is echoed nowhere and read
nowhere — the controller has no `loadIfAvaliable` line for it, so the code that would use it never fires.

**fridge** (`fridge.cpp:484-504`, echo `:533-565`): the controller's keys plus `mqttcontrol` (bool, default
false, read at `:484`, **not echoed**), `daynight.linearChange` (float, 0), `co2.sunsetOff` (float, 0),
`lights.maintenanceOn` (float, 0 — here it is both read and used), `fans.external` and `fans.internal` (float
percent, 100). `workmode` additionally accepts `full` and `exp` (`fridge.h:17-23`).

**plug** (`plug.cpp:406-452`, echo `:499-561`): `mqttcontrol`; `workmode` ∈ `off`, `heater`, `cooler`,
`humidify`, `dehumidify`, `co2`, `timer`, `watering` (`plug.h:23-30`); `usedaynight`; `daynight.day` /
`daynight.night`; `timer.timeframes[]` of `{ ontime (seconds UTC), duration (minutes) }`;
`<heater|cooler|humidify|dehumidify>.<day|night>.<on|off>` thresholds; `co2.mode` (`const` or `periodic`),
`co2.period`, `co2.duration`, `co2.on`, `co2.off`; `limits.overtemperature.{enabled,limit,hysteresis}`,
`limits.undertemperature.{…}`, `limits.time.{enabled,min_off,min_on}`; `fan` (the device id of a fan, echoed only
in `co2` workmode).

**fan** (`fan.cpp:414-432`, echo `:207-241`): `mqttcontrol`; `mode` (uint32: 0 fixed, 1 temperature, 2 humidity,
3 both); `min_speed`; `<day|night>.<temperature|humidity|fixed_speed|max_speed>`;
`co2inject.device_id` (its presence enables the block) with `co2inject.{speed,usedaynight,day,night,period,
duration}`. `mqttcontrol` and the `co2inject` block are not echoed.

**light** (`light.cpp:394-400`, echo `:121-138`): flat, not nested — `mqttcontrol` (not echoed), `day`, `night`
(seconds UTC), `max_temperature`, `limit`, `sunrise`, `sunset`.

**cam**: `loadSettings` is empty (`cam.cpp:38-39`). A document is accepted and nothing is read from it.

### 7.2 `mqttcontrol` and the `control/#` topic

Setting `mqttcontrol: true` on a `fridge`, `plug`, `fan` or `light` hands its outputs to whoever publishes on
`/devices/<id>/control/<output>` — the topic suffix is the output name and the payload is a bare value
(`fridgecloud.cpp:236-239`). Accepted names: fridge `heater`, `dehumidifier`, `co2`, `light`, `fan-internal`,
`fan-external`, `fan-backwall` (`fridge.cpp:669-706`); plug `relais` (`plug.cpp:592-599`); fan `fan`
(`fan.cpp:393-400`); light `light` (`light.cpp:344-351`). The controller has no `onControl` handler at all.

Direct control expires 60 seconds after the last configuration message, after which the NVS configuration is
reloaded (`fridge.h:119`, `fridge.cpp:859-863`; `plug.cpp:752-756`; `fan.cpp:166-170`; `light.cpp:82-86`). This
server has never published on `control/#`.

---

## 8 Commands

**server → device** on `/devices/<id>/command`, one JSON object with an `action`. The device parses it into a
1024-byte document and drops it without a word if it does not parse (`fridgecloud.cpp:218-224`). `reboot` is
handled in the cloud client itself, for every hardware type; everything else is handed to the hardware type's
own handler (`:226-232`).

| `action` | Arguments | Honoured by |
| --- | --- | --- |
| `reboot` | — | every type |
| `maintenance` | `durationMinutes` (number) | controller, fridge |
| `test` | `outputs: { heater, dehumidifier, co2, lights, fanint, fanext, fanbw }` | fridge, fan |
| `stoptest` | — | fridge, fan |
| `socket_set` | `role`, `ip`, optional `slot`, `user`, `password`, `append`, `timer { onS, everyS }` | controller, fridge |
| `socket_remove` | `role`, optional `slot` | controller, fridge |
| `socket_test` | `role`, optional `slot` | controller, fridge |
| `socket_override` | `slot` **or** `output`, `state: on \| off \| auto`, `seconds` | controller, fridge announcing `socket_override` |
| `cam_capture` | — | controller, fridge |

`socket_set`'s `timer` and `socket_override` are the two additions since the builds in the field. They are sent
only to a device that announced `socket_timer` and `socket_override` in `caps`, and a role outside `socket_roles`
is never sent at all, because an old build drops what it does not know without a word
([12](#12-extending-it-safely)).

`plug`, `light` and `cam` have empty command handlers (`plug.cpp:588-590`, `light.cpp:353-360`,
`cam.cpp:56-58`) and so honour nothing beyond `reboot`. None of `plug`, `fan`, `light` or `cam` calls
`wifiInitAuxCloudReporting` or `wifiHandleAuxCommand`, so they never report sockets or a camera and ignore
`socket_*` and `cam_capture`.

**An action a device does not know is dropped silently.** There is no negative acknowledgement, no error log and
no reply of any kind: the command subject fires, the type's handler matches nothing,
`wifiHandleAuxCommand` returns `false` (`wifi.cpp:3180`), and the message ends there. That is the single most
important property for anything new: a caller cannot tell an unimplemented action from one that worked.

### 8.1 `reboot`

`{ "action": "reboot" }`. The device sets an RTC-memory flag and defers the restart until the log queue has
drained, so pending messages still reach the cloud (`fridgecloud.cpp:28,226-230,433-437`). The flag survives the
soft reset, so the next boot reports `message-device-booted:REMOTE` instead of the generic `SW`
(`:158-160`). Published by `device-publisher.service.ts`.

### 8.2 `maintenance`

`{ "action": "maintenance", "durationMinutes": <number> }`. The device parks its heater, dehumidifier and CO2
outputs for that long and answers with `message-maintenance-mode-activated-remote:<minutes>`
(`controller.cpp:568-576`, `fridge.cpp:629-636`). The tick arithmetic is overflow-safe across the ~49-day tick
wrap (`controller.h:151-160`).

The server sets its own `maintenance_mode_until` on the HTTP call as well, and sets it again when the device's
log line arrives (`device-publisher.service.ts`, `device-ingest.service.ts`), so the window survives a device that never heard the
command.

### 8.3 `test` and `stoptest`

`{ "action": "test", "outputs": { … } }` with all seven fields present. A caller may name fewer, and the ones it
leaves out are sent as zero (`device-publisher.service.ts`): the firmware reads each field out of the document
and a missing one reads as `0`, so an output left out of the command is an output switched off, not one left
alone.

The output names are the fridge's (`fridge.cpp:601-610`): `dehumidifier` and `co2` go to their pins as raw 8-bit
values; `lights`, `fanint`, `fanext` and `fanbw` are percentages, multiplied by 2.55 into PWM; `heater` is a
percentage of the control tick the heater is held on (`fridge.cpp:840`). Test mode lasts
`TESTMODE_MAX_DURATION = 10`, decremented once per control tick of one second — about ten seconds after the last
`test` (`fridge.h:121`, `fridge.cpp:836-837`; the `// times 10sec` comment at `fridge.h:121` is stale).
`stoptest` ends it at once (`fridge.cpp:627-628`).

The fan accepts both actions but reads none of the values (`fan.cpp:384-389`). The controller, plug, light and
cam ignore them entirely.

### 8.4 The socket commands

All four are composed server-side from a typed command (`device-publisher.service.ts`), so the action can only
ever be one of `socket_remove`, `socket_test`, `socket_set`, `socket_override`; the role must be one a device has
announced; `socket_remove` and `socket_test` name the row by its slot and take the role from the table the device
reported. A socket test asks the firmware for the pulse it already gives — two seconds — because the command
carries no duration and old firmware would ignore one.

Every rule the firmware refuses one of these by is checked again before the publish, because a refusal never
travels back: a slot the device reports no socket in, an address over `SOCKET_ADDRESS_MAX_LEN` or with a space in
it, credentials over 48 characters, a timer that is on for at least as long as its period or that names a role
which does not run on one, an override of any output but `light`, and an override that carries no duration while
it is not `auto`. The caller is told which one; the firmware, asked anyway, would say nothing at all.

**`slot` is optional everywhere and means one row of the table**, as reported in `socket_list<k>`. Left out, the
command addresses every socket of the role for `socket_remove` and `socket_test`, and the single existing socket
of the role for `socket_set` — which is all a command could mean back when a role could hold only one
(`wifi.h:107-111`, `wifi.cpp:2866-2882`).

`socket_set` (`wifi.cpp:2917-3025`) assigns or re-addresses a socket. It fails — logging
`message-aux-command-failed:socket_set:<role>` — for an unknown role, an empty address or one over
`SOCKET_ADDRESS_MAX_LEN = 40` characters, an address containing a space, credentials over 48 characters, a timer
that names one half without the other or is on for at least as long as its period, a role that already holds
several sockets when no `slot` was named and `append` was not set, or a full table. Three subtleties:

- **Credentials are only touched when the command carries them.** The firmware keys that on
  `command.containsKey("password")` (`wifi.cpp:3139`), and the server only includes `user`/`password` in the
  payload when the caller supplied either (`device-publisher.service.ts`). Sending an empty password
  explicitly puts the socket back on the device's default credentials; leaving both out re-addresses the socket
  and keeps whatever it had, which is what stops a re-addressing from locking the device out of a socket with
  its own web password.
- **`append: true` adds a socket to a role** instead of configuring the one it has, because a caller who wants a
  second heater has no slot to name yet (`wifi.cpp:3142`). An address the table already holds always
  configures that existing row rather than adding a duplicate (`:2969-2979`).
- **The timer is part of the row a set writes**, the way the role and the address are: a command that carries
  none leaves the socket without one (`wifi.cpp:2997-3001`). That is the opposite of how credentials behave,
  and deliberately so — the caller sends the row it wants, and the credentials are the one thing it cannot
  read back to send again. `timer { onS, everyS }` means on for `onS` seconds out of every `everyS`, is stored
  in the socket's own NVS row and so survives a restart, and is only consulted for `pump` and `custom_timer`.
  A restart starts the cycle again from its beginning.

`socket_override` (`wifi.cpp:3049-3103`, `:3154-3165`) forces one socket, or an output the module drives itself,
for `seconds`; the state `auto` hands it back and carries no duration. The override **lives in RAM with an
expiry** and is consulted before the row's timer and before its role's target, so it survives neither the expiry
nor a reboot. That is the failsafe, and it is the point: with the socket's own `PulseTime` watchdog
([11.2](#112-the-failsafe-that-switches-sockets-off)) it means nothing outside the firmware can hold a socket on
for longer than it asked for. It fails — logging `message-aux-command-failed:socket_override:<slot or output>` —
for a slot outside the table, a state that is not `on`, `off` or `auto`, a duration of zero or over
`SOCKET_HOLD_MAX_SECONDS = 86400`, and for any `output` but `light`. A socket under an override is re-asserted on
the next control pass rather than at the end of its role's send interval, because somebody is waiting with a
finger on a switch.

`{ "action": "socket_override", "output": "light", … }` holds the module's own light output instead of a socket:
the light runs at the configured `lights.limit` while the override says on, and at nothing while it says off
(`controller.cpp:906-913`, `fridge.cpp:958-965`). The light sockets follow the output, so they are held with it.
This is the `light_override` capability, and it is the only output that takes one.

`socket_remove` (`wifi.cpp:2884-2915`) best-effort sends `Reset 1` to the socket so it reopens its pairing AP,
erases the rows, logs `message-smart-socket-disconnected:<role>` for each, and re-reports the table. It is
idempotent for a known role and fails only on an unknown role or an out-of-range slot.

`socket_test` (`wifi.cpp:3027-3045`) pulses the addressed sockets ON for two seconds and back OFF, blocking with
the watchdog fed, and answers `message-smart-socket-tested:<role>` or
`message-smart-socket-cmd-failed:<role>:test`. The control loop re-asserts the real target within its resend
window afterwards.

### 8.5 `cam_capture`

`{ "action": "cam_capture" }`, handled by `wifiHandleAuxCommand` (`wifi.cpp:3110-3117`) on the controller and the
fridge. The camera pipeline asks for it, and the protocol module publishes it like every other command. A capture
that fails logs
`message-aux-command-failed:cam_capture`. See [9 The still cycle](#9-the-still-cycle).

---

## 9 The still cycle

A camera is paired on the controller, in its menu. The controller stores the camera's device id in NVS and
reports it as `hardware-info:webcam_did=<did>`; the cloud makes that a row of `cameras` of kind
`terpcam_controller` and starts asking for pictures (`hardware-report.service.ts`). One camera per module: the
pairing flow refuses a second while one is stored (`wifi.cpp:1382-1389`).

The poller (`server/src/modules/v1/camera/camera-poller.service.ts`) runs a pass every 5 s and asks each configured
camera at most every `stillIntervalSeconds`, with a failure backoff of `min(interval × 2^failures, 120 min)`. It
skips a device in maintenance or with `workmode: off`, and one whose previous read is still in flight.

### 9.1 Through the controller

1. The cloud publishes `{"action":"cam_capture"}` on `command` and waits up to `CAPTURE_TIMEOUT_MS = 30 000`
   (`terpcam-p2p.service.ts:42,81-95`). A new request supersedes a pending one.
2. The controller reaches the camera over its P2P transport on the LAN and asks it for a JPEG. It has nowhere
   near enough RAM to hold a whole picture, so fragments are published as they arrive, out of a 48 KiB sliding
   window (`terpcam.cpp:104-108,736-769`).
3. Each fragment is one `image` message (`terpcam.cpp:748-752`):

   ```json
   { "capture": 1893422, "seq": 0, "last": false, "payload": "<base64>" }
   ```

   | Key | Meaning |
   | --- | --- |
   | `capture` | identifies this capture; `millis()` at the start (`terpcam.cpp:710`) |
   | `seq` | fragment index from 0, always ascending |
   | `last` | `true` on the final fragment; the firmware always sends the key, `true` or `false` |
   | `payload` | base64 of the raw JPEG bytes of this fragment |
   | `abort` | `true` in place of a payload when a started capture failed (`terpcam.cpp:949-953`) |
   | `h264` | reserved: the payload is a raw keyframe rather than JPEG. No shipped firmware sets it |

4. The cloud reassembles (`terpcam-p2p.service.ts:97-155`). The first fragment fixes the capture id and
   fragments carrying a different one are dropped, so a straggler from an abandoned attempt cannot corrupt the
   picture. `abort` rejects the capture. A missing `seq` falls back to insertion order. The total is bounded by
   `MAX_IMAGE_BYTES = 2 MiB`. `last` triggers the concatenation in ascending `seq` order.
5. The JPEG is stored like any other still, and feeds the timelapse and thinning pipelines unchanged.

Capture-side limits, all in `terpcam.cpp`: the capture is skipped when the largest free heap block cannot spare
48 KiB plus a 16 KiB margin, logging `message-cam-capture:skipped-low-heap` (`:61,104-106,652-663`); Wi-Fi modem
power-save is disabled for the duration, because with it on most of the fragments are lost (`:670-671`); the
transfer is bounded by `TRANSFER_MS = 20 000` and `IDLE_ABORT_MS = 8 000` (`:55-56`), inside the cloud's 30 s
wait; the image itself by `MAX_IMAGE_BYTES = 512 KiB` (`:108`); one attempt per request, because the cloud paces
the retries (`:62`).

The controller asks for 1280x720 and falls back to 640x360 for the rest of the boot after three replies that
carried no picture at all — which is what a camera rejecting the size parameter looks like, as distinct from
ordinary fragment loss (`terpcam.cpp:76-82,924-932`).

### 9.2 Directly from the cloud

When `TERPCAM_RENDEZVOUS_HOSTS` is configured and the device has reported a `webcam_uid`, the server speaks the
camera's P2P protocol itself over UDP and takes a full-resolution keyframe, which it decodes to JPEG
(`server/src/modules/v1/camera/terpcam-direct.service.ts`). **No MQTT is involved at all**: the only thing the
device contributes is the `hardware-info` that named the camera, its id, its last address and its password.

Which path a poll takes (`camera-poller.service.ts`):

| Situation | Path |
| --- | --- |
| No rendezvous hosts configured, or no `webcam_uid` reported | the controller |
| Direct capture succeeds | direct |
| Direct fails, but it has succeeded this online period or has failed fewer than twice | no picture this poll |
| Direct has failed twice running with no success since the device came online | the controller |
| The test-image button | the controller on the first failure |

The camera is a purchased VStarcam-family unit. What the firmware and the server need of its own CGI and P2P
transport is in the code in this repository; **the full vendor CGI recipe is documented in the private
`terpcontrol.com` repository** and is not reproduced here.

---

## 10 The OTA path

1. The device reports what it runs on every connect: `fetch {"firmware_id": "<FIRMWARE_VERSION>"}`
   (`fridgecloud.cpp:357,363-380`), and queues `hardware-info:firmware_version=<id>` at init (`:165`).
2. The rollout loop picks online devices of a class whose firmware differs from the channel's and sets a pending
   firmware id (`firmware-rollout.service.ts`). The next `status`, `bulk` or `fetch` arms a timer:
   the instruction goes out 30 s later, and the delay doubles on each resend up to 24 h
   (`INSTRUCTION_INITIAL_DELAY_MS`, `INSTRUCTION_MAX_DELAY_MS`). The backoff resets when the pending id changes or the device reports it.
3. The server publishes the pending firmware id on `firmware` as a **bare string, not JSON**
   (`firmware-rollout.service.ts`).
4. The device trims it and compares it against `FIRMWARE_VERSION` (`fridgecloud.cpp:185-195`). An empty or
   identical id is ignored. Otherwise it logs `message-device-firmware-update`, fires its update subject, and
   downloads `<API_URL>/device/firmware/<id>/firmware.bin`.
5. The update subject is what makes the OTA safe: the controller and the fridge zero every output and flush every
   smart socket OFF **synchronously**, because the download blocks the loop task until the reboot and nothing
   else would push the OFF command out (`controller.cpp:584-603`, `fridge.cpp:646-667`,
   `wifi.cpp:471-513`).
6. On success the device restarts, and the new id goes out on `fetch` and as `hardware-info:firmware_version`.
7. The server compares the reported id: equal to the one it was running, nothing happens; different from the
   pending one, `devices.state.firmwareId` is updated and no more; equal to the pending one, the update is closed
   with `state.updateEndedAt` and an entry `message-firmware-update-complete-with-ids:<old> -> <new>`. The
   protocol module tells the rollout what was reported before it stores it, because that comparison is what the
   rollout is deciding from.

**`fwupdate` is the second, unused door.** A device also subscribes to `/devices/<id>/fwupdate` and accepts
`{ "version": "<id>", "url": "<url>" }`, applying the same guard and then downloading from that arbitrary URL
(`fridgecloud.cpp:198-216`). The server has never published it.

A build compiled without `FIRMWARE_VERSION` defines `NO_FIRMWARE_UPDATE` and ignores both topics
(`fridgecloud.cpp:18-22,188,208`).

---

## 11 Timing and limits

| Limit | Value | Where |
| --- | --- | --- |
| MQTT maximum packet size | 4096 bytes, set on every connect | `fridgecloud.cpp:175` |
| MQTT socket / write timeout | 5 s | `fridgecloud.cpp:153-154` |
| Reading document serialisation buffer | 512 bytes | `fridgecloud.cpp:503-504` |
| Reading buffer | 120 documents, then `message-buffer-overflow` and drop | `fridgecloud.h:31`, `.cpp:487-495` |
| Reading cadence | one sample per 5 control ticks → one `bulk` / 5 s | `fridgecloud.h:32-33`, `main.cpp:70` |
| Log queue | 32 entries; further entries dropped silently | `fridgecloud.h:35`, `.cpp:382-387` |
| Log message serialisation buffer | 384 bytes | `fridgecloud.cpp:418-419` |
| `hardware-info` value cap (firmware) | 288 characters | `wifi.cpp:58` |
| `hardware-info` key / value cap (server) | `[A-Za-z0-9_-]{1,64}` / 512 characters | `hardware-report.service.ts` |
| Sockets per `socket_list` chunk | 3 | `wifi.cpp:57`, `device-protocol/sockets.ts` |
| Smart sockets per device | 32 | `wifi.h:80`, `device-protocol/sockets.ts` |
| Consecutive failed publishes before a forced reconnect | 3 | `fridgecloud.h:88`, `.cpp:441-456` |
| Tunnel slots | 3 | `fridgecloud.h:91` |
| Tunnel TCP frame | ≤ 127 raw bytes, base64-encoded | `fridgecloud.h:19`, `.cpp:803-816` |
| Tunnel messages per loop | ≤ 6 TCP and ≤ 41 UDP, shared across slots | `fridgecloud.h:20,25`, `.cpp:763,775,805` |
| Tunnel activity | only while the display is idle (30 s after the last input) | `fridgecloud.cpp:730-732,759-761` |
| Capture timeout (cloud side) | 30 s | `terpcam-p2p.service.ts:42` |
| Assembled picture cap (cloud side) | 2 MiB | `terpcam-p2p.service.ts:44` |
| Capture transfer / idle (device side) | 20 s / 8 s | `terpcam.cpp:55-56` |
| Still poll interval | the camera's own `stillIntervalSeconds`, backoff to 120 min | `camera-poller.service.ts` |
| Upgrade instruction | first after 30 s, doubling to at most 24 h | `firmware-rollout.service.ts` |

### 11.1 How "online" is decided

A device is online when its `state.lastSeenAt` is younger than ten minutes, which is `VALUE_AGE.staleSeconds` in
`shared-types/src/v1` — the same threshold a reading is called stale at, so a dimmed card and the `offline`
metric say the same thing about the same device. It is stamped by the ingest on every `status`, `bulk` and
`fetch` — and on nothing else. A device that only logs, only reports hardware
info or only answers commands does **not** count as alive. Since a healthy device publishes `bulk` every five
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

Source: `wifi.cpp:808-826`; the value is written at pairing (`wifi.cpp:3254-3259`), and the same seconds are
announced per role as `hardware-info:socket_pulse` ([6.2](#62-hardware-info)). A socket added by address from
the cloud rather than paired through the module's own flow is never given one, because nothing but the pairing
flow configures the plug. The controller resends every
socket's state at least every `SMART_SOCKET_RESEND_PERIOD = 60 s` (`wifi.cpp:30,618-620`), so the timeout
outlives normal operation and expires soon after a controller drops off the network. **Nothing outside the
firmware can hold a socket on or off for longer than one resend period** — an override included: it is held in
the module's RAM, and a reboot ends it as surely as its expiry does.

Around that: at most one command per role per 30 s, except `co2`, `pump` and `custom_timer`, which are exempt at
1 s because their ON is a pulse of seconds a 30 s floor would stretch (`wifi.cpp:837-844`); three consecutive
failures back a socket off for 300 s
(`wifi.cpp:32-33,649-654`); ten failures trigger a LAN sweep that re-finds the socket by its MAC, with a 900 s
cooldown (`wifi.cpp:39-42`); a reachable socket is asked for its hardware id every 600 s, and a mismatch clears
the stored address and logs `message-smart-socket-address-lost` (`wifi.cpp:52,569-605`). One control pass spends
at most 2 s on sockets, and the pre-OTA flush at most 20 s (`wifi.cpp:46,48`).

---

## 12 Extending it safely

**A device announces what it can do; the cloud never assumes.** The keys that carry a capability today:

| Key | Announces |
| --- | --- |
| `firmware_version` | the build, as an opaque id |
| `claimcode_auth` | whether `POST /device/claimcode` needs the device password |
| `co2`, `leaf_temp`, `ppfd` | which optional sensors are fitted |
| `sockets`, `sockets_n`, `socket_list<k>` | that this build reports a socket table, and what is in it |
| `socket_roles` | every role this build accepts, the empty "unassigned" one aside |
| `caps` | what it accepts beyond the frozen commands: `socket_override`, `socket_timer`, `light_override` |
| `socket_pulse` | the failsafe seconds each role's socket is programmed with at pairing |
| `webcam_did`, `webcam_uid`, `webcam_pwd`, `webcam_ip`, `webcam_url` | that a camera is paired, and how to reach it |

Note the difference between a key with the value `none` and a key that is absent. `sockets=none` and
`webcam_did=none` mean "this build reports, and there is nothing"; the key missing altogether means "firmware too
old to report". That distinction is deliberate (`wifi.cpp:2653-2657`, `:2828-2833`) and is the only reliable feature
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
(`fridgecloud.cpp:218-233`, `wifi.cpp:3180`). A new action sent to a device that does not know it looks
exactly like one that worked. The same holds for a configuration key a device does not parse: it is ignored, and
it also vanishes from the stored copy the next time the device uploads its settings
([7](#7-the-configuration-document)).

Together those three facts give the rule: **send a device only what it has announced it understands.** A device
that announces nothing new gets nothing new, and a control that depends on something it has not announced is
drawn as unavailable rather than tried.

Two further things that stay fixed because a device depends on them:

- **The topic prefix is the device's identity.** The broker's authorisation is a literal prefix match on
  `.devices.<device_id>.` (`mqtt-auth.service.ts:90`), so a topic cannot be moved or renamed without changing
  what every deployed device may publish.
- **The configuration is opaque.** The server stores a string and hands it back; any structure it imposes would
  be structure the device already disagrees with.

---

## 13 Where the witnesses disagree

The firmware decides. These are the places where the server or the simulator does something else, and what a
reader of either should not conclude from it.

- **Live readings.** The firmware uses `bulk` in cloud mode and bare `status` sub-topics in custom-MQTT mode; it
  never publishes a JSON document on `status`. The server accepts one there anyway and discards its timestamp,
  and the simulator sends its live samples exactly that way.
- **`image.last`.** The firmware always sends the key, `true` or `false`. The server treats a missing `last` as
  `false`, and the simulator sends the key only on the final fragment.
- **`image.abort` and `image.h264`.** The firmware sends `abort` when a started capture fails and never sets
  `h264` on the shipped controller path. The server handles both, and would decode an `h264` payload as a
  keyframe. The simulator sends neither.
- **Extra `log` keys.** The firmware sends `severity` and `message` and nothing else, as does the simulator, and
  those two are what the server reads. Until the rewrite it spread every key of the object into the entry, so a
  `title`, `time`, `data` or `images` a device sent would have been stored.
- **`message-device-firmware-update`.** The firmware sends it without an argument; the simulator appends the
  firmware id.
- **`message-cam-capture`.** The firmware sends only failures, keeping successes on the serial console. The
  server drops `…:ok` at ingest in any case, and the failures too unless webcam error logging is on. The
  simulator never sends the key.
- **A failing external sensor.** Only the fridge has one, in the firmware and in the simulator alike — `--fault`
  refuses any other type. What differs is where the fault comes from and where the interval lives. The simulator
  is told to have one rather than measuring it, and `--fault <kind>=<seconds>` makes the sensor flap on that
  period rather than stay broken, which is the shape that produced the flood. Its last-written times are ordinary
  memory: its `boot` command keeps them, as a soft reset does, while restarting the process clears them, as a
  power-on does. And it always has a clock, so it never reaches the case the firmware guards hardest — one that
  SNTP has not set yet, where the firmware writes nothing.
- **`test` outputs.** The server sends the fridge's seven names to every type. The controller, plug, light and
  cam ignore the command entirely, and the fan ignores the values. The simulator maps the names to its own keys
  and divides the three fan percentages by 100. The `/v1` contract describes the outputs of a test as partial and
  says an output left out keeps doing what it was doing; the firmware reads a missing field as zero, so it does
  not, and the server fills in the ones a caller left out.
- **Camera identity.** The firmware reports `webcam_did`, `webcam_uid`, `webcam_pwd`, `webcam_ip` and
  `webcam_url`. The simulator reports only `webcam_did`, so a simulated camera always takes the controller path
  and never exercises the direct one.
- **Who reports sockets.** Only the controller and the fridge call `wifiInitAuxCloudReporting`, so only they
  report a socket table and the three capability keys. The simulator reports both for every type it can be
  started as, which means a simulated `plug` or `light` announces sockets no real one of that type ever would.
- **The new control laws.** The firmware decides a humidifier from the dehumidifier's band and hysteresis and an
  exhaust from the cooling decision the mode computed, with the state each of them carries between passes. The
  simulator has neither a PID nor hysteresis and reads both off the sample it has just published — the same
  shape, not the same code. What a socket does in the field is what the firmware does.
- **The socket state column.** The firmware reports `on` or `off` only for a socket that answered its last
  command, and nothing for one it could not reach, because the socket is HTTP away. Nothing in the simulator can
  fail to answer, so its rows never report an unknown state after the first command.
- **The tunnel.** Firmware and server implement it fully in both directions; the simulator does not implement it
  at all and its `watch` command only prints what arrives.
- **`fwupdate` and `control/#`.** Subscribed by every device; published by neither the server nor the simulator.
- **Aux failure logs.** `message-aux-command-failed:<what>` has no entry in the server's category map, so those
  diary entries land under `device` alone.

The simulator is the cheapest way to exercise the cloud side of all of this — `./simulate-device.sh` registers,
claims and then speaks these same topics — but where this document and `scripts/simulate-device.mjs` differ, the
firmware is what a device in the field does.
