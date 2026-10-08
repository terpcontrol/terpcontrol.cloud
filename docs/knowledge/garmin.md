---
summary: The Garmin Connect IQ widget in garmin/ - which API routes it calls, the watch platform's limits, releasing it, build pitfalls beyond AGENTS.md and the README, and what is still open
updated: 2026-10-08
source: Chris (2026-09-17, the widget moves with the API, publishing is his); agents' PRs #59, #61, #71, #81, #104 and sessions 2026-08..10; CI logs of 2026-08-24 and 2026-10-04; checked against the code 2026-10-08
paths:
  - garmin/**
  - garmin-buildcontainer/**
  - build-garmin.sh
---
# Garmin widget

`garmin/` is a Connect IQ widget for Garmin watches and Edge computers. It shows one device of the account at a
time: a page of latest values (also the glance), charts from 10 minutes to a month, the newest still of the
device's camera, and its maintenance window, which it can start or end. The manifest lists 71 products, which
monkeyc builds as 92 device targets.

Building it, the `GARMIN_*` variables and the signing key are covered by `AGENTS.md` and `README.md` (both under
"Garmin viewer app") and `.env.sample`; how CI and the deploy build it, by [ci-and-release.md](ci-and-release.md)
and the comments in the workflows, `build-garmin.sh` and `garmin-buildcontainer/`. Not repeated here.

## Releasing

- Publishing to the Connect IQ store is manual and Chris's; an agent never uploads. He takes the `.iq` the deploy
  run attaches, which is signed with the key the app was first published with.
- **Publish the widget before the server it calls changes.** Watches run the store version, and the server keeps
  no route for an older one: ADR 0001 moved the widget to `/v1` together with the API and dropped the old routes
  (decided 2026-09-17). A widget built before the app rewrite (#104) cannot talk to a server that runs it.

## What it calls

Everything goes to the watch setting `api_base_url_prop` plus `/v1` (`apiUrl()` in `TerpControlApi.mc`); the
device-protocol routes are never used.

| Call | For |
| --- | --- |
| `POST /v1/sessions` with `email`, `password` | `userToken` (bearer for everything else) and `mediaToken` (pictures) |
| `GET /v1/devices`, `GET /v1/cameras` | the device list and which camera hangs where; cached in `Storage` |
| `GET /v1/devices/{id}/live` | the values page and the glance |
| `GET /v1/devices/{id}/series` | charts, one series per request and at most 25 points; the outputs' latest state |
| `GET /v1/cameras/{id}/frames?limit=1`, then `GET /v1/media/{id}/content?token=<mediaToken>&width=&height=` | the webcam page |
| `POST /v1/devices/{id}/commands` with `{"kind": "maintenance", "forSeconds": n}` | start a maintenance window, or end it with 0 |

A server change to any of these routes or shapes changes the widget in the same pull request (ADR 0001, "Clients in
this repository that move with the API").

## Platform limits

- The watch does not fetch pictures itself: it hands the URL to the paired phone, which fetches and transcodes the
  image. An image request carries no headers of ours, so the token travels in the query.
- A long picture URL (about 400 characters with a JWT in the query) failed on a real watch with 404 in 2026-08,
  while the same URL worked in the simulator and a browser; its length was the suspected cause. A short URL with an
  HMAC token and no query (PR #59) was closed without merging. The `/v1` media URL still carries a JWT, so whether
  the webcam page works on a real watch is unverified.
- The Connect IQ JSON parser cannot represent a millisecond epoch exactly. Hand the watch ISO 8601 instants, which
  it parses with `TerpControlUtils.parseISODate()`, or seconds: it counts the maintenance window down from
  `state.maintenanceUntil`.
- The maintenance menu offers *End now* and 5 to 120 minutes in nine graduated steps, because a list of
  five-minute steps does not scroll on a watch.

## The Garmin login

The per-device compiler definitions come only to a logged-in developer account, and CI caches them
([ci-and-release.md](ci-and-release.md)). Besides a new product, a cache GitHub dropped after seven days unused
makes CI log in again with the `GARMIN_USERNAME`/`GARMIN_PASSWORD` secrets; that worked from a cold cache on
2026-08-24. If it ever fails with `could not login: unknown reason for login failure`, the account most likely has
two-factor authentication or Garmin challenged the datacenter address - connect-iq-sdk-manager-cli v0.8.4 has no
MFA handling. Then fetch the definitions once on a machine that can complete the login (the CLI's browser login
handles MFA) and seed the cache from there.

## Open

- Starting or ending maintenance shows a failure on the watch although it worked: `onReceiveSetMaintenance()`
  accepts 200 and 201, and `POST /v1/devices/{id}/commands` answers 202. Found reading the code on 2026-10-08,
  not tried on a watch.
- The token is never reused across launches: `doObtainToken()` stores `tokenUsername` from `params["username"]`,
  a key the login parameters do not have, so `initialize()` never matches it. Every start of the widget or the
  glance logs in again, and every login opens a new session on the server. Found the same way.
- Chris asked on 2026-10-04 to remove the warnings from the CI logs; the Garmin ones were only deduplicated. 81
  distinct ones remain: 42 untyped `Dictionary`/`Array` accesses, most in `TerpControlApi.mc` (type them, e.g.
  `as Dictionary<String, Object?>`), 3 unreachable statements, 15 launcher-icon scalings, the glance entry point
  (annotate `TerpControlApp` with `(:glance)`), and 20 about glances being unsupported on two products.
