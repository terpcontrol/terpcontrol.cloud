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
- After a rollout, wait ~7 minutes for the update to complete, then verify the device reconnects successfully.
- When testing firmware-related behavior end-to-end, run the test against the `fridge` device first before any other device. (Unless the change doesn't apply to `fridge`.)

## Before committing
- Read the **Development** section of `README.md` and run the listed lint/build steps for any subproject you touched (`webapp/`, `server/`).
- Ignore the `provision-fw.sh` instructions in that section — use `./build-fw.sh` instead.
