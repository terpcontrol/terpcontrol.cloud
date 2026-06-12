---
name: firmware-check
description: Verify that firmware changes on a branch or PR boot cleanly and accept further updates. Builds firmware twice with unique version tags, rolls each out to the connected devices, waits for every device to come back online running the expected firmware id, and comments on the PR. With no argument, iterates over every open PR. Trigger via `/firmware-check [<pr-number>|<branch>]`.
---

# firmware-check

## Purpose

When a firmware modification is proposed (typically through Claude on the web), it needs to be verified against real hardware before merge. A successful check proves two things:

1. The new firmware **boots without problems** — every device comes back online.
2. The firmware **still accepts further updates** — a second OTA on top of the first one succeeds too.

The cheapest way to prove both is to build and roll out the firmware twice with two distinct version tags, then verify after each cycle that every device's `hardwareInfo.firmware_version` matches the firmware id that was just built.

## Argument handling

The skill takes an optional argument:

- `/firmware-check` → check **every open PR** (`gh pr list --state open --json number,headRefName,isDraft`). Skip drafts unless the user explicitly says otherwise. Comment on each PR after its own cycle finishes — do **not** wait for the whole batch before commenting.
- `/firmware-check <N>` → check that one PR. Comment on it when done.
- `/firmware-check <branch-name>` → check the local/remote branch directly (no merge step, no PR comment).

Capture the original branch first (`git rev-parse --abbrev-ref HEAD`) and restore it at the very end. Always work on a clean tree — if the tree is dirty, ask the user before stashing or aborting.

### What gets tested for a PR: the post-merge state

PR branches drift; what matters is what would land on master after merge, not the raw PR tip. For each PR:

```bash
git fetch origin master
git fetch origin "pull/<N>/head:fw-check-pr<N>"   # or `gh pr checkout <N>`
git checkout -B fw-check-merge-<N> origin/master
git merge --no-ff --no-edit fw-check-pr<N>
```

- If the merge **conflicts**, abort it (`git merge --abort`), skip this PR, and tell the user. Do **not** comment on the PR.
- Build and test from this merged state. Throw the temp branches away when done (`git branch -D fw-check-merge-<N> fw-check-pr<N>`).
- For the bare-branch form (`/firmware-check <branch-name>`), skip the merge entirely — just check out the branch and test it as-is.

## Preflight — do this once at the start

Skip the per-PR loop if any preflight check fails; the whole point of preflight is that any later failure is attributable to the new firmware, not to the environment.

1. **Stack is up.** `docker compose ps` must show `server`, `mongodb`, `rabbitmq`, `webapp`, `influxdb` as `Up`. If anything is down, ask before `docker compose up -d`.
2. **`.env` is loaded.** Read `API_URL_EXTERNAL`, `AUTOMATION_TOKEN`, `AGENT_TESTING_USERNAME`, `AGENT_TESTING_PASSWORD` from `.env`. The default user account is `extr3m0@email.de` (these are the values in `.env` for the test fleet).
3. **Devices are online.** Log in with the user credentials, `GET /device`, and confirm every device has `lastseen` within the last 10 min (`ONLINE_TIMEOUT`). Treat absent `hardwareInfo.firmware_version` as offline. If any device is offline, stop and tell the user which one — don't roll out to a fleet that already has an unknown problem.
4. **Build container is present.** `docker images | grep plantalytix-buildcontainer` should show a row; if not, the first `build-fw.sh` will rebuild it (slower but fine).

## One check cycle

A "check cycle" = build + rollout + verify. Per PR/branch, run two cycles back-to-back with different version tags.

```
TAG1=check-pr<N>-<unix-ts>-1       # or check-<branch-slug>-<ts>-1 if no PR
TAG2=check-pr<N>-<unix-ts>-2
```

The unique tag is what lets you tell the test firmwares apart in `/device/firmware` listings later; it isn't load-bearing for the test itself.

### Steps for one cycle

Hardware list: by default build `fridge controller plug fan light` (the default in `build-fw.sh`). Per `AGENTS.md`, run `fridge` first if you are scoping down. Skip `dryer`.

1. **Pre-create the firmware record per hardware type** so the id is known up-front:
   ```bash
   ADMIN=$(curl -s -X POST "$API_URL_EXTERNAL/tokenlogin" \
     -H 'Content-Type: application/json' \
     -d "{\"token\":\"$AUTOMATION_TOKEN\"}" | jq -r .userToken.token)
   FW_ID=$(curl -s -X POST "$API_URL_EXTERNAL/device/firmware" \
     -H "Authorization: Bearer $ADMIN" -H 'Content-Type: application/json' \
     -d "{\"name\":\"$HW\",\"version\":\"$TAG\"}" | jq -r .firmware_id)
   ```
   `name` must be the hardware type (`fridge`, `controller`, ...). The tokenlogin token only lasts 300 s, so refresh it whenever a call returns 401.

2. **Build with that id** so `build-fw.sh` uploads the binaries against the pre-created record instead of creating a new one:
   ```bash
   FW_VERSION_ID="$FW_ID" FW_UPLOAD_VERSION="$TAG" ./build-fw.sh "$HW"
   ```
   Setting `FW_UPLOAD_VERSION` deliberately **suppresses** the script's auto-rollout (see `firmware/dev-build.sh`) — we want to control rollout ourselves so we can verify the exact id afterwards.

3. **Roll out** by updating the device class to point both `firmware_id` and `beta_firmware_id` at the new id. Read the class first to keep `concurrent` / `maxfails` unchanged:
   ```bash
   CLASS=$(curl -s "$API_URL_EXTERNAL/device/class/find/$HW" -H "Authorization: Bearer $ADMIN")
   CLASS_ID=$(echo "$CLASS" | jq -r .class_id)
   BODY=$(echo "$CLASS" | jq -c --arg fw "$FW_ID" \
     '{name, description, firmware_id:$fw, beta_firmware_id:$fw, concurrent, maxfails}')
   curl -s -X POST "$API_URL_EXTERNAL/device/class/$CLASS_ID" \
     -H "Authorization: Bearer $ADMIN" -H 'Content-Type: application/json' -d "$BODY"
   ```

4. **Verify** by polling `GET /device` (user token, not admin). For every device of that hardware type, success means:
   - `hardwareInfo.firmware_version == FW_ID`, **and**
   - `lastseen` within the last 60 s (device is back online after the reboot).

   Poll every ~30 s. Empirically a single device completes in 6–9 min; give it up to **15 min per device** before declaring failure. Devices roll one at a time per class (`concurrent: 1`), so for hardware types with multiple devices wait for the slowest, not the first.

   If a device hasn't come back after the timeout, dump its `lastseen` age and `cloudSettings.pendingFirmware`, and stop — do **not** start cycle 2.

### After cycle 1 succeeds, run cycle 2 with the second tag

Same steps, same hardware list, new `FW_ID`s. Cycle 2 is what proves "still accepts further updates" — if cycle 1 left the OTA partition in a bad state, cycle 2 will hang in `pendingFirmware`.

## After both cycles succeed

If the input was a PR number (single PR, or one PR in the default all-open-PRs loop), comment on **that** PR — not on any other — and only after its own cycle 2 has passed:

```bash
gh pr comment <N> --body "Skill check: All firmware versions have been installed twice and all devices are back online."
```

If the input was a branch with no PR, just report success in chat.

If anything failed, do **not** comment success. Report which device + which cycle to the user, and leave the class pointed at whichever firmware it was on when the failure happened (don't roll back automatically — the user needs to inspect).

## Restore state

- Delete the temp branches (`fw-check-merge-<N>`, `fw-check-pr<N>`).
- Check out the original branch.
- The device classes are deliberately left pointing at whatever was last tested. Master's next `./build-fw.sh` (with no `FW_UPLOAD_VERSION`) auto-rolls-out and clears this. Do not try to "restore" the previous firmware id; that's noise.

## Reference: useful API endpoints

All on `$API_URL_EXTERNAL`. Admin actions need the automation token (`POST /tokenlogin` with `{"token": "$AUTOMATION_TOKEN"}`), user actions need a regular login (`POST /login` with `AGENT_TESTING_*`).

| Purpose | Endpoint | Auth |
| --- | --- | --- |
| Fleet status (own devices) | `GET /device` | user |
| All devices (admin) | `GET /device/all` | admin |
| Online devices (admin) | `GET /device/onlinedevices` | admin |
| Find device class by name | `GET /device/class/find/{name}` | admin |
| Update device class (= rollout) | `POST /device/class/{class_id}` | admin |
| Pre-create firmware record | `POST /device/firmware` | admin |
| List firmware versions across fleet | `GET /device/firmwareversions` | admin |
| Device firmware log entries | `GET /device/logs/{device_id}` (filter `categories=device-firmware`) | user |

Device shape (only the parts the skill cares about):

```json
{
  "device_id": "...",
  "device_type": "fridge|controller|plug|fan|light",
  "lastseen": 1781297780311,
  "hardwareInfo": { "firmware_version": "<firmware_id currently running>" },
  "cloudSettings": { "pendingFirmware": "<firmware_id the server wants>" }
}
```

The OTA completion log entry shows up under `categories: ["device", "device-firmware"]` with `title: "message-firmware-update-complete-with-ids"` — useful if you want a chronological trace, but `hardwareInfo.firmware_version == FW_ID` is the authoritative check.
