# Infrastructure Security Audit

**Scope:** Deployment and infrastructure of the TerpControl / FG2 stack — Docker
Compose topology, container images, RabbitMQ/InfluxDB/MongoDB configuration,
operational shell scripts (`backup.sh`, `restore.sh`, `build-fw.sh`,
`provision-fw.sh`, firmware build helpers), the GitHub Actions deploy/build
pipelines, and the transport/auth surface that ties these together
(`server/src` auth and MQTT-auth paths).

**Date:** 2026-06-25
**Method:** Static review of the repository at branch
`claude/security-audit-infrastructure-k8coy6`. No live system was tested.

> This is a read-only audit. No application or infrastructure behaviour was
> changed. Each finding lists concrete evidence (`file:line`), impact, and a
> remediation. Severities are best-effort and assume a production deployment
> reachable from the internet.

---

## Summary of findings

| # | Severity | Finding |
|---|----------|---------|
| 1 | **High** | Hardcoded admin-equivalent automation token and infra addresses committed in `firmware/dockerbuild.sh` |
| 2 | **High** | No transport encryption: HTTP API and plaintext MQTT (1883) carry credentials in the clear |
| 3 | **High** | Device MQTT credentials stored and compared in plaintext in MongoDB |
| 4 | **Medium** | Insecure default secrets / fallbacks (`MQTTAUTH_SHARED_SECRET` → `terpcontrol`, mongo-express `admin`/`pass`, RabbitMQ `guest`/`guest`) |
| 5 | **Medium** | Wildcard CORS (`cors()`) combined with cookie-accepted auth |
| 6 | **Medium** | No brute-force rate limiting on `/login` or `/signup` |
| 7 | **Medium** | Container hardening gaps: run as root, `npm install` over `npm ci`, unpinned/`latest` and EOL base images |
| 8 | **Medium** | CI deploy trusts SSH host key via `ssh-keyscan` on every run (TOFU → MITM) |
| 9 | **Low** | Operational scripts use fragile/leaky `export $(grep … | xargs)` env parsing |
| 10 | **Low** | Secrets injected as environment variables (visible via `docker inspect`) |
| 11 | **Low** | Swagger UI / `swagger.json` served unauthenticated in production |
| 12 | **Low** | `--privileged` firmware-provisioning container |
| 13 | **Info** | InfluxDB usage reporting (phone-home) left enabled |

---

## High

### 1. Committed admin-equivalent automation token and infra addresses

`firmware/dockerbuild.sh` ships a real secret and production endpoints in git:

```
firmware/dockerbuild.sh:9   -e FG_AUTOMATION_TOKEN=df704228-0330-4904-9bce-55df8a7c8182
firmware/dockerbuild.sh:10  -e FG_AUTOMATION_URL=https://api.plantalytix-app-beta.com
firmware/dockerbuild.sh:12  -e FG_MQTT_HOST=142.132.245.68
```

This is not a placeholder. The automation token is exchanged at
`POST /tokenlogin` for a session token, and that path mints a token with
`is_admin: true`:

```
server/src/services/auth.service.ts:141  loginWithToken(token)
server/src/services/auth.service.ts:159     is_admin: true,
```

So anyone reading this file (the repo is forked publicly per `README.md`) gains
**administrator access** to the referenced server, plus its MQTT broker IP. The
token is used by build/provisioning tooling to talk to the server; it is *not*
compiled into device firmware, but that does not reduce the exposure of the
committed value itself.

**Impact:** Full admin compromise of the `api.plantalytix-app-beta.com`
deployment by anyone with repo access; disclosure of broker network location.

**Remediation:**
- Treat `df704228-0330-4904-9bce-55df8a7c8182` as compromised and **rotate
  `AUTOMATION_TOKEN`** on every affected server now.
- Remove the literal from the script — read it from the environment / `.env`
  the way `firmware/dev-provision.sh` already does (`FG_AUTOMATION_TOKEN`
  defaulting to `$AUTOMATION_TOKEN`). Make `dockerbuild.sh` a thin wrapper that
  fails if the variable is unset.
- Purge the secret from git history (`git filter-repo`) or, at minimum, accept
  that rotation is mandatory because history is forever.
- Consider giving build/provisioning tooling a **scoped** credential (firmware
  upload + device create only) rather than reusing a token that maps to full
  admin via `/tokenlogin`.

### 2. No transport encryption (HTTP + plaintext MQTT)

The stack terminates everything in cleartext:

- API is advertised over HTTP — `.env.sample:80`
  `API_URL_EXTERNAL=http://192.168.0.100:8081`; the webapp→server nginx proxy
  speaks plain HTTP (`server/nginx.conf`, `webapp/nginx.conf` listen on `:80`).
- MQTT is exposed on `1883` with no TLS — `docker-compose.yaml:53`,
  `.env.sample:65`.
- mongo-express / InfluxDB UIs are HTTP.

User passwords (`POST /login`), the self-registration password, and device MQTT
credentials all cross the network unencrypted. `mqtt.allow_anonymous = false`
(`rabbitmq/rabbitmq.conf:8`) is good, but the credentials it enforces are sent
in the clear.

**Impact:** Network-adjacent attackers (same LAN, upstream ISP, hostile
Wi-Fi) can capture user and device credentials and tokens, then replay them.

**Remediation:**
- Put the webapp/API behind a TLS-terminating reverse proxy (Caddy / Traefik /
  nginx with Let's Encrypt) and make `API_URL_EXTERNAL` `https://`.
- Enable MQTTS (TLS on 8883) in RabbitMQ and ship device firmware that
  validates the broker certificate; keep 1883 bound to the internal Docker
  network only.
- Set HSTS and `Secure` cookie attributes once TLS is in place.

### 3. Device MQTT credentials stored in plaintext

Device passwords are persisted and compared verbatim:

```
server/src/services/mqttauth.service.ts:29   return authData.password === findDevice.password;
server/src/services/device.service.ts:790    password: info.password,   // stored as-is on register
```

A read of the `devices` collection (DB breach, backup leak, mongo-express
access) yields every device's live broker credential. The comparison is also
non-constant-time, though that is secondary to plaintext-at-rest.

**Impact:** Any MongoDB/backup compromise hands an attacker working MQTT
credentials for every device, enabling command injection to physical hardware.

**Remediation:**
- Hash device secrets at rest (bcrypt/argon2) and compare against the hash in
  the `/mqttauth/.../user` handler, or move to per-device client certificates.
- If hashing the broker password is impractical for the protocol, store it
  encrypted with a KMS-held key rather than plaintext, and restrict who can
  read the collection.

---

## Medium

### 4. Insecure default secrets and fallbacks

- `docker-compose.yaml:58` and `:118` default `MQTTAUTH_SHARED_SECRET` to the
  literal `terpcontrol`. If an operator never sets it, the broker↔server auth
  bridge runs on a value that is published in this very repository. (The
  RabbitMQ entrypoint refuses to start when the variable is *empty*
  — `rabbitmq/docker-entrypoint-wrapper.sh:6` — but the compose default means it
  is never empty, so the guard never trips and the weak literal is used.)
- mongo-express defaults to `admin`/`pass`
  (`docker-compose.yaml:24-25`, `.env.sample:50-51`); `README.md` even
  advertises it as reachable with default credentials.
- RabbitMQ management ships the stock `guest`/`guest` account (`README.md`).

These admin UIs default to `127.0.0.1` binding (`.env.sample:44,68`), which
limits blast radius — but the `.env.sample` comments invite operators to expose
them on `0.0.0.0`, at which point the weak defaults are internet-facing.

**Remediation:**
- Drop the `:-terpcontrol` fallback so a missing `MQTTAUTH_SHARED_SECRET`
  fails closed (the wrapper already supports this).
- Force non-default mongo-express / RabbitMQ credentials; remove the "default
  credentials are fine" wording from `README.md`.
- Keep admin UIs bound to loopback (or behind an authenticated tunnel) and
  warn explicitly against `0.0.0.0` in the sample.

### 5. Wildcard CORS with cookie-accepted auth

```
server/src/app.ts:68   // this.app.use(cors({ origin: ORIGIN, credentials: CREDENTIALS }));
server/src/app.ts:69   this.app.use(cors());
```

The origin-restricted configuration is commented out in favour of an
open `cors()`. The auth middleware accepts tokens from a cookie
(`server/src/middlewares/auth.middleware.ts:12`) as well as the `Authorization`
header and an image `?token=` query param. Default `cors()` does not set
`Access-Control-Allow-Credentials`, so browsers won't *send* cookies
cross-origin — but the open policy still lets any site read responses for
requests that carry a bearer token via script, and the image query-token path
widens the surface.

**Remediation:** Re-enable the explicit allowlist (`origin: ORIGIN`,
`credentials` only if needed) and configure `ORIGIN` per environment.

### 6. No brute-force rate limiting on `/login` / `/signup`

Rate limiting exists only on the automation token endpoint:

```
server/src/routes/auth.route.ts:9    tokenLoginLimiter (20/min)
server/src/routes/auth.route.ts:158  applied to /tokenlogin
```

`POST /login` (`:120`), `POST /signup` (`:58`), and `POST /getreset` (`:222`)
have none. `/login` is therefore open to online password guessing, and
`/getreset` can be abused to spam emails (it does correctly avoid account
enumeration by always returning 201 — `auth.service.ts:79`).

**Remediation:** Apply an `express-rate-limit` policy (per-IP and, ideally,
per-username) to `/login`, `/signup`, and `/getreset`; add lockout/backoff on
repeated failures.

### 7. Container & image hardening gaps

- **Runs as root:** no `USER` directive in `server/Dockerfile`,
  `webapp/Dockerfile`, or `rabbitmq/Dockerfile`; the node server process runs
  as root inside the container.
- **Non-reproducible installs:** `server/Dockerfile:19` and
  `webapp/Dockerfile:11` use `npm install` (mutates the lockfile) instead of
  `npm ci`.
- **Unpinned / `latest` base images:** `docker-compose.yaml:3` defaults MongoDB
  to `mongo` (i.e. `latest`) and `:28` InfluxDB to `influxdb` (`latest`); these
  pull a moving, unaudited image at build time.
- **EOL runtime:** the webapp builds on `node:16-alpine`
  (`docker-compose.yaml:67`, `.github/workflows/build.yml:122`); Node 16 is past
  end-of-life and no longer receives security fixes.

**Remediation:** Add a non-root `USER`; switch to `npm ci`; pin base images to a
specific minor tag (ideally by digest); move the webapp build to a supported
Node LTS; add image vulnerability scanning (Trivy/Grype) to CI.

### 8. CI deploy trusts SSH host key on every run

```
.github/workflows/deploy.yml:161  ssh-keyscan -H "$DEPLOY_HOST" >> ~/.ssh/known_hosts
.github/workflows/deploy.yml:206  (same in the firmware job)
```

`known_hosts` is populated by scanning the host *each run*, so the deploy never
verifies a pinned key — a runner that talks to a MITM during the scan will
happily push the repo and run `docker compose` against the impostor. The deploy
private key (`secrets.SSH_PRIVATE_KEY`) and an interactive remote shell are at
stake.

**Remediation:** Store the expected host public key as a secret/variable and
write it to `known_hosts` directly (or use a known-hosts–pinning action) instead
of `ssh-keyscan`. The rsync `--delete` correctly excludes `.env`/`.env.*`
(`deploy.yml:174-175`), which is good — keep that.

---

## Low / Informational

### 9. Fragile and leaky env parsing in shell scripts
`backup.sh:7`, `restore.sh:6`, `build-fw.sh:6`, `provision-fw.sh:13`,
`firmware/dev-provision.sh:12` all do
`export $(grep -v '^#' "$ENV_FILE" | … | xargs)`. This breaks on values
containing spaces or quotes, performs word-splitting/globbing on secret values,
and exports the *entire* `.env` (every secret) into the process environment of
the build, where it can leak into child processes and CI logs. Prefer
`set -a; . "$ENV_FILE"; set +a` with a controlled file, or pass only the
variables each script actually needs.

### 10. Secrets passed as environment variables
The compose `server` service receives `TOKEN_SECRET_KEY`, DB and InfluxDB
credentials, `AUTOMATION_TOKEN`, `SELF_REGISTRATION_PASSWORD`, SMTP password,
etc. as plain env vars (`docker-compose.yaml:90-118`). These are readable by
anyone who can run `docker inspect` or read `/proc/<pid>/environ` on the host.
Consider Docker/Compose **secrets** (file-mounted) for the most sensitive
values.

### 11. Swagger served unauthenticated
`server/src/app.ts:88-92` exposes `/swagger.json` and `/api-docs` with no auth.
In production this hands attackers a complete API map. Gate it behind admin auth
or disable it when `NODE_ENV === 'production'`.

### 12. `--privileged` provisioning container
`provision-fw.sh:28` runs the build container `--privileged` with
`/dev/bus/usb` mounted. This is needed for USB flashing, but `--privileged`
grants full host device access; prefer scoping with `--device` and specific
capabilities rather than blanket privilege. (The non-flashing `build-fw.sh` path
is already unprivileged — good.)

### 13. InfluxDB usage reporting enabled
`config/influxdb-config.yml:20` `reporting-disabled: false` leaves InfluxDB's
phone-home telemetry on. Set it to `true` for a self-hosted deployment. (Note
this config file is currently commented out in `docker-compose.yaml:36`, so it
only applies if re-enabled.)

---

## Things done well

- MQTT anonymous access is disabled and the broker↔server auth secret is
  URL-encoded and compared in constant time
  (`rabbitmq/docker-entrypoint-wrapper.sh`, `middlewares/mqttauth.middleware.ts`
  with `timingSafeEqual`).
- The automation-token comparison in `loginWithToken` is length-safe and
  constant-time (`auth.service.ts:147-155`).
- User passwords are bcrypt-hashed (`auth.service.ts:47,126,137`).
- `helmet()` and `hpp()` are enabled (`app.ts:70-71`); access tokens are
  short-lived (5 min) with a separate refresh token.
- Password reset avoids account enumeration (always returns 201).
- `.env` is git-ignored and excluded from the deploy rsync; `.dockerignore`
  keeps `.git` and `.env.*` out of build context.

---

## Suggested priority order

1. Rotate the leaked automation token and remove it from the script (#1).
2. Put TLS in front of the API and broker (#2).
3. Hash device credentials at rest (#3).
4. Remove insecure default-secret fallbacks and rate-limit `/login` (#4, #6).
5. Lock down CORS, container/image hardening, and CI host-key pinning
   (#5, #7, #8).
