---
summary: When a test needs real hardware or real data - /firmware-check beyond its skill and getting builds onto devices, taking over and driving the development devices, the real Terp Cam, restoring and testing on a copy of production data without anything leaving it, verification passes
updated: 2026-10-08
source: Chris (instructions 2026-08-25..2026-10-05, dated inline); agents' findings in sessions and PRs 2026-08..2026-10 (#79-#141); codebase cleanup (2026-10-08); checked against the code 2026-10-08
paths:
  - .claude/skills/firmware-check/**
  - build-fw.sh
  - restore.sh
  - backup.sh
  - migrate-check.sh
---
# Testing with real devices and real data

Everyday testing - suites, simulator, own stacks, browser checks - is in [testing.md](testing.md). Rollouts are in
[AGENTS.md](../../AGENTS.md#firmware), the release switches of `build-fw.sh` in
[ci-and-release.md](ci-and-release.md#firmware-releases), restores and migrations in
[server/src/migrations/README.md](../../server/src/migrations/README.md).

## Firmware on the development devices
- `/firmware-check` ([skill](../../.claude/skills/firmware-check/SKILL.md)) is a firmware PR's hardware test. Beyond it:
  - Chris scopes it in words (2026-08-25): `/firmware-check #75 without controller`, `#77 run only first cycle`. The
    PR comment then names each type left out as not verified on hardware (shared code such as `wifi.cpp` or the
    portal page reaches all five); after one cycle the standard comment is not posted.
  - A PR that touches the server too needs it rebuilt from the merged tree (`docker compose up -d --build server`)
    before the firmware is built: the skill's plain `up -d` does not rebuild an image.
  - `run-cycle.sh` reads `.env` itself, `verify.py` does not: export `API_URL_EXTERNAL` and `AGENT_TESTING_*` or it
    exits 2 at once. It runs up to 15 minutes, past a 10-minute tool timeout: run it in the background and do not
    pipe it into `tail` when its exit status matters. It signs in on every 15 s poll, against the sign-in limit.
  - A timeout on a device that stays online, with no update attempt in its diary, is a device never offered the
    build, not a firmware defect: its `firmware.channel` is `manual`, the class's `rollout` is paused or below 100
    percent, or earlier failures reached the class's `maxFailures` (`firmware-rollout.service.ts`). While it flashes
    and reboots a device is offline for up to about 5 minutes; that is normal.
  - It catches ESP32-only compile errors the desktop build misses (a `const` method calling `WiFiClient::connected()`).
- Compile-only builds are in [AGENTS.md](../../AGENTS.md#firmware). Build every type that compiles a changed shared
  file; one type compiling proves nothing about the others. In a `while read` loop give `build-fw.sh` `</dev/null`:
  its `docker run -i` eats the loop's stdin and silently skips the remaining iterations.
- **A device fetches updates from the API it was built against** (`API_URL_EXTERNAL` at build time, or a server set
  on the device) and dials the MQTT host and port it was built with. A rollout from a stack on other ports never
  lands; OTA from a test stack needs a build against it, or the stack holding the main stack's ports, API included.
  A port forward round it was refused as traffic redirection - do not try.
- **One test build on one device:** as admin, `PATCH /v1/devices/{id}` with `firmware: {channel: "manual", targetId}`
  (rollouts skip `manual`). The server tells the device about 30 s after it next reports; one that has stopped
  reporting status never hears it - a reboot command brings it back.
- **The release path on a local stack:** `fgcli.py` signs in with `AUTOMATION_TOKEN`; run by hand in the build
  container it needs `host.docker.internal`, not `localhost`. Check with `fgcli.py list-fw` and
  `GET /device/firmware/<id>/firmware.bin`; `DELETE /v1/admin/firmwares/{id}` removes a throwaway build.
- Reading a configuration back from the cloud proves nothing about the device: its `onConfig` stores the payload as
  sent. Confirm on the device (display menu, behaviour), and test a capped setting below its cap.
- Heater control on the fridge also needs its duty cycle checked with the broker unreachable (drop its packets): the
  fault #109 fixed shows only while the loop task blocks on a bad uplink. #109-#111 were merged on compile checks only.
- The device's own pages without hardware: serve the real `INDEX_HTML_GZ`
  (`firmware/src/html_compressed/index.html.h`) behind a mock of `/`, `/server`, `/scan` and `/config` and drive it
  in Chromium (SSIDs with `'` or `<script>`, 360 px, light and dark). Gzip is only approximated, so roll it out to a
  device before merging.

## The development devices
Chris's development devices (one of each type, the fridge with a Terp Cam) talk to whichever local stack holds the
ports their firmware dials. They are there to be tested and broken (Chris, 2026-09-23): a verification may drive the
write paths - targets, presets, plans, alarms, maintenance, output forcing, socket pairing, camera test images,
reboot, firmware update, renaming and moving. The first pass that did found a blocker six read-only passes had missed.
- **Taking them over:** ask Chris first. Stop the stack that holds their ports with `./stop.sh` (not `down`: its volumes
  survive), bring yours up on those MQTT ports with an `API_URL_EXTERNAL` the devices reach (the camera relay address
  derives from it) and wait - they reconnect on their own backoff within minutes. Give them back the same way.
- **One agent per device:** two agents commanding one device produce nonsense that looks exactly like a defect.
  Parallel across devices, serial within one (its findings verified one at a time); read-only agents are told that
  state will change under them.
- **Snapshot and put back** every device, camera, space and grow; diff field by field afterwards (`lastSeenAt`,
  `lastStillAt` and `lastError` move on their own). Probe records get a recognisable name and are deleted. Firmware
  update and reboot go to one device, once, with the firmware id noted before and after; anything that would need
  physical re-pairing, such as a factory reset, is described, not done.
- **On any deployed environment, check whose device it is first:** a change there (a grow plan started) reaches the
  hardware at once (Chris, 2026-10-05).

## The real Terp Cam
- Leave it exactly as found (Chris, 2026-09-08): read a setting before changing it, restore it and read it back -
  blind probing has cost a camera reboot. Never factory-reset it: that unpairs it and drops it to its setup access
  point. LAN access from the test machine is for diagnostics, never for what ships ([rules](terp-cam.md#rules-chris)).
- Do the cheapest decisive check first: a LAN-direct probe answers a protocol question in minutes, no flashing. The
  probe scripts are not kept in this repository; internal notes on them exist.
- Measuring capture success: no probe sessions of your own meanwhile (they take the camera's ~4 session slots); press
  the real test button (`POST /v1/cameras/{id}/test-captures`) at production spacing, e.g. 20 times 30 s apart,
  signing in per call. After changing the light wait 60-75 s (the IR switch has hysteresis); a lit scene makes the
  larger keyframes and is the real test of fragment loss. The bar for relay changes is in [terp-cam.md](terp-cam.md).

## Copies of production data
Real data has shapes the simulator never makes - most devices never named, cameras behind devices offline for days,
places holding only system lines, years of old diary text - and rounds green on simulated data still had dozens of
defects on it. A shape found this way goes into the legacy fixture, which also carries what simulated devices never
write (grows, plans, alarms).
- **It is real people's data.** Backups live outside every repository (where: the developer's `CLAUDE.local.md`);
  throwaway copies are deleted when done.
- **Use the focused backup** (Chris, 2026-09-24): a trimmed copy of a few accounts in the old shape that restores and
  migrates in about a minute. The full backup takes about half an hour; keep it for what the focused one cannot answer.
  A new one is a restored copy with most of it deleted, saved with `./stop.sh server` and `./backup.sh`
  (`BACKUP_FILENAME` names the `.mongodump`/`.influxdump` pair; `mongo` or `influx` as argument saves one half).
- **Nothing may leave the copy.** Its server acts on real accounts the moment it boots: the first one at once tried
  to mail a plan step to a grower, stopped only by SMTP pointing nowhere. Leave `SMTP_SERVER`, `VAPID_*` and
  `TELEGRAM_BOT_TOKEN` empty in its `.env`; webhooks live in the data and have no switch, so they come out of the
  data before the first boot.
- **A stack of its own** (Chris, 2026-09-19), restored onto empty databases with no server running. The steps - the
  database names the restore needs, compose name and ports, the restore, taking the webhooks out, the migration - are
  the runbook [Testing against a copy of production data](../runbooks/test-against-a-production-backup.md).
- `restore.sh` ends with one line `RESTORE SUCCESSUL: <name>` (sic): `until grep -q 'RESTORE SUCCESSUL' <log>`. A
  waiter expecting two such lines kept a finished restore "running" for hours.
- **The migration is done when the database says so:** every step in `server/src/migrations/steps/` recorded in
  `migrations`, and the invariants the change cares about hold (for the rewrite: no UUID-named spaces, every camera
  dated, no English headings kept, no diary line with credentials). Log waiters matched the previous boot's last
  line, and real devices' MQTT auth traffic pushed the migration lines out of the tail.
- Every boot creates the `ADMINUSER_*` account or resets its password and admin flag; after a restore made while the
  server ran, the testing credentials answer 401 until it restarts.
- The testing account is one account; database totals are install-wide. Brief verifiers with what it owns, or they
  report missing data. What it lacks (plants, share links, Telegram, Premium) rests on the suites.
- **Never a second API on the copy's databases:** it would ingest twice and reach the devices. Check webapp changes
  with a dev server against the running API (`VITE_API_URL=<its API> npm start`), server changes with the suites,
  and rebuild the copy's server only from the merged branch.
- Rehearsing migration steps on a throwaway MongoDB copy: leave out `imagedata.chunks` (the bulk; step 012 reads
  `imagedata.files` only) and the firmware binaries. `--dry-run` writes nothing, so the steps that read what earlier
  steps build find nothing there; run the chain for real on the copy, then delete it.
- A database a newer server migrated cannot serve an older one: every device fails MQTT auth with "device not
  found". Older code gets a backup restored into its own stack.

## Verification passes
How the rewrite was verified (Chris, 2026-09-22): restore, migrate, drive the app as the testing account for bugs,
completeness and consistency, fix what is found in the same pass, and start again from a fresh restore until a pass is
clean. One broad driving agent plus lenses (truth, time, empty states, consistency, access, failure, craft); each
finding goes to an adversarial verifier that refutes what it cannot reproduce, and confirmed ones to fix agents with
disjoint files. Verifiers echo the finding's title (pairing by index once filed every verdict under the wrong
finding), get the account's real inventory, and are told that finding little is expected and inventing is not. No
account-wide actions such as "Sign every other browser out" - one agent pressed it on a copy.
