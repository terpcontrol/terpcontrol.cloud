#!/bin/bash
# Asks whether the database can be migrated by the code in this checkout, and
# writes nothing: the preflight the server runs before its boot migration, on
# its own (server/src/migrations/README.md). Run it after `git pull` and before
# `./up.sh`. Whatever it lists has to be cleaned up first, because the migration
# refuses to start on it and the server would not come up.
#
# The server image is built from this checkout for it, so the check is made by
# the code that is about to run rather than the code that is running. It reads
# the running database, so the stack has to be up; through compose.sh, so it
# reads the same stack ./up.sh brings up.
set -e

cd "$(dirname "${BASH_SOURCE[0]}")"
. scripts/compose.sh

terpcontrol_compose run --rm --build --no-deps server npm run migrate:check
