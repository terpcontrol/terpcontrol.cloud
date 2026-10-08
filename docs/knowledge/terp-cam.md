---
summary: Cameras in this software - Terp Cam pairing on a device, the cloud's P2P client behind the device relay, RTSP cameras, polling, stills, timelapses, camera records, limits, failure modes and env variables; read before changing camera code
updated: 2026-10-08
source: Chris (decisions, PR reviews 2026-08..10); PRs #10-#140 and their sessions; commits since 2026-01; codebase cleanup (2026-10-08); checked against the code 2026-10-08; an HTTP snapshot read with the server image's ffmpeg (2026-10-08)
paths:
  - firmware/src/terpcam.*
  - server/src/modules/v1/camera/**
  - server/src/modules/device-protocol/hardware-report.service.ts
  - server/src/modules/tunnel/**
  - shared-types/src/v1/capture.ts
  - webapp/src/screens/camera/**
  - webapp/src/api/cameras.ts
---
# Terp Cam and other cameras

The wire contract is in [device-protocol.md](../device-protocol.md): the `webcam_*` keys and the camera row made
from them ([6.2](../device-protocol.md#62-hardware-info)), `cam_relay` ([8.5](../device-protocol.md#85-cam_relay)),
the poller, the capture budget, the relay's steps, framing, cipher and timers, and the tunnel
([9](../device-protocol.md#9-the-still-cycle), [9.1](../device-protocol.md#91-the-relay),
[9.2](../device-protocol.md#92-the-tunnel), [11](../device-protocol.md#11-timing-and-limits)); the `cameras` and
`media` records are in [ADR 0001](../adr/0001-app-rewrite-data-model.md). This document holds why it is built that
way and what the code has to respect. Internal notes on the camera exist.

## Rules (Chris)
- No traffic between camera and server on a LAN: the camera sits behind the grower's router, the server on the
  internet, and only a Terp Control device shares the camera's network (2026-09-08).
- No server of the camera's manufacturer is contacted: per still was never acceptable (2026-09-08), and the lookup
  path went entirely with the relay (2026-09-29, PR #114); no third-party server address is compiled in (PR #84).
- Full resolution (2304x1296) or no still - a poll without a picture beats a downgraded one in the timelapse; the
  640x360 path was removed (2026-09-30, PR #120).
- A relay change is tested locally with a real device (fridge module): more than 90% of polls deliver a still
  (2026-09-30). Baseline: 63 of 65 through nginx at a 30 s poll (PR #124); first attempts take 1.8-2.4 s (PR #129).
- Every timeout allows for MQTT latency and a slow, choppy uplink; argue a timer change against lwIP's
  retransmission (~3 s, then 6 s more), the device's loop and MQTT delivery (2026-10-02).
- One pipeline: Terp Cam and RTSP stills share poller, backoff, pauses, test button, storage, timelapses and
  thinning (2026-08-19); the test button waits exactly as long as a regular capture (2026-10-03).
- Device RAM is scarce, so firmware camera code must not leak: it allocates only while it runs and frees on every
  exit (2026-08-19). Code says the product name, `terpcam*`, not the manufacturer's (2026-09-08).

## Kinds of camera (`cameras.kind`)
- `terpcam_controller`: a Terp Cam paired in the menu of a fridge module, controller, AIR (fan) or Smart Socket
  (plug) - the LIGHT has no entry (PR #128). One per device; the server treats every type alike.
- `rtsp`: any URL ffmpeg reads (RTSP or an HTTP snapshot URL), pulled directly or, with `tunnel: true`, through the
  MQTT tunnel of any Terp Control device in the place - the tunnel is in the firmware all types share. Through the
  device is the default (Chris, 2026-10-08): the app's switch starts on, and a create that names a device and leaves
  `tunnel` out gets it (not over UDP); a direct pull is for a camera the cloud can reach on the internet.
- `terpcam_standalone`: in the model only; the app does not offer it (Chris, 2026-10-08) and `POST /v1/cameras`
  refuses it: without a device nothing opens a relay, and the cloud cannot reach a camera behind the grower's router
  on its own.

## Pairing on the device (`firmware/src/wifi.cpp`, `firmware/src/terpcam.cpp`)
- "connect cam" needs the device's WiFi set up and refuses a second camera. It joins the camera's open setup access
  point `@IPC-<n>`, reads `get_status.cgi` over HTTP there - `realdeviceid` becomes `webcam_did`, `deviceid` without
  dashes the P2P id `webcam_uid` - and moves the camera onto the device's own WiFi with `set_wifi.cgi` (the access
  point drops before it answers, so the timeout is the success).
- Securing (`terpCamSecure`) runs after the camera has joined, over P2P - on its setup AP the camera silently ignores
  a password change. A random 12-character password is set with `set_users.cgi?pwd_change_realtime=1` and confirmed
  by using it (`get_status.cgi` until the reply carries `deviceid`), not by parsing the reply: shapes differ and the
  change can drop the session. Kept in NVS, reported as `webcam_pwd`; a camera that refuses keeps the default and
  pairs anyway, and is secured later from the idle loop (`terpCamNeedsSecuring`, one attempt even on a zero budget).
- "disconnect cam" asks, ends a running relay and sends `restore_factory.cgi` over a checked session for 4 s (the
  camera reboots before it answers), which puts it back on its setup AP and default login for the next pairing. Best
  effort: `forgetTerpCam` erases every camera key (Chris, 2026-09-30) and reports the `webcam_*` keys as `none` either
  way - also with no `webcam_did` stored, since keys left by an interrupted pairing crashed the next one (PR #123).

## Finding the camera on the LAN
- `realdeviceid` (`webcam_did`) is the identity; `webcam_uid` and `webcam_ip` are hints. Discovery asks the cached
  address first (800 ms, the only round that works where the access point isolates clients), then broadcasts for 4 s.
- A session counts only after `get_status.cgi` names the paired camera: `realdeviceid="<id>"` when the password was
  accepted, `vuid=<id>` with `result=-1` when refused (`checkReply` in firmware, `checkStatusReply` on the server).
  Keys are matched whole (`support_vuid=1` was once read as the id `1`). Before PR #113 any answer counted, and a
  second camera on the LAN (a replaced one, a neighbour's) was adopted for good. A foreign camera is closed (`f0`),
  skipped and its cached uid or address erased; securing and reset run only on a checked session.
- `openSession` filters by the stored uid and, when that finds nothing, makes a second pass that accepts any camera
  and lets the check pick ours and re-learn the uid (PR #140: a uid left by a previous camera wedged discovery). The
  relay's own discovery accepts only the stored uid; ten sessions that find nothing trigger a 12 s search from the
  idle loop, which drops a uid nothing answers to (`message-terp-cam-not-found`), so the next relay relearns it.

## The still path: device relay, cloud P2P client
- The cloud runs the whole P2P client (`terpcam-direct.service.ts`); the device only bridges datagrams. Why: the
  cloud cannot reach the camera from outside its LAN; the ESP32 cannot take a full-resolution keyframe itself (an
  unpaced burst of ~30-50 fragments overruns lwIP's few-deep datagram mailbox, keyframes of 27-67 KB against a
  largest free heap block of ~73-94 KB); the MQTT tunnel loses the burst (QoS 0, base64 in JSON, blocking TLS
  publishes that starve the loop).
- The relay is an HTTP upgrade on the API (Chris, 2026-09-30, PR #124), so it goes wherever the API's requests go,
  reverse proxy included, with no port of its own; the server matches the path suffix `/terpcam/relay`. The
  single-use token, not the source address, matches a dial-in to its capture, so devices behind one NAT share it.
  AES-128-CTR because every CGI carries the camera password under nothing but the camera's fixed table cipher; with
  it the relay is as private as the MQTT link the key came over, so the device need not verify TLS.
- Device side (`terpCamStartRelay`): its own FreeRTOS task, all memory freed on exit (a fridge kept 60 KB free heap
  during a TLS relay), so the control loop never waits; the task never logs, the log queue is the loop's. WiFi
  power-save is off while it runs (it drops inbound UDP) and datagrams are drained hard. Only the camera with the
  known P2P id is relayed to, so a neighbour's camera never sees the cloud's login.
- Server side: one capture per device; attempts and timers as in device-protocol 9.1, each reasoned in its comment in
  `terpcam-direct.service.ts` (the 60 s transfer covers waiting for the GOP's next keyframe, longer in night mode).
- The server never closes first: a reverse proxy ends both sides as soon as one closes, while the device is still
  freeing the camera, and the device refuses a new relay until the old one has ended - closing first made every
  retry behind a proxy fail (PR #124).

## What the camera's P2P protocol demands (each fails silently)
- A fresh session per still: the keyframe is then the stream's first frame. A re-requested stream on a held session
  is ignored, so holding returned the previous keyframe (and kept the device's WiFi awake between stills).
- About four concurrent sessions per camera, and no video on a fifth: a session left open makes the next capture log
  in and receive nothing - hence the close (`f1 f0`) from both sides, one reader per camera, and a slot freed on
  every refusal. A second device claiming the same camera, or a diagnostic probe, takes slots too.
- Channel-0 request indices advance by exactly one (login uses 0); a skipped index makes the camera stop answering.
- Ack every video fragment as it arrives, naming each index (one DrwAck per burst, at most 128). The camera resends
  the oldest unacknowledged fragment every ~40 ms; acking only the newest contiguous one left fragment 0 unacked and
  the stream-start keyframe unrepairable (PR #129). `FragmentAssembly` takes resends from before the first fragment.
- Give a gap up after 3 s of data arriving without it closing (`GAP_ABANDON_MS`), not 3 s of wall time, so a link
  that stalls and recovers still gets its repair; then take the next keyframe. Check every frame for SPS + IDR.
- A camera that refuses is left alone for 30 min because each try takes one of its slots, maybe a neighbour's.
- Camera and password come from the device's own record on every capture, never from a caller: a camera keyed by a
  user-editable setting once let any user read another account's camera (PR #84). No password means the default.

## RTSP capture (`capture.service.ts`, `stream-url.ts`)
- ffmpeg grabs the next keyframe without stream analysis (`-fflags nobuffer -flags low_delay -probesize 32
  -analyzeduration 0 -skip_frame nokey`, `stillArgs`), at most 90 s a run; on "Could not find codec parameters" one
  retry with a full probe (PR #88). A Terp Cam's keyframe is not read this way; it is decoded from a pipe.
- An HTTP(S) address is read without `-fflags nobuffer`, which drops what ffmpeg reads while it probes the input: a
  snapshot URL's one JPEG, so ffmpeg 8 (the server image's 8.1.2) encodes nothing ("Output file is empty"), with
  either probe. A live stream only loses its first packets. CI's Ubuntu ffmpeg is older and returns the picture
  either way, so only the unit test pinning both command lines (`capture-budget.spec.ts`) catches it (2026-10-08).
- A connection dropped mid-frame (common through a tunnel) makes ffmpeg write a smeared frame and exit 0; stderr at
  `-loglevel warning` matching `FFMPEG_CORRUPT_FRAME_PATTERN` discards it as `CorruptFrameError`, which does not grow
  the backoff - the camera answered. Error text is stripped of URL credentials before logs, diary or `lastError`.
- `getaddrinfo(): Name does not resolve` in ffmpeg's output is noise, never why a still failed: the RTSP demuxer
  parses the addresses in a camera's answers (`destination=`, `source=`, the SDP's `c=`), cheap cameras leave them
  empty, and ffmpeg carries on (2026-08-28).
- The login lives inside `url` (what ffmpeg opens) and is never served, not even to the owner. It can be sent apart
  (`username`, `password`) and is written into the URL by the server (an `@` survives); a URL sent without a login
  keeps the stored one. Transport is ffmpeg's (`tcp`, `udp`, `http`, `https`); UDP is refused through a tunnel, which
  carries TCP and one connection per device at a time ([9.2](../device-protocol.md#92-the-tunnel)), so tunnelled
  cameras of one device queue.

## Polling (`camera-poller.service.ts`)
- `stillIntervalSeconds` (default 30 s) counts from the end of the previous read; a settings change resets the
  backoff and reads at once. `PATCH` refuses less than 30 s (`still_interval_too_short`); `POST /v1/cameras` does not,
  and a camera created with less is read on every 5 s pass (code reading, 2026-10-08). The pauses are in
  [device-protocol 9](../device-protocol.md#9-the-still-cycle); only cameras read through a device are skipped while
  it is offline (Chris, 2026-10-02). Which those are is `readsThroughDevice` (`shared-types/src/v1/capture.ts`),
  which the camera page reads too: change it there, not on one side.
- The test button joins a read in flight (a Terp Cam read is the device's camera whatever the settings; an RTSP test
  with other settings reads on its own), and the poller leaves the button's read alone: a device bridges one relay
  at a time. Tests run asynchronously (202, polled every 2 s for 210 s), so no proxy needs a long timeout.
- ffmpeg lanes (`ffmpeg.ts`, beside `runFfmpeg`, which every still, decode and film runs through): one shared pool let
  Terp Cam decodes queue behind hanging streams past the test button's wait. Hanging RTSP cameras can still delay
  other RTSP reads (90 s each), inside the reader's budget. `p-limit` stays at ^3.1.0 (4+ is ESM-only).
- A missed dial-in is an ordinary failed attempt (Chris, 2026-09-30, PR #119): the former 15-min hold made a slow
  link, a busy device or a server restart look like firmware without the relay.

## Camera records (`cameras.schema.ts`, `hardware-report.service.ts`)
- The device is the source of truth for a Terp Cam, and a report reaches only rows of the reporting device's owner:
  the row live on this device, or one this owner buried for this `did`. Rows are never taken across accounts, so
  after an owner change the new owner gets a fresh row (own twelve months) and the old one keeps its stills.
- `secret` (`select: false`, never served) is the camera password. The device record keeps the last reported one too
  (`cameraSecret`): pairing reports it before the id that creates the row, and the dropped password once meant the
  default login and a 30-min hold. Unpairing resets it.
- Giving a device up (`releaseClaim`) tombstones its cameras and clears `deviceId`, `uid`, `ip` and `secret` but
  keeps `did`, so the same person pairing again gets the row and its entitlement back.
- `did`, `uid`, `ip`, `url` and `state.lastError` are served to owner and admins only; members, links and the demo
  get them redacted. A removed camera stays as a tombstone so its pictures keep their link, and nothing reads from
  it: the poller passes it by, and a test capture is 404 `camera_not_found` (`withSecret` finds live rows only).
- The old app stored a paired Terp Cam as `terpcam://<did>` (earlier `okam://<did>`) in its RTSP field; only
  migration `008-cameras` reads that (`TERPCAM_STREAM_PREFIXES` in `server/src/migrations/legacy.ts`), and it dates
  `state.lastStillAt` by the newest legacy still.

## Stills (`media`, kind `still`; storage in [data.md](data.md))
- `lit`: the controller's light output at capture time, else `false` for a picture too dark to show anything (mean
  luma under 24), else null, which counts as lit. Pictures meant to show plants (week, home, cockpit and grow cards)
  query `lit != false`; a week's day takes the lit still nearest midday.
- `monochrome` (since 2026-10-08, server-side only): whether the still came out grey - the camera's night (IR) mode,
  or a black tent - measured once when stored (`monochromeOf`, `still-light.ts`: channels under 4 of 255 apart on a
  192-pixel copy; night stills measure 0, day stills 20-53 on the development cameras); null for an unreadable
  picture, absent on older stills, both unknown, never backfilled. A smart plug without a schedule takes its VPD's
  day and night from it: the newest measured still of any camera in its space speaks for its camera for ten
  intervals plus the gap thinning has left by its age (`StillDaylightService`; Chris, 2026-10-08,
  [ADR 0006](../adr/0006-day-and-night-by-the-device-clock.md)).
- The camera burns its own local time into the picture; the app shows the account's zone, so a mismatch means the
  account's zone is wrong (Me > Appearance), not the app.
- Thinning, once a day after the films: older than 1 day one per minute, 7 days one per 5 min, 30 days one per 15 min,
  90 days one per hour (`THINNING_TIERS`, `still-thinning.ts`). Stills the previous release still holds rows for are
  left alone until the release that drops `legacy_*`. Stills go after 3 years; cameras without Premium only earlier
  where the install switches that on.

## Timelapses (`timelapse.service.ts`)
- The builder runs 60 s after start, then an hour after its previous pass ends: queued renders first (also woken
  2 s after a request), then each live camera's rolling day, week and month, cut on the owner's calendar
  (`film-periods.ts`). It walks back from the open period and stops at the first period without stills or with an
  up-to-date film, so a gap is a wall later passes never cross. A one-shot 30-day backfill after a start (Chris,
  2026-09-23) exists only on the hotfix branch `patch-2026-09-23`, not in this builder.
- The open period is rebuilt only after 1 h (day), 4 h (week) or 12 h (month) of new stills past the film's end, a
  closed one once. Frames at least 2, 14 or 60 min apart, 25 fps; fewer than 13 frames make no film. ffmpeg
  `-threads 1`, libx265; SD is 1280 wide, HD as captured; cameras without Premium get SD and a mark.
- Rebuilding loses frames once thinning has run (a day older than 7 days: ~288 frames instead of ~720), so deleting
  films to regenerate them is not free.
- A rolling film takes the size of its first frame and ffmpeg scales every later one to it, so a film across a change
  of the camera's resolution (640x360 stills from before PR #120, a stream switched) comes out at the older size; a
  composed film is drawn at the size it was asked for (PR #91).
- The composer (`POST /v1/cameras/{id}/timelapses`) queues a render and answers 202 (200 when that film exists);
  overlays and the mark are SVG composited with sharp, because ffmpeg's text filter needs fonts and freetype. A film
  of a span still running ends at its last frame, so the hourly pass carries it on and a later tap films the rest.
- A good pass logs nothing; check `media` rows of kind `timelapse` per `window` instead.

## Health, diary, app
- A camera is aged by the stills it has missed, not by `VALUE_AGE`: live up to 2, stale up to 10, then stopped
  (`CAMERA_STILLS`, `shared-types/src/v1/value-age.ts`). The camera rows, the admin health card and `camera_stale`
  all count by it; only the alarm adds a floor of 600 s.
- `camera_stale` (`alarm-health.service.ts`): one warning when a camera is quiet for max(interval x 10, 600 s); not
  judged without a first still, with `staleWarning` off (opt-out), `nightOff`, in maintenance with `maintenanceOff`,
  or while the device is offline; not raised under `workmode: off`. The alert's value is the quiet span in seconds.
- A failed scheduled read writes `message-rtsp-stream-error` to the diary only with `logErrors` on (default off).
  Firmware older than the relay logs `message-cam-capture:*` and `message-aux-command-failed:cam_capture`: the
  ingest drops `...:ok` always and the failures unless `logErrors` is on (`device-ingest.service.ts`).
- The app names a stored error with the contract's `captureFailureOf`, as the server names a failed test; the raw text
  is owner-only, it can name the tunnel's address. A failed film stores one of the `RENDER_FAILURE_TEXT` sentences
  (`capture.ts`) and the app names it by the whole sentence (`renderFailureOf`): reworded, films that failed before
  show `unknown`. The day view reads frames in pages of 200 up to 15 pages and refetches every 30 s from its newest
  picture only (`webapp/src/api/cameras.ts`).

## Configuration
- `TERPCAM_RELAY_URL`: `docker-compose.yaml` defaults it to `${API_URL_EXTERNAL}/terpcam/relay` - defaults belong
  there, not in server code (Chris, 2026-09-29); an empty value turns the relay off and with it every Terp Cam still.
- A reverse proxy passes the upgrade on `/terpcam/relay` as it would a WebSocket's:
  [ci-and-release.md](ci-and-release.md#reverse-proxy-in-front-of-the-api). nginx's `map $http_upgrade` sits in the
  `http` context (a conf.d file already is) and exists once per `http` block, so reuse a WebSocket map.
- `PREMIUM_*` (see `.env.sample`, `entitlement.service.ts`): unset gates nothing; set, they decide the served still
  width, HD and the mark on films, and an optional earlier retention for cameras whose twelve months have run out.
- Gone: the rendezvous and UDP-port variables (PR #114), relay host and port (PR #124), `IMAGE_LOAD_*` (rewrite).

## Limits and failure modes
- Firmware older than PR #124 ignores the relay `url` and gets no stills; the cloud no longer sends `cam_capture`.
  Refusal holds, test captures and reads in flight live in server memory; a restart clears them.
- Supported are cameras that answer the LAN search and send H.264 on the main stream; one with another P2P scheme
  (seen with H.265 cameras on newer camera firmware) never delivers - supporting it is a change of its own.
- "capture attempt N failed (camera did not accept the session ...); retrying on a fresh session" is mostly noise
  (about one capture in nine on dev; the retry worked, no still was lost).
- "the controller did not open the relay in time" can mean the device is online but cannot find its camera
  (`message-terp-cam-not-found` in its log); every attempt of the budget then waits in vain.
- A camera reset by hand refuses the stored password ("camera rejected the password", 30-min hold) until it is paired
  again. `cameras.state.firmwareVersion` is never written.
- Without hardware, `./simulate-device.sh run --camera` (CLAUDE.md) relays to an emulated camera: it exercises relay
  and P2P client, not the camera's quirks ([device-protocol 13](../device-protocol.md#13-where-the-witnesses-disagree)).
