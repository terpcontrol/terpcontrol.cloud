#!/bin/bash
# Pulls, builds and starts the stack - the whole of it, or only the services
# named as arguments (`./up.sh server webapp`).
#
# Containers are recreated even when compose sees no reason to. Compose keeps a
# container whose image id and configuration hash are unchanged, so a service
# that reads a mounted config file, a container that has been sitting in a bad
# state for a week, or one built from an image tag compose already knows,
# survives an update that was supposed to replace it. Forcing the recreate is
# what makes "it was deployed" and "it is running the new code" the same thing.
#
# A failing pull stops the script rather than falling back to the images that
# happen to be on the host: an update that could not fetch what it is supposed to
# run has not run it.
set -e

cd "$(dirname "${BASH_SOURCE[0]}")"
. scripts/compose.sh

terpcontrol_compose pull "$@"
terpcontrol_compose build "$@"
terpcontrol_compose up -d --force-recreate --remove-orphans "$@"
