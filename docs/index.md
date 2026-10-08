# Knowledge base

What people and agents know about the Terp Control software that the code does not say. `CLAUDE.md` loads this file
into every session; read a document when its line says you need it. How the knowledge base works - and why company
matters are not kept here - is [ADR 0003](adr/0003-knowledge-base.md).

## Decisions (`adr/`)
- [0001 Data model and API](adr/0001-app-rewrite-data-model.md) - before changing a collection, a /v1 route, the access rule or a migration step
- [0002 Web app libraries and look](adr/0002-app-rewrite-frontend-stack.md) - before adding a webapp dependency or changing the build, the service worker or the brand look
- [0003 Knowledge base](adr/0003-knowledge-base.md) - how `docs/` works, what belongs here and what in the private repository, the hooks and skills
- [0004 Server on NestJS and Fastify](adr/0004-server-on-nestjs-and-fastify.md) - before touching the server's wiring, configuration or HTTP layer
- [0005 Device times on the wall clock](adr/0005-device-times-on-the-wall-clock.md) - before touching a time of day in a device document or the summer-time shift
- [0006 Day and night by the device clock](adr/0006-day-and-night-by-the-device-clock.md) - before deciding day/night anywhere outside the firmware, a plug's and a fan's VPD included
- [0007 Germination in the dark](adr/0007-germination-in-the-dark.md) - before touching germination, `breed` or the humidifier rules

## Contracts
- [Device protocol](device-protocol.md) - before changing anything a device and the cloud say to each other; what is frozen and how to extend it

## Knowledge (`knowledge/`)
- [Firmware](knowledge/firmware.md) - building, flashing, OTA and update channels, memory and NVS limits, connection loss, safety stops
- [Firmware regulation](knowledge/firmware-regulation.md) - how a fridge or tent controller regulates: work modes, ramps, CO2, lamp dimming, dehumidifier, cooling
- [Smart sockets](knowledge/smart-sockets.md) - pairing, driving and reporting Tasmota sockets, and the stand-alone plug
- [Terp Cam and other cameras](knowledge/terp-cam.md) - camera pairing, the device relay, RTSP capture, stills, timelapses, limits and failure modes
- [Server](knowledge/server.md) - process and boot, configuration, the /v1 contract, sessions, demo mode, share links, media, broker, security decisions
- [Server engines](knowledge/server-engines.md) - alarms and notifications, device settings and plans, the read models screens judge by
- [Data](knowledge/data.md) - MongoDB pitfalls, GridFS pictures, InfluxDB, retention and cleanup, exports
- [Data operations](knowledge/data-operations.md) - MongoDB upgrades, migration runs, legacy shapes in real databases, backups
- [Web app](knowledge/webapp.md) - layout and routes, build and dev server, API client and session, charts, media URLs, PWA, lint and tests
- [Time and language in the web app](knowledge/webapp-time-and-language.md) - server clock, zones, date and figure formats, i18next mechanics
- [How the app behaves and looks](knowledge/app-ux.md) - before changing a screen: one design, honest states, value ages, controls, help texts, charts
- [How the app speaks](knowledge/app-wording.md) - before writing a catalogue string: du-form, one word per thing, numbers, dates and units
- [Garmin widget](knowledge/garmin.md) - the Connect IQ widget, the routes it calls, its build and release
- [CI and release](knowledge/ci-and-release.md) - CI jobs, images, deploys and firmware releases; when a job or a deploy fails
- [Testing](knowledge/testing.md) - the suites and their pitfalls, the simulator beyond `CLAUDE.md`, test stacks, browser checks
- [Testing with real devices and data](knowledge/testing-real-devices-and-data.md) - /firmware-check, the development devices, copies of production data
- [Development workflow](knowledge/development-workflow.md) - branches, pushing, review comments, rounds, commit and PR texts, what needs Chris's word
- [The app rewrite](app-rewrite-handover.md) - the rewrite is complete: where its knowledge lives and what it left open

## Runbooks (`runbooks/`)
- [Backup and restore](runbooks/backup-and-restore.md) - a backup or restore beyond the README's commands
- [Test against a production backup](runbooks/test-against-a-production-backup.md) - verifying a migration or the app on real data without reaching real people
- [Upgrade a pre-rewrite install](runbooks/upgrade-a-pre-rewrite-install.md) - a self-hosted install from before October 2026 takes its first update
- [MongoDB upgrade](runbooks/mongodb-upgrade.md) - `./up.sh` stops on the MongoDB data, or the supported MongoDB release is raised
- [MQTTS certificates](runbooks/mqtts-certificates.md) - a certificate nears its end, MQTTS is switched, or the CA key is at stake
- [Production hotfix](runbooks/production-hotfix.md) - production needs a fix but cannot take master yet
- [Restore device settings](runbooks/restore-device-config.md) - a device's settings were changed by accident
- [Connect a device](runbooks/connect-a-device.md) - a device is set up, moved to another server, claimed, or refuses to register
