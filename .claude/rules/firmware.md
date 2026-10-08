---
paths:
  - firmware/**
  - fw-buildcontainer/**
  - build-fw.sh
  - provision-fw.sh
---
Before changing the firmware read `docs/knowledge/firmware.md`; for how a fridge or controller regulates,
`docs/knowledge/firmware-regulation.md`; for sockets, `docs/knowledge/smart-sockets.md`; for the camera code
(`terpcam.*`), `docs/knowledge/terp-cam.md`. What a device says to the cloud is a frozen contract:
`docs/device-protocol.md`, section 12 says how to extend it. Firmware changes go through `/firmware-check` before they
are merged.
