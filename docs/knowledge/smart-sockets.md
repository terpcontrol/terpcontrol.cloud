---
summary: How the controller and the fridge pair, identify, drive and report their Tasmota smart sockets, what the cloud and the app do with them, and the stand-alone smart socket (plug) - read before changing any of it
updated: 2026-10-08
source: Chris (light set-up rule, 2026-09-19); agents' PRs #23, #77, #82, #103, #104, #136, #145 and sessions 2026-05..10; checked against the code 2026-10-08
paths:
  - firmware/src/wifi.*
  - firmware/src/lanscan.*
  - firmware/src_hwtype/plug/**
  - shared-types/src/v1/socket-report.ts
  - server/src/modules/device-protocol/sockets.ts
  - server/src/modules/device-protocol/device-publisher.service.ts
  - webapp/src/screens/devices/**
---
# Smart sockets

Three things are called a smart socket here:

- **A paired socket** - a Tasmota plug that a controller or a fridge switches over HTTP on the home network. The
  controller has no switched output of its own besides its PWM light, so its heater, dehumidifier, CO2 valve and
  the rest are all sockets; a fridge drives its own outputs and its sockets follow them.
- The app calls a plug paired on the module itself (button, then Smart Sockets) a **Terp Control socket**; any
  other Tasmota plug (NOUS, Athom, a flashed Shelly) is added by its address from the app.
- **The stand-alone smart socket** - hardware type `plug`, a device of its own with a relay, a sensor and modes
  ([last section](#the-stand-alone-smart-socket-plug)).

The wire format - the `hardware-info:` socket report, the `socket_*` commands, every role and its control law,
the `PulseTime` per role and the timing constants - is in [device-protocol.md](../device-protocol.md) §6.3, §8.4,
§11.2 and §12. It is not repeated here.

## Where the code is

| What | Where |
| --- | --- |
| Table, pairing, control passes, commands, report | `firmware/src/wifi.cpp`, `wifi.h` |
| Finding a socket that moved | `firmware/src/lanscan.{h,cpp}` |
| What each output asks of its sockets, OTA flush, heater cut | `SmartSocketOutputStates` in `controller.cpp`, `fridge.cpp` |
| Limits shared by firmware, server and simulator | `shared-types/src/v1/socket-report.ts` |
| Decoding the report and capabilities; checks before publishing | `server/src/modules/device-protocol/sockets.ts`, `device-publisher.service.ts` |
| Routes | `server/src/modules/v1/device/devices.controller.ts` |
| App | `webapp/src/screens/devices/` (`DeviceList.tsx`, `SocketRow.tsx`, `LightOutputRow.tsx`, `sockets.ts`, `socket-form.ts`, `lights.ts`) |

## Pairing on the module

- Menu Smart Sockets: test socket, connect socket, find sockets, disconnect. *connect socket* lists open access
  points named `tasmota-<6 hex>-<4 hex>` or `cozylife-<6 hex>-<4 hex>`, joins the chosen one and asks for a role.
- The rest is Tasmota's HTTP command API (`/cm?cmnd=`) at the plug's own access-point address
  (`SMART_SOCKET_AP_IP`), in `provisionSmartSocket()`:
  1. one `Backlog`: `DeviceName` and `Hostname` `socket_<role>`, `PowerOnState 0`, the role's `PulseTime`,
     `WiFiTest2 <ssid>+<password>` (the module's own Wi-Fi), `WebPassword` set to a per-device web password the
     module keeps;
  2. `IPAddress1` - the plug's new address. An answer of the access point's own address means the plug has not
     joined yet, and the pairing fails (`ip lookup fail`) rather than store it;
  3. `Status 5` - the MAC, kept as the socket's hardware id;
  4. `Ap 2` - closes the plug's access point; the module rejoins its Wi-Fi and from then on logs in to the plug
     as `admin` with that password (`defaultSocketAuthQuery()`).
- Pairing a plug the table already knows (same hardware id, or same address on a row without one) updates that row
  and clears credentials entered by hand, because the pairing has just set the plug's web password.
- *disconnect* and `socket_remove` send `Reset 1` best effort - to a plug added by address too - so it reopens its
  pairing access point. *clear saved wifi* erases the whole table (asking first): the plugs joined the old network.
- **A socket added by address from the app gets no failsafe.** The module only stores the row; nothing configures
  the plug, so it has no `PulseTime` and keeps its own web password. Wrong credentials get 401, which looks exactly
  like a socket gone missing; a `socket_set` without `password` keeps the stored ones (device-protocol §8.4).
- Only Tasmota's API is supported. Stock Tuya/SmartLife firmware has no local counterpart to any step above (its
  pairing needs a token from Tuya's cloud, local control a per-device key issued there), and OpenBeken's Tasmota
  emulation has no `PulseTime`, `WiFiTest2`, `PowerOnState` or `DeviceName` (2026-09-15). Another plug firmware
  needs a pairing flow of its own and a rebuilt, re-validated failsafe before it may drive a heater. The Terp Cam
  pairing is modelled on this flow ([terp-cam.md](terp-cam.md)).

## The table

- Up to `MAX_SMART_SOCKETS = 32` rows, any number per role; every socket of a role gets the same target (two
  heaters, two lamps). The on-device menu lists rows as `3 heat 34CD` (position, role, tail of the hardware id).
- NVS: one key per row, `sk0` ... `sk31`, holding `{r: role, i: hardware id, a: address, u/p: own credentials,
  t/e: timer on/every seconds}`. Overrides are never stored.
- Rollback: the first socket of each of the five deployed roles (`dehumidifier`, `heater`, `light`,
  `secondary_light`, `co2`) is still mirrored into the pre-table keys (`sock_dehum`, `su_dehum`, `sp_dehum`, ...).
  Newer roles are not: they would share one fallback key, and a rollback would read one socket's address as another
  role's. A build that does not know a role drops its rows when it loads the table.
- Migration: the first boot of a table build adopts the per-role keys (`migrateLegacySmartSockets()`), skipping
  `(role, address)` pairs already in the table, so it is a no-op afterwards.
- **One row per physical socket** (since 2026-09-16): a hardware id and an address each belong to one row. A
  reachable socket is asked for its id every 10 minutes; a row whose address answers as another socket drops the
  address (`message-smart-socket-address-lost`) and is searched for by id; when a socket is found at an address,
  every other row holding that address gives it up. Before, re-pairing appended a duplicate row, and a row whose
  address had passed to another plug silently took over its identity and kept switching it.
- A row without an address survives a reboot when it knows its id; one with neither is dropped. A row an older
  build stored with an address over `SOCKET_ADDRESS_MAX_LEN = 40` characters works but reports an empty address.
- Known limitation: a row migrated from the per-role keys has no id until its first successful command and is
  invisible to the search until then; if its address changes first, it has to be entered again in the app. Letting
  the search adopt a host by its stored address was left out on purpose - it widens what the search trusts.

## Finding a socket that moved

After `SMART_SOCKET_FAILURES_BEFORE_SEARCH = 10` failed commands since it last answered, a socket with a known id
is searched for: `LanScan` walks the module's own /24 three hosts per tick, asks every host that accepts port 80
for `Status 5` with up to four credential sets, and moves the row to the address its id answers on
(`message-smart-socket-readdressed`). The sweep starts only while the display is idle, the setup portal is closed
and free heap is above `HTTP_MIN_FREE_HEAP`, and stops when the display wakes, the Wi-Fi drops or heap runs short; a
finished sweep is followed by 900 s of rest. *find sockets* runs it at once, blocking, and shows how many it found.
A socket outside the module's /24 is never found.

## Driving them

- The hardware type hands `wifiReportSmartSocketOutputs()` its states every control pass; `wifiTick()` turns them
  into commands. One pass spends at most 2 s on sockets: changed targets first, so the CO2 valve's pulse is not
  stretched, then the resends round-robin, so unreachable sockets cannot starve the control loop.
- What a socket is told, first match wins (`socketTarget()`): a heater socket is off while the air is more than
  5 °C above its target (`HEATER_OVERTEMP_MARGIN`); else a cloud override; else the row's timer (`pump`,
  `custom_timer`); else its role's target. A socket with no role and no override is not commanded at all, so its
  own `PulseTime`, if it has one, switches it off.
- **The heater cut beats an override**, which can hold a socket for up to a day; the override is kept and followed
  again once the air has cooled. Decided while merging master into the app rewrite (#104, 2026-10-03); Chris was
  asked to confirm it and has not yet.
- **CO2 on a controller**: the valve is a socket, and sub-second pulses do not survive HTTP, so it gets a fixed
  2 s pulse per 120 s window, timed in the 1 s control loop. The socket follows `co2_valve_open`, not
  `state.out_co2`: that is a runtime accumulator cleared only when a sample is buffered, and following it kept the
  socket on long after the pulse. `co2`, `pump` and `custom_timer` skip the 30 s send floor for the same reason.
- **Firmware update**: before the download every socket is told OFF at once, overrides dropped, bounded at 20 s
  ([device-protocol.md 10](../device-protocol.md#10-the-ota-path), step 5); a socket not reached switches itself off
  by `PulseTime`.
- **`PulseTime` is written only at pairing.** A socket given another role later keeps the failsafe of the role it
  was paired with; pair it again to change it. `socket_pulse` (`pulseSeconds` in the API) is that failsafe, not a
  minimum on-time, and must never narrow the hold durations the app offers - a screen once read 1800 s as a lamp's
  minimum on-time.

## Cloud and API

- Routes under `/v1/devices/{id}/sockets`: `GET` (the table and the capabilities), `PUT {slot}` or `PUT new`
  (`socket_set`; `new` adds a socket to the role), `DELETE {slot}`, `PUT`/`DELETE {slot}/override`,
  `POST {slot}/tests`. The pre-rewrite `POST /device/auxcommand` is gone.
- `socket_set` and overrides go only to `SOCKET_HOST_TYPES` (controller, fridge); any other type gets 409
  `not_for_this_device`. Removing and testing need a row the device reported.
- A socket is a view of `devices.state.hardware` and never stored twice.
- Capabilities (`decodeCapabilities()`): the roles are `''` plus what the build announced, or the five deployed
  roles for a build that announces nothing. `''` (unassigned) has to stay in that list - no build can announce it
  in a comma-separated list, and without it a socket could be given a role but never handed back (a 409 until
  2026-09-19).
- Overrides and timers go only to a build that announced `socket_override` / `socket_timer`; anything else is 409
  `capability_not_announced`. No build from before the socket firmware announces them: on the restored production
  account (2026-09-23) the socket test was the only socket command any device took.
- An override's countdown is read against `devices.state.socketsReportedAt`, when the table arrived, because the
  row carries the seconds left rather than a deadline. `devices.state.socketStateChangedAt.<slot>` is forgotten
  when the slot's hardware id changes or the slot goes - a slot outlives the plug in it.
- Demo viewers get sockets without address and hardware id (`demoSockets()`).

## In the app

- **Lights** (Chris, 2026-09-19): a lamp on the controller's own PWM output and light sockets switched
  independently must both be possible and obvious. The Lights section of a device shows its own output first
  (brightness ceiling, hold on/off/auto), then each `light`/`secondary_light` socket as a switch numbered within its
  role ("Light 1", "Light 2"); every other socket is under Smart sockets.
- Roles offered for pairing and editing (`OFFERED_ROLES` in `socket-form.ts`): heater, dehumidifier, humidifier,
  exhaust, co2, light, secondary_light, pump, custom_timer - each only where the build announced it.
  `circulation`, `fan` and `manual` are in the firmware and the contract but not offered until they have been
  tried in a real tent. A socket being edited keeps its own role on offer.
- Holds: 15 min, 1 h (a plain tap), 4 h, 8 h, 24 h. Why a switch is unavailable is said once per list, offline
  first, then that the build takes no override.
- A timed socket's state column cannot show short pulses: the table is re-reported at most every 30 s, so a 30 s
  on-pulse may never be seen as on. The timer column says what it repeats.

## Before new roles or socket firmware go out

- Run one tent with a real socket per new role for a day or two and watch it. A wrong rule on a real tent is worse
  than no role: a humidifier that never stops soaks a room, a pump that misreads its timer waters every six
  minutes. `/firmware-check` only proves that a build boots and takes updates.
- Not proven on hardware when the new roles landed (2026-09-19, builds and simulator only): a plug taking an
  override promptly, `PulseTime` of the seven new roles, the grown report fitting the 384-byte log buffer, the timer
  across the tick wrap, humidifier and exhaust against real sensors, old builds in the field staying untouched.

## Open

Both found reading the code on 2026-10-08, neither seen on a device:

- A fridge reports no socket targets in test mode or under direct MQTT control, so every socket keeps its last
  state and is re-sent ([firmware.md](firmware.md#safety-stops-and-failsafe); the failsafe reports them off since
  #145).
- A fridge's `co2` socket follows `state.out_co2 > 0`, the accumulator the controller stopped using. It is cleared
  with every buffered sample (5 s), but not while the sample buffer is full (no MQTT for about ten minutes), so the
  socket can stay on and be re-sent ON every 60 s.

## The stand-alone smart socket (`plug`)

- A device of its own (`firmware/src_hwtype/plug/`): a relay, a climate sensor, and the modes `off`, `heater`,
  `cooler`, `humidify`, `dehumidify`, `co2` (`const`, or `periodic` windows) and `timer`, with switch points by day
  and optionally by night; its document keys are in [device-protocol.md](../device-protocol.md) §7.1. It has no
  socket table and takes no `socket_*` command; it can pair a Terp Cam.
- Protections - off above or below a temperature with a hysteresis, least on and off times in seconds - sit between
  every regulating mode and the relay (`checkLimits()`). Outside its temperatures the relay is off at once,
  whatever a least time says; least times only hold back a switch the mode asks for; all start disabled; the
  `timer` mode is not held to them. Until 2026-10-04 the firmware read them and never applied them. A build that
  keeps them reports `hardware-info:protections=on`, and the app greys them out for any other.
- The app sets it by named settings: `PATCH /v1/devices/{id}/configuration` with `set`; the names and ranges are
  `PLUG` in `shared-types/src/v1/configuration-fields.ts`.
- **CO2 and an AIR fan**: `PUT /v1/devices/{id}/co2-fan` (`manage` on both devices) names the fan a socket slows
  while it doses CO2; only `periodic` dosing slows one. Neither firmware knows the other: the server keeps the fan's
  `co2inject` section in step with the socket's document on every write of it, also one from the socket's own menu,
  and keeps the section through the fan's own uploads ([device-protocol.md](../device-protocol.md) §7, §7.1;
  `followCo2Fan()`). A fan that is gone does not fail the socket's write.
