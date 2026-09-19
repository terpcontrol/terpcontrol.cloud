#!/bin/bash
set -e

. "$(dirname "${BASH_SOURCE[0]}")/scripts/load-env.sh"
terpcontrol_load_env

docker build -t plantalytix-buildcontainer fw-buildcontainer

DOCKER_USB_MOUNTS=${DOCKER_USB_MOUNTS:--v /dev/bush/usb:/dev/bus/usb --device /dev/ttyUSB0:/dev/ttyUSB0}

docker run -i --rm \
  --privileged \
  ${DOCKER_USB_MOUNTS} \
  plantalytix-buildcontainer pio device monitor -p /dev/ttyUSB0
