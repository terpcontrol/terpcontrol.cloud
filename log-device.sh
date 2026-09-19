#!/bin/bash
set -e

. "$(dirname "${BASH_SOURCE[0]}")/scripts/load-env.sh"
terpcontrol_load_env

docker build -t plantalytix-buildcontainer fw-buildcontainer

# Local, uncommitted USB setup (e.g. a non-default DOCKER_USB_MOUNTS for this host).
INIT_USB_LOCAL="$(dirname "${BASH_SOURCE[0]}")/init-usb.local.sh"
[ -f "$INIT_USB_LOCAL" ] && . "$INIT_USB_LOCAL"

DOCKER_USB_MOUNTS=${DOCKER_USB_MOUNTS:--v /dev/bus/usb:/dev/bus/usb --device /dev/ttyUSB0:/dev/ttyUSB0}

docker run -it --rm \
  --privileged \
  ${DOCKER_USB_MOUNTS} \
  plantalytix-buildcontainer pio device monitor -p /dev/ttyUSB0 -b 115200
