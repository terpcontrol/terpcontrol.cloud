# AGENTS.md

## Code style
- Keep code short and concise.
- Only add comments when they remain useful in the long run. Skip comments that just restate what the code does.
- Don't reference specific issues, tasks, or conversations in code comments (e.g. "see issue #24", "fix from PR #2", "as discussed"). Comments must stand on their own — explain the *why* in general terms so they still make sense in isolation a year from now. Issue/PR references belong in the commit message, not in the source.

## Running the stack
- The full application launches with `docker compose up --build -d --remove-orphans`.
- Webapp: `http://localhost:${WEBAPP_PORT_EXTERNAL}` (port from `.env`).
- Use a local browser as chromium to test the webapp.
- API: `${API_URL_EXTERNAL}` (from `.env`) — call directly for backend testing.
- Login credentials for automated testing: `AGENT_TESTING_USERNAME` / `AGENT_TESTING_PASSWORD` (from `.env`).

## Firmware
- Roll out new firmware with `./build-fw.sh`. Pass one or more device types (`fridge`, `controller`, `plug`, `fan`, `light`) to limit the build, otherwise all are built.
- Ignore the `dryer` hardware type — do not build, roll out, or test it.
- After a rollout, wait ~7 minutes for the update to complete, then verify the device reconnects successfully.
- When testing firmware-related behavior end-to-end, run the test against the `fridge` device first before any other device. (Unless the change doesn't apply to `fridge`.)
- Before rolling out, confirm the target devices are online. Log in to the API and `GET /device`; each device's `lastseen` (epoch ms) is online when it is within the last 10 minutes (`ONLINE_TIMEOUT`). To compile-check without touching any device, build in the container with `FW_NO_UPLOAD=1 FW_VERSION_ID=<any> ./build-fw.sh <types>`.

## Garmin viewer app
- The Connect IQ widget lives in `garmin/`. Build it with `./build-garmin.sh`; the packaged app lands in `garmin/bin/`.
- The build needs the `GARMIN_*` variables from `.env`. Without a Garmin developer login the device definitions cannot be
  downloaded, so the build cannot run at all on a machine that has never built it before.
- Publishing is manual — never try to upload the `.iq` to the Connect IQ store.

## Before committing
- Read the **Development** section of `README.md` and run the listed lint/build steps for any subproject you touched (`webapp/`, `server/`, `garmin/`).
- Ignore the `provision-fw.sh` instructions in that section — use `./build-fw.sh` instead.
- Counting type errors needs `--pretty false`: with pretty output on, `tsc` writes ANSI colour codes between
  "error" and "TS", so `tsc --noEmit -p tsconfig.json | grep -c "error TS"` prints 0 on a project that does not
  compile. Use `npx tsc --noEmit -p tsconfig.json --pretty false 2>&1 | grep -c "error TS"`.
- Run the checks and read their output *before* committing, in a separate command. A command that tests and
  commits in one line commits whatever the tests said.
