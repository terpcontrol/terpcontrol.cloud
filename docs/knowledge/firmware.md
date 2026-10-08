---
summary: Working on the device firmware or on what the server does with it - build, flash, serial log, OTA and update channels, memory, NVS and RTC limits, connection-loss reboots, safety stops, known gaps
updated: 2026-10-08
source: Chris (decisions 2026-07..10); agent sessions and PR descriptions 2026-05..10; commit history; checked against the code on 2026-10-08
paths:
  - firmware/**
  - fw-buildcontainer/**
  - build-fw.sh
  - provision-fw.sh
  - log-device.sh
  - server/src/modules/v1/fleet/**
---
# Firmware

What the code does not say about the ESP32 firmware in `firmware/`. Not repeated here: the wire - topics, payloads,
the OTA path, timing and limits - in [device-protocol.md](../device-protocol.md); rollout commands and the online
check in [AGENTS.md](../../AGENTS.md) (Firmware); the device simulator in [CLAUDE.md](../../CLAUDE.md); MQTTS setup
and certificate rotation in [README.md](../../README.md) (MQTT transport); the release workflows in
[ci-and-release.md](ci-and-release.md); how fridge and controller regulate in
[firmware-regulation.md](firmware-regulation.md); the camera in [terp-cam.md](terp-cam.md); smart sockets in
[smart-sockets.md](smart-sockets.md).

## Layout and hardware types

- `src/` is shared by every type: `main.cpp` (loop, watchdogs), `fridgecloud.cpp` (MQTT and HTTP client), `wifi.cpp`
  (WiFi, portal, smart sockets, camera pairing), `terpcam.cpp` (camera relay), `settings.cpp` (NVS),
  `rebootwatchdog.cpp`. `src_hwtype/<type>/` holds a type's regulation, menu and settings.
- `lib/EspMQTTClient` is vendored with a local fix - `subscribe()` with a topic callback finds its slot by topic
  instead of overwriting the last one, which after a reconnect sent messages to the wrong handler. Keep it.
- Released types: `controller`, `fridge`, `plug`, `fan` (AIR), `light`. `light` and `fan` stay in every build and
  release, because devices in the field keep getting updates (Chris, 2026-08-23). `cam` (board `esp32cam`) and `dummy`
  are built only when named; the `<type>-test` environments (`src_hwtype/<type>_test`) are manufacturing test firmwares.
- The dryer type is gone (Chris, 2026-10-02): sources, build environment and class. Migration `020-retired-dryers`
  deletes the dryers a database still holds; a dryer that registers is refused.
- Every released type runs on `heltec_wifi_lora_32_V2`: a plain ESP32 without PSRAM, 8 MB flash, laid out by
  `fg_partitions.csv` - `nvs` 16 KB at 0x9000, `factory`, `ota_0`, `ota_1` 2 MB each, `nvs_ro` (the provisioned
  identity) at 0x610000.
- A `headless` type (QT Py ESP32-S3, set up through the portal) exists only on the open PR #89, branch
  `headless-hwtype`; its ESP32-S3 pitfalls are listed there.

## Building

- `build-fw.sh` copies `firmware/` into the Docker volume `fg2_firmware` and replaces the placeholder
  `#API_URL_EXTERNAL#` (`DEFAULT_API_URL` in `wifi.cpp`, what the change-server menu offers) only in that copy. Then
  `firmware/dev-build.sh` runs `pio` and fails when `firmware.bin` exceeds the 2 MiB OTA slot or lacks the firmware id.
- Compile on the container's own filesystem: on a case-insensitive macOS volume `#include <WiFi.h>` resolves to
  `src/wifi.h` and nothing that uses WiFi compiles. Building any other way also needs `src/mqtt_ca.gen.h` (written by
  `dev-build.sh`, gitignored) and must never commit `wifi.cpp` with the URL filled in.
- What `FW_NO_UPLOAD`, `FW_VERSION_ID`, `FW_UPLOAD_VERSION` and `FW_SET_ALPHA` do with a build is tabled in
  [ci-and-release.md](ci-and-release.md#firmware-releases). Mind two rows: a plain `./build-fw.sh` puts the build on
  the **stable and beta** channels of its class, and a compile check stays off the server only with `FW_VERSION_ID`
  set - without it `fgcli.py create-fw` registers a build even when nothing is uploaded.
- A firmware change is tried on the development devices before its merge with `/firmware-check`
  ([testing-real-devices-and-data.md](testing-real-devices-and-data.md#firmware-on-the-development-devices)): two
  OTA cycles prove that the build boots and still accepts the next update.
- With `MQTTS_CA_PEM_B64` in `.env` the build bakes the CA in and points devices at `MQTTS_PORT_EXTERNAL`; provisioned
  NVS values (`mqtt_tls`, `mqtt_ca_cert`) win, so devices move to MQTTS with their next OTA. Devices trust the CA,
  never the broker's certificate: the first design baked in the server certificate, and rotating it took the test
  fleet offline (`unknown_ca`) with no remote fix, since updates travel over MQTT. A new CA needs a rollout first.
- `platformio.ini` uses `build_src_filter` (`src_filter` is deprecated). `-fno-rtti` stays out of `build_flags`: the
  framework passes it to every C++ file, and `build_flags` also reach the C compiler, which warned once per file.
- Flash headroom, October 2026: `fridge` ~1.42 MB, 67 % of the OTA slot; `fan` 65 %, `plug` 66 %. Compare sizes only
  between builds made back to back with the same toolchain install.
- The device's web page (AP portal and phone server form) is `html/index.html`; after editing it run
  `python3 firmware/scripts/html-compress.py` and commit the regenerated `src/html_compressed/index.html.h`.

## Flashing and serial access

- `./provision-fw.sh <type>` flashes factory-fresh hardware over USB with the class's **stable** build, downloaded
  from the server, plus an NVS image with the identity `POST /v1/admin/devices/provisioned` creates (the broker
  password comes back in plaintext this once; the server keeps the hash). It prints the serial number and writes the
  label; it compiles nothing.
- USB passthrough for `provision-fw.sh` and `log-device.sh`: `DOCKER_USB_MOUNTS` (`.env.sample`) or a gitignored
  `init-usb.local.sh`.
- `./log-device.sh` streams the serial log at 115200 baud (`pio device monitor` defaults to 9600 and garbles it). It
  does not decode backtraces: that takes `pio device monitor -f esp32_exception_decoder` in `firmware/` with the ELF
  of the very build the device runs.
- The boot log prints the device's MQTT username and password, and an NVS dump (`esptool.py read_flash 0x9000
  0x4000`) holds the WiFi password and other secrets: keep both out of issues, pull requests and the repository.
- A crash without a serial line: every boot writes `message-device-booted:<reason>` to the diary. `TASK_WDT` -
  something blocked for 60 s; `PANIC` - a real crash, get a backtrace; `BROWNOUT` - the supply sags, which fits a
  fault on one module only; `REMOTE` - the cloud asked ([device-protocol.md 8.1](../device-protocol.md#81-reboot)).

## Memory

- The binding limit is heap **fragmentation**, not free heap: with ~158 KB free the largest block was ~94 KB, and
  after ~16 h of uptime it sits near 37 KB. Chris (2026-08-20): free heap is about 40 KB after some uptime, and a new
  feature must not take that away.
- So: no heap allocation on per-tick paths (the status document is a `StaticJsonDocument` sized by a
  `JSON_OBJECT_SIZE()` sum - grow it with every field you add); constant data in flash; refuse oversized work rather
  than grow a buffer; a large transient buffer is `malloc`'d per use, freed on every exit path and guarded by a
  largest-free-block check that skips the job with a log line. A 64 KB static buffer did not even link; a 48 KB one
  took most of the spare heap.
- Opening and closing UDP sockets repeatedly fragments the heap for good (largest block 94,196 to 77,812 bytes).
- `setup()` releases the Bluetooth controller's memory (~60 KB). `httpGet()` reuses one static `HTTPClient` without
  keep-alive (socket commands alternate between hosts) and skips requests below `HTTP_MIN_FREE_HEAP` (`wifi.h`). The
  health check in `main.cpp` counts each minute below that, or with the largest block under 25,000 bytes, and
  reboots after three in a row - the same threshold, so skipped socket commands end in a reboot rather than in
  uncontrolled outputs. LWIP holds closed sockets in TIME_WAIT for ~120 s, out of the firmware's reach.
- Reference: on a fridge the camera relay over TLS leaves ~142 KB free before the handshake, never under 60-72 KB
  (2026-09-30).

## NVS and RTC memory

- `nvs` (namespace `settings`) holds the WiFi credentials, the custom-MQTT login, one key per smart socket (`sk<n>`),
  the camera keys, the reboot-watchdog values and the settings document (`config`).
- Never fill it. `SettingsManager::setStr()` logs a failed write instead of aborting; the abort was a panic loop that
  ended with `nvs_flash_init()` finding no free page and `SettingsManager` erasing the partition, WiFi credentials and
  sockets included. Code that adds entries checks `fg::settings().freeEntries()` first (a new socket leaves 24 free).
- `RTC_DATA_ATTR` does **not** survive a reboot here: the bootloader reloads it on every reset except a wake from
  deep sleep, and these devices never sleep. State that has to outlive a panic, a watchdog or `ESP.restart()` uses
  `RTC_NOINIT_ATTR` behind a magic word, because that memory is garbage after power-on: `g_remote_reboot` in
  `fridgecloud.cpp`, and the sensor-fault stamps in `fridge.cpp`, which also start afresh on power-on and brownout.

## Time

- The FreeRTOS tick count wraps after ~49.7 days. Test a deadline only with `fg::tickPassed()` (`automation.h`,
  valid up to ~24 days ahead) or keep start and duration as `isPaused()` does; `now - start` is wrap-safe. A deadline
  compared with `<` once kept a fridge in maintenance for two days and could hold the CO2 valve open.
- Devices run on UTC (`gmtime`); only the app converts time zones. A window across 00:00 UTC is the firmware's to
  handle: the plug timer is on while `t >= ontime || t < end - 24 h`, and its menu allows up to 1080 min.
- The clock comes from SNTP; the controller also has an MCP7940 battery RTC and starts from it.

## Connection and recovery

- Task watchdog 60 s (`main.cpp`): one MQTT publish can block ~10 s in `WiFiClient` retries. Feed it between
  blocking calls.
- Three failed publishes force an MQTT reconnect (`notePublishFailure()`). WiFi is left alone on purpose: dropping
  healthy WiFi to free a wedged MQTT socket only caused churn on every broker hiccup. WiFi reconnects by itself and
  restarts the station after 120 s; `EspMQTTClient`'s own recovery never runs here (it is built without WiFi details).
- `connect()` sets the MQTT packet size on every (re)connect; while it set 1024 there, every tunnel message over
  1 KB was dropped without a word.
- Connection-loss reboots are set on the device only - menu `Conn. Loss Reboot` under the WiFi settings of every type
  (`rebootwatchdog.cpp`, NVS keys `rbt_*`) - and kept out of the cloud-synced settings at Chris's request (2026-07).
  Unset, they reboot after 15 min without the cloud whatever the light, and once per 24 h while the outage lasts but
  only while the light is off. The daily one exists because a broker port that is open but never answers can exhaust
  LWIP's sockets (errno 11) until only a reboot helps; it waits for darkness so a photoperiod is never cut
  (`isLightOn()`: the light output, a plug's relay; never on fan or cam - a 24 h light means no daily reboot) and
  skips devices without WiFi credentials.
- **Known gap (code reading, 2026-10-08):** the flag meant to make the 15-minute reboot happen once,
  `g_connection_reboot` in `main.cpp`, is `RTC_DATA_ATTR`, so it is false again after the `ESP.restart()` it guards:
  during a lasting outage that reboot repeats every delay period, and a device without WiFi credentials (not
  excluded from it) reboots every 15 min. The fix is `RTC_NOINIT_ATTR` with a magic word, as above.
- The tunnel (RTSP cameras and alarm webhooks on the grower's network) moves data only while the display is idle,
  30 s after the last knob input, and the server closes a connection after 30 s without traffic: using the knob can
  cost an open stream ([device-protocol.md 9.2](../device-protocol.md#92-the-tunnel)).
- The ESP32 resends a lost TCP segment after ~3 s and again ~6 s later: server timeouts on a stream relayed through
  a device must allow stalls that long.
- Heavy I/O runs in a task of its own, never on the loop task: the old camera capture there stalled regulation for
  30 s and more. Inbound UDP, power-save and the relay task: [terp-cam.md](terp-cam.md).
- Not reported to the cloud at all: WiFi signal strength (the device's own dashboard draws it as bars, the WiFi
  menu's `Show Wifi Status` as a figure, the serial `[health]` line logs it), an "update available" state, and that
  an override holds the light output (socket rows do report theirs).

## Settings documents

- `loadSettings()` is the only way settings enter a type - the NVS restore at boot and every document from MQTT -
  and it starts from the compile-time defaults, so a partial document resets every key it leaves out (work mode, day
  and night, dehumidifier tuning, ramps) and is stored as received: the cloud may only send documents built on the
  device's own ([device-protocol.md 7](../device-protocol.md#7-the-configuration-document)). Being the only way in,
  it is where the controller maps the legacy work mode `full` to `small`.
- Each type's `serializeSettings()` is what a menu change publishes and what every `fetch` carries since #141
  ([device-protocol.md 5.3](../device-protocol.md#53-fetch--what-a-device-asks-for-when-it-connects)).

## Safety stops and failsafe

- Heater: PID by day and by night. The hysteresis rework (#52) was reverted in #57 (2026-08-20) because its settings
  were too complicated and did not work as expected; do not bring it back unasked.
- Fridge and controller force the heater off more than `HEATER_OVERTEMP_MARGIN` (5 °C) above the active target, since
  a heater socket switches fully on for any PID output above zero; the cut beats a manual override on heater sockets
  ([smart-sockets.md](smart-sockets.md)). The fridge ends every heater pulse from an `esp_timer` one-shot, because the
  loop task can block for seconds on a bad uplink (a fridge losing its connection heated to 34 °C).
- Before an OTA download, controller and fridge zero their outputs and push OFF to every socket synchronously.
  `wifiForceAllSmartSocketsOff()` loads the socket table first: an update that arrived before anything had loaded it
  switched nothing off.
- The controller has no actuator but the light: heater, dehumidifier and CO2 are smart sockets since July 2026 (no
  relay pins, fans, test mode, direct control or custom MQTT). Its failsafe zeroes heater, dehumidifier, CO2 and light
  after 10 consecutive sensor failures (a failed read, an SCD tick without data, a failed re-init without a sensor).
- The fridge takes the SCD4x readings once its SHT has failed 10 reads; its failsafe (heater, compressor, CO2, light)
  trips when the SCD4x fails 10 times.
- **Known gap (code reading, 2026-10-08):** both types report their socket targets (`wifiReportSmartSocketOutputs()`)
  only outside the failsafe branch, so in failsafe every socket keeps the state last reported and is re-sent every
  minute - on a controller that includes the heater. A fridge skips the report in test mode and under direct MQTT
  control as well.

## OTA and update channels

- The OTA path is [device-protocol.md 10](../device-protocol.md#10-the-ota-path). `message-device-firmware-update` is
  queued in the `firmware` handler, and the download runs inside that same handler, so (code reading) the line is
  published only when an attempt returns without rebooting: an "Update asked for" line in the diary is an attempt
  that did not complete, and repeats are the clearest sign an update is not landing. Whether a build took is the
  firmware id the device reports afterwards.
- Rollout (`server/src/modules/v1/fleet/firmware-rollout.service.ts`): a sweep every 10 s per class and channel
  (`stable`, `beta`, `alpha`; never `manual`), at most `concurrentUpdates` devices at once, none once `maxFailures`
  updates have failed, an update failing after 10 min. `rollout.paused` holds a class; `rollout.percent` stages it by
  a hash of the device id, so a device stays inside or outside the share. A device that owes an update is told 30 s
  after it is seen, and again with the delay doubling up to 24 h.
- Channels (`firmware.channel` of a device): a new device starts on `stable`, pinned to the build it registers with
  (Chris, 2026-10-02); registering again re-pins the class's stable build and keeps the channel. A `manual` device
  gets exactly the build it is pinned to: a grower may pick any build that was ever stable, anything newer than the
  newest of those, and the running and targeted builds (`GET /v1/devices/{id}/firmwares`, `PATCH /v1/devices/{id}`;
  Chris, 2026-10-06); an administrator any build. Migration `005-devices` mapped the old fields
  (`cloudSettings.firmwareChannel`, else auto-update on to `stable`, else `manual`).
- A build is not deleted while a channel of a class points at it (409 `firmware_in_use`).
- The firmware id is a uuid, not an orderable version: gate a new feature on a capability the device announces, never
  on its version ([device-protocol.md 12](../device-protocol.md#12-extending-it-safely)).

## Device UI

- OLED 128x64, 6x8 font, 21 columns; select-menu labels start at x = 20, so they get 18 characters. A screen sets its
  own idle blank-out with `MenuItem::idleTicks()` (default 30 s); screens that send somebody off with a phone stay lit
  for 3 min.
- The phone form behind `change server` - `use mobile phone` is unauthenticated (whoever reaches it can point the
  device at any server, and so any firmware), so it listens only while that screen is up, at most 10 min, and refuses
  the POST otherwise. The new server outlives a reboot without being stored: registering ends in an OTA of that
  server's build ([device-protocol.md 3.1](../device-protocol.md#31-post-deviceregister)).
- Network names are trimmed, passwords never (one may end in a space; the page warns instead). The setup AP is
  `TERP_` and six characters from 0-9 and K-P, not hex (`randomSsid()` adds `'A'` to values over 9), the DHCP
  hostname `terpcontrol`; `custom_mqtt_id` still defaults to `plantalytix`, because a grower's own broker may name it
  in an ACL.
