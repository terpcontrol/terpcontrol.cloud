#!/bin/bash
# Moves the pictures, timelapses and exports of this stack from MongoDB (GridFS)
# into the S3 bucket configured in the env file (S3_*), see
# docs/knowledge/data.md. `--keep` copies without deleting anything from
# MongoDB, `--dry-run` only counts. It can run while the stack is up, before or
# after the server has been restarted with the bucket, and again after a stop.
#
# It runs in a container of its own from the server image, so it reads the env
# file as it is now rather than the one the running server was started with.
set -e

cd "$(dirname "${BASH_SOURCE[0]}")"
. scripts/compose.sh

terpcontrol_container mongodb >/dev/null
terpcontrol_compose run --rm --build --no-deps server npm run --silent media:to-s3 -- "$@"
