#!/bin/bash
# Builds the Garmin Connect IQ viewer app (garmin/) inside a container and drops
# the packaged app into garmin/bin/. Upload the resulting .iq to the Connect IQ
# store manually.
set -e

. "$(dirname "${BASH_SOURCE[0]}")/scripts/load-env.sh"
. "$(dirname "${BASH_SOURCE[0]}")/scripts/quietly.sh"
terpcontrol_load_env

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
OUT_DIR="${GARMIN_OUT_DIR:-$ROOT/garmin/bin}"

# Device definitions and the Garmin login token are cached here between builds so
# only the first build has to talk to Garmin.
CACHE_DIR="${GARMIN_CACHE_DIR:-$HOME/.Garmin/ConnectIQ}"

mkdir -p "$OUT_DIR" "$CACHE_DIR/Devices"

echo "Building the Garmin build container..."
if [ -n "$GARMIN_BUILDCONTAINER_CACHE_FROM" ] || [ -n "$GARMIN_BUILDCONTAINER_CACHE_TO" ]; then
  BUILDX_ARGS=""
  if [ -n "$GARMIN_BUILDCONTAINER_CACHE_FROM" ]; then
    BUILDX_ARGS="$BUILDX_ARGS --cache-from=$GARMIN_BUILDCONTAINER_CACHE_FROM"
  fi
  if [ -n "$GARMIN_BUILDCONTAINER_CACHE_TO" ]; then
    BUILDX_ARGS="$BUILDX_ARGS --cache-to=$GARMIN_BUILDCONTAINER_CACHE_TO"
  fi
  quietly docker buildx build $BUILDX_ARGS --load -t terpcontrol-garmin-buildcontainer "$ROOT/garmin-buildcontainer"
else
  quietly docker build -t terpcontrol-garmin-buildcontainer "$ROOT/garmin-buildcontainer"
fi

docker run --rm \
  -v "$ROOT/garmin:/src:ro" \
  -v "$OUT_DIR:/out" \
  -v "$CACHE_DIR:/root/.Garmin/ConnectIQ" \
  -e GARMIN_USERNAME \
  -e GARMIN_PASSWORD \
  -e GARMIN_DEVELOPER_KEY_B64 \
  -e GARMIN_SDK_AGREEMENT_ACCEPTED \
  -e GARMIN_SDK_AGREEMENT_HASH \
  -e GARMIN_ALLOW_EPHEMERAL_KEY \
  -e GARMIN_APP_NAME \
  -e HOST_UID="$(id -u)" \
  -e HOST_GID="$(id -g)" \
  terpcontrol-garmin-buildcontainer
