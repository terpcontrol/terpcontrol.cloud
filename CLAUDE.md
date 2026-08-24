# CLAUDE.md

The project conventions live in [AGENTS.md](AGENTS.md); read those as well.

## Documentation
- `README.md` is user facing: how to run and use the stack, nothing else. Keep it short, and only add to it when
  somebody running the application would otherwise miss something.
- Build, CI, deployment and release details are internal. Document them where they live - as comments in the workflow,
  script or config they describe - and keep them out of the README.

## Launching the stack locally

`AGENTS.md` covers the day-to-day commands. What it leaves out is the first-time setup:

1. `cp .env.sample .env`, then edit it:
   - replace every `CHANGEME` (any value works locally),
   - `MQTT_HOST_EXTERNAL=localhost` and `API_URL_EXTERNAL=http://localhost:${API_PORT_EXTERNAL}` so the browser and
     `./simulate-device.sh` reach the stack on the loopback address,
   - set `AGENT_TESTING_USERNAME` / `AGENT_TESTING_PASSWORD` to the `ADMINUSER_*` credentials; the admin account is
     created from those on first start, and the tooling logs in with the `AGENT_TESTING_*` pair.
2. `docker compose up --build -d --remove-orphans`. The first build compiles the webapp and takes a few minutes.
3. `./simulate-device.sh setup` to have something to look at - a fresh database contains no devices.

Worth knowing:
- `API_URL_EXTERNAL` is compiled into the webapp bundle, so changing it needs `docker compose up --build -d webapp`.
- Anything host-side (`simulate-device.sh`, `webapp/`, `server/`) needs Node 18+; the containers bring their own.
- `docker compose down --volumes` throws the databases away and gives you an empty stack again.

## Simulating a device

`./simulate-device.sh` stands in for real hardware. It registers a device, claims it for the local user and then
speaks the same MQTT topics as the firmware, so the server and the webapp cannot tell the difference. Use it whenever
a UI change needs a device to look at - no hardware, no firmware build.

```sh
./simulate-device.sh setup                 # register + claim + configure + 3 days of history
./simulate-device.sh run                   # keep it online and answer the server (Ctrl-C to stop)
./simulate-device.sh --help                # every command and option
```

`setup` and `run` default to a `fridge` called `sim-fridge`. Pass `-d <device-id>` and `-t <type>` for more devices;
`fridge`, `controller`, `plug`, `fan` and `light` each report exactly the sensors and outputs their real counterpart
does. Log in to the webapp with the `AGENT_TESTING_*` credentials to see them.

### Driving the UI

| Goal | Command |
| --- | --- |
| A specific reading (alarm thresholds, layout with long values) | `./simulate-device.sh send --set temperature=31.5 --set humidity=80` |
| Force an output on or off (`out_` prefix) | `./simulate-device.sh send --set out_light=0` |
| Pin values for a whole session | `./simulate-device.sh run --set co2=1600` |
| Chart data over a longer period | `./simulate-device.sh history --days 30 --step 60` |
| Change device settings without the webapp | `./simulate-device.sh configure day.temperature=27 lights.limit=60` |
| A diary entry, an alert badge | `./simulate-device.sh log message-co2-low:380 --severity 1` |
| Toggle a capability the webapp keys off | `./simulate-device.sh hwinfo co2=off` |
| Pretend a webcam is paired | `./simulate-device.sh hwinfo webcam_did=DEMOCAM01` (`=none` removes it) |
| Put the device into the public demo | `./simulate-device.sh demo on` |
| See what the server thinks | `./simulate-device.sh info` |
| See what the server sends the device | `./simulate-device.sh watch` |

A device counts as offline ten minutes after its last sample, so stopping `run` is how you get the offline state.

### What a running device answers

With `run` in the background, everything the webapp can do to a device works end to end: saving settings, test mode,
maintenance mode, reboot, pairing and removing smart sockets, and firmware updates (the device reports the new
firmware id a few seconds after being told to update). Alarms fire too - define one in the webapp and push a value
past it with `send --set`.

Log messages use the `message-*` keys from `webapp/src/assets/i18n/en.json`; anything else shows up verbatim.

### Notes

- Credentials are derived from the device id, so any shell reaches the same simulated device without shared state.
  `send`, `log` and friends work while `run` is going.
- `.simulated-devices/` (gitignored) is the device's NVS: its firmware id and paired sockets survive a restart.
  Delete a file there to get factory-fresh hardware back.
- The stack it talks to comes from `.env`. Override with `SIM_API_URL`, `SIM_MQTT_HOST` and `SIM_MQTT_PORT` to drive
  a stack that is not the local one.
