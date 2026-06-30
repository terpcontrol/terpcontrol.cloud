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

After checking out the merged state, run `docker compose up -d` so any
`docker-compose.yaml`, `.env`, image, or entrypoint changes in the PR take
effect before the firmware is built/rolled out. Without this step you'd
be testing new firmware against the **pre-merge** broker/server, which can
silently mask or fake "successes" — e.g. a PR that moves the MQTT listener
to a new port appears to fail because the device can't reach the new port
on the still-running old container.

## Preflight — do this once at the start

Skip the per-PR loop if any preflight check fails; the whole point of preflight is that any later failure is attributable to the new firmware, not to the environment.

1. **Stack is up.** `docker compose ps` must show `server`, `mongodb`, `rabbitmq`, `webapp`, `influxdb` as `Up`. If anything is down, ask before `docker compose up -d`.
2. **`.env` is loaded.** Read `API_URL_EXTERNAL`, `AUTOMATION_TOKEN`, `AGENT_TESTING_USERNAME`, `AGENT_TESTING_PASSWORD` from `.env`. The default user account is `extr3m0@email.de` (these are the values in `.env` for the test fleet).
3. **Devices are online.** Log in with the user credentials, `GET /device`, and confirm every device has `lastseen` within the last 10 min (`ONLINE_TIMEOUT`). Treat absent `hardwareInfo.firmware_version` as offline. If any device is offline, stop and tell the user which one — don't roll out to a fleet that already has an unknown problem.
4. **Build container is present.** `docker images | grep plantalytix-buildcontainer` should show a row; if not, the first `build-fw.sh` will rebuild it (slower but fine).

## One check cycle

A "check cycle" = build + rollout + verify. Per PR/branch, run two cycles back-to-back with different version tags. The unique tag is what lets you tell the test firmwares apart in `/device/firmware` listings later; it isn't load-bearing for the test itself.

Hardware list: by default `fridge controller plug fan light` (the default in `build-fw.sh`). Per `AGENTS.md`, run `fridge` first if you are scoping down. Skip `dryer`.

### Run a cycle

Two helper scripts live in `.claude/skills/firmware-check/scripts/`. Run them from the repository root so `build-fw.sh` and `.env` resolve correctly:

```bash
TAG=check-pr<N>-$(date +%s)-1
./.claude/skills/firmware-check/scripts/run-cycle.sh "$TAG" fridge controller plug fan light
./.claude/skills/firmware-check/scripts/verify.py /tmp/fw_state_${TAG}
```

`run-cycle.sh` does **build + rollout** for every hardware type listed:

1. `POST /device/firmware` with the tag to pre-create a firmware record per type, capturing the new id.
2. `FW_VERSION_ID=<id> FW_UPLOAD_VERSION=<tag> ./build-fw.sh <hw>` so the binaries upload against the pre-created record. Setting `FW_UPLOAD_VERSION` deliberately **suppresses** `build-fw.sh`'s auto-rollout (see `firmware/dev-build.sh`) — we control rollout ourselves so we can verify the exact id afterwards.
3. `POST /device/class/<class_id>` with `firmware_id` and `beta_firmware_id` both set to the new id (reading the existing `concurrent` / `maxfails` first to keep them).

It writes `/tmp/fw_state_<tag>` — one `<hw> <firmware_id>` line per type — which `verify.py` reads.

`verify.py` polls `GET /device` (user token, not admin) every 15 s. Success for a device = `hardwareInfo.firmware_version == <target id>` AND `lastseen` within the last 60 s (proves the device rebooted and came back). Timeout is **15 min per cycle**. Empirically a single device takes 6–9 min, and devices roll one at a time per class (`concurrent: 1`), so wait for the slowest, not the first. Exit 0 = all good; exit 1 = timeout (stop, do **not** start cycle 2).

### After cycle 1 succeeds, run cycle 2 with a `-2` tag

Same hardware list, new tag, fresh firmware ids. Cycle 2 is what proves "still accepts further updates" — if cycle 1 left the OTA partition in a bad state, cycle 2 will hang in `pendingFirmware`.

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
