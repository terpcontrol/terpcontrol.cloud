#!/bin/bash
# Stops the stack, or only the services named as arguments (`./stop.sh server`),
# and keeps the containers so `./up.sh` picks the same ones back up.
#
# This is the one to run before a backup: it leaves the databases alone but
# stops anything writing to them.
set -e

cd "$(dirname "${BASH_SOURCE[0]}")"
. scripts/compose.sh

terpcontrol_compose stop "$@"
