#!/bin/bash
# Stops the stack and removes its containers and network.
#
# The databases live in named volumes and are kept - `./down.sh --volumes`
# throws them away, which is how you get an empty stack back.
set -e

cd "$(dirname "${BASH_SOURCE[0]}")"
. scripts/compose.sh

terpcontrol_compose down "$@"
