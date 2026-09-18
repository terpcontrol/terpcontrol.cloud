# CLAUDE.md

The project conventions live in [AGENTS.md](AGENTS.md); read those as well.

## Documentation
- `README.md` is user facing: how to run and use the stack, nothing else. Keep it short, and only add to it when
  somebody running the application would otherwise miss something.
- Build, CI, deployment and release details are internal. Document them where they live - as comments in the workflow,
  script or config they describe - and keep them out of the README.
- **This repository is public.** It holds only what the software itself needs: technical and architectural
  decisions (`docs/`), user-facing guides (Raspberry Pi, firmware upgrade, TriAC fix) and code. Everything about
  the company lives in the private `terpcontrol.com` repository under `docs/`: business plans and strategy, market
  and competitor research, roadmap and pricing decisions, reverse engineering of purchased hardware, supplier,
  customer and sales information, and anything containing credentials. When a task produces such a document,
  write it there, never here; when a task needs one, read it there. A code comment may say that internal notes
  exist, but must not reproduce their content.

## Launching the stack locally

`AGENTS.md` covers the day-to-day commands. What it leaves out is the first-time setup:

1. `cp .env.sample .env`, then edit it:
   - replace every `CHANGEME` (any value works locally),
   - `MQTT_HOST_EXTERNAL=localhost` and `API_URL_EXTERNAL=http://localhost:${API_PORT_EXTERNAL}` so the browser and
     `./simulate-device.sh` reach the stack on the loopback address,
   - set `AGENT_TESTING_USERNAME` / `AGENT_TESTING_PASSWORD` to the `ADMINUSER_*` credentials; the admin account is
     created from those on first start, and the tooling logs in with the `AGENT_TESTING_*` pair.
2. `docker compose up --build -d --remove-orphans`. The first build compiles the webapp and takes a few minutes.
3. `./simulate-device.sh demo-seed` to have something to look at - a fresh database is an empty account. It builds
   two tents, a fridge, a camera and three weeks of readings, and says at the end which parts of the record have
   no routes yet. `./simulate-device.sh setup` is the single-device version: it prints the device id it invented,
   and every later command needs that id.

Worth knowing:
- `API_URL_EXTERNAL` is compiled into the webapp bundle, so changing it needs `docker compose up --build -d webapp`.
- Anything host-side (`simulate-device.sh`, `webapp/`, `server/`) needs Node 20.19+; the containers bring their own.
- `docker compose down --volumes` throws the databases away and gives you an empty stack again.
- Serving the UI from the host is still the faster loop: `docker compose up --build -d server rabbitmq mongodb
  influxdb` brings up everything a device and the API need, and `npm start` in `webapp/` then serves the UI on
  `http://localhost:4200` against that stack, rebuilding on save rather than rebuilding an image. `npm start`
  writes `webapp/.env.local` from `API_URL_EXTERNAL` itself, so the dev server needs no pointing. Build the image
  when the production bundle is what you are checking, and not otherwise.

### In a sandboxed agent session

A session that runs in a container rather than on a developer machine hits three things before the build starts,
none of which need a repo change - the base images are already build arguments:

1. **The Docker daemon may not be running.** `docker info` says so; `dockerd &` as root fixes it.
2. **`COMPOSE_FILE` and `COMPOSE_PROFILES` may come preset** by the environment, naming files this repo does not
   have. Compose then fails with `stat docker-compose.yml: no such file or directory`. `unset` both.
3. **The build cannot verify TLS** when the session's egress proxy re-terminates it, so the server image's
   `apk add` fails with `TLS: server certificate not trusted`. Containers do not read the host's CA
   configuration, so bake the CA into a base image once and point the image overrides at it:

```sh
mkdir -p /tmp/proxy-ca && cp "$CA_BUNDLE" /tmp/proxy-ca/ca.crt   # e.g. /root/.ccr/ca-bundle.crt
cat > /tmp/proxy-ca/Dockerfile <<'EOF'
FROM node:20-alpine
COPY ca.crt /usr/local/share/ca-certificates/proxy.crt
RUN cat /usr/local/share/ca-certificates/proxy.crt >> /etc/ssl/certs/ca-certificates.crt
ENV NODE_EXTRA_CA_CERTS=/usr/local/share/ca-certificates/proxy.crt
EOF
docker build -t node:20-alpine-proxyca /tmp/proxy-ca

cat >> .env <<'EOF'
DOCKER_NODE_SERVER_IMAGE=node:20-alpine-proxyca
DOCKER_NODE_BUILD_IMAGE=node:20-alpine-proxyca
EOF
```

The other images pull ready-made or build without the network, so they need nothing. From here the compose
commands above run through.

The same applies to the UI: bring up the four backend services and serve it with `npm start` instead of building
the webapp image. Driving it works with the Chromium that is already installed, but Playwright pins a browser
build the image may not carry - pass its path as `executablePath` instead of downloading one. The fonts are
self-hosted, so a blocked Google Fonts costs the page nothing.

## Simulating a device

`./simulate-device.sh` stands in for real hardware. It registers a device, claims it for the local user and then
speaks the same MQTT topics as the firmware, so the server and the webapp cannot tell the difference. Use it whenever
a UI change needs a device to look at - no hardware, no firmware build.

```sh
./simulate-device.sh demo-seed                 # a whole account: two tents, a fridge, a camera, 3 weeks of readings
./simulate-device.sh setup                     # one device: register + claim + configure + 3 days of history
./simulate-device.sh -d <device-id> run        # keep it online and answer the server (Ctrl-C to stop)
./simulate-device.sh list                      # the device ids you already have
./simulate-device.sh --help                    # every command and option
```

`demo-seed` names its own devices and can be run again without building a second of anything; it prints the `run`
line for each of them, and lists what it could not build because the API has no route for it yet.

`setup` invents a `sim-<type>-<random>` id and prints it; **every other command needs that id via `-d`**, so a
command never acts on a device you did not name. Add `-t <type>` to simulate something other than a `controller`:
`fridge`, `controller`, `plug`, `fan` and `light` each report exactly the sensors and outputs their real counterpart
does. Log in to the webapp with the `AGENT_TESTING_*` credentials to see them.

### Driving the UI

Every line below is shortened - each command also needs the `-d <device-id>` that `setup` printed.

| Goal | Command |
| --- | --- |
| A specific reading (alarm thresholds, layout with long values) | `send --set temperature=31.5 --set humidity=80` |
| Force an output on or off (`out_` prefix) | `send --set out_light=0` |
| Pin values for a whole session | `run --set co2=1600` |
| Chart data over a longer period | `history --days 30 --step 60` |
| Change device settings without the webapp | `configure day.temperature=27 lights.limit=60` |
| A diary entry, an alert badge | `log message-co2-low:380 --severity 1` |
| Toggle a capability the webapp keys off | `hwinfo co2=off` |
| A device with a webcam | `run --camera` |
| Put the device into the public demo | `demo on` |
| See what the server thinks | `info` |
| See what the server sends the device | `watch` |

A device counts as offline ten minutes after its last sample, so stopping `run` is how you get the offline state.

### What a running device answers

With `run` in the background, everything the webapp can do to a device works end to end: saving settings, test mode,
maintenance mode, reboot, pairing and removing smart sockets, and firmware updates (the device reports the new
firmware id a few seconds after being told to update). Alarms fire too - define one in the webapp and push a value
past it with `send --set`.

Log messages use the `message-*` keys from `webapp/public/assets/i18n/en.json`; anything else shows up verbatim.

### The webcam

`run --camera` pairs a simulated Terp Control Cam. The cloud then asks the device for a still every 30 seconds over
MQTT, exactly as it does for the real P2P camera, and the device answers with a drawn picture of a grow tent - lit by
whatever the light output is doing, so a timelapse tracks the day/night cycle the charts show. That covers the webcam
tile, the camera view beside the charts, the test-image button and the timelapses.

The pairing is remembered like real hardware, so a later `run` keeps the camera without the flag. `hwinfo
webcam_did=none` removes it again, and `hwinfo webcam_did=<id>` pairs one without restarting.

### Notes

- Credentials are derived from the device id, so any shell reaches the same simulated device without shared state.
  `send`, `log` and friends work while `run` is going.
- `.simulated-devices/` (gitignored) is the device's NVS: its firmware id, paired sockets and camera survive a
  restart. Delete a file there to get factory-fresh hardware back.
- The stack it talks to comes from `.env`. Override with `SIM_API_URL`, `SIM_MQTT_HOST` and `SIM_MQTT_PORT` to drive
  a stack that is not the local one.
