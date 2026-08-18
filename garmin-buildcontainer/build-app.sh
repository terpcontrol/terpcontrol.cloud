#!/bin/bash
# Entrypoint of the Garmin build container. Expects the app sources at /src and
# writes the packaged app to /out. Run it through ../build-garmin.sh.
set -euo pipefail

SRC=/src
OUT=/out
CIQ_HOME="${HOME}/.Garmin/ConnectIQ"
APP_NAME="${GARMIN_APP_NAME:-terp-control-viewer}"

WORK="$(mktemp -d)"

# Ownership of the bind mounts is restored on the way out so the caller (and the
# CI cache step) can read back what the container wrote as root.
cleanup() {
    if [ -n "${HOST_UID:-}" ] && [ -n "${HOST_GID:-}" ]; then
        chown -R "${HOST_UID}:${HOST_GID}" "$OUT" "$CIQ_HOME" 2>/dev/null || true
    fi
    rm -rf "$WORK"
}
trap cleanup EXIT

fail() { echo "ERROR: $*" >&2; exit 1; }

# --- Signing key --------------------------------------------------------------
# Every Connect IQ build has to be signed. The store ties an app id to the key it
# was first published with, so a build meant for upload needs the real key.
KEY="$WORK/developer_key.der"
if [ -n "${GARMIN_DEVELOPER_KEY_B64:-}" ]; then
    echo "$GARMIN_DEVELOPER_KEY_B64" | tr -d '[:space:]' | base64 -d > "$KEY" \
        || fail "GARMIN_DEVELOPER_KEY_B64 is not valid base64"
elif [ "${GARMIN_ALLOW_EPHEMERAL_KEY:-0}" = "1" ]; then
    echo "No GARMIN_DEVELOPER_KEY_B64 set, generating a throwaway signing key."
    echo "The resulting .iq proves the app compiles but cannot be published."
    openssl genrsa -out "$WORK/developer_key.pem" 4096 2>/dev/null
    openssl pkcs8 -topk8 -inform PEM -outform DER \
        -in "$WORK/developer_key.pem" -out "$KEY" -nocrypt
else
    fail "GARMIN_DEVELOPER_KEY_B64 is not set. Add it to your env file (see .env.sample), or set GARMIN_ALLOW_EPHEMERAL_KEY=1 for a verification-only build."
fi

# --- Device definitions -------------------------------------------------------
# The compiler needs a definition for every product listed in the manifest.
# Garmin serves those from an authenticated endpoint, so they are downloaded once
# and then reused from the mounted $CIQ_HOME cache.
mkdir -p "$CIQ_HOME/Devices"
missing=()
while read -r product; do
    [ -d "$CIQ_HOME/Devices/$product" ] || missing+=("$product")
done < <(grep -o 'iq:product id="[^"]*"' "$SRC/manifest.xml" | sed 's/.*id="//; s/"$//')

if [ ${#missing[@]} -eq 0 ]; then
    echo "All device definitions present in the cache."
else
    echo "Fetching ${#missing[@]} missing device definition(s): ${missing[*]}"

    [ "${GARMIN_SDK_AGREEMENT_ACCEPTED:-}" = "1" ] || fail \
        "Downloading device definitions requires accepting the Garmin Connect IQ SDK License Agreement (https://developer.garmin.com/downloads/connect-iq/sdks/agreement.html). Review it, then set GARMIN_SDK_AGREEMENT_ACCEPTED=1."

    accept_args=()
    if [ -n "${GARMIN_SDK_AGREEMENT_HASH:-}" ]; then
        accept_args=(--agreement-hash "$GARMIN_SDK_AGREEMENT_HASH")
    fi
    connect-iq-sdk-manager agreement accept "${accept_args[@]+"${accept_args[@]}"}"

    if [ -n "${GARMIN_USERNAME:-}" ] && [ -n "${GARMIN_PASSWORD:-}" ]; then
        connect-iq-sdk-manager login
    elif [ ! -f "$CIQ_HOME/token.json" ]; then
        fail "GARMIN_USERNAME/GARMIN_PASSWORD are not set and no cached login exists. Garmin only serves device definitions to logged-in developer accounts."
    fi

    connect-iq-sdk-manager device download --manifest "$SRC/manifest.xml"
fi

# --- Build --------------------------------------------------------------------
# Built from a copy so the compiler's intermediate output never lands in the
# (read-only) source mount.
mkdir -p "$WORK/app" "$OUT"
cp -a "$SRC/." "$WORK/app/"
cd "$WORK/app"

echo "Connect IQ SDK $(cat /opt/connectiq/bin/version.txt)"
monkeyc -f monkey.jungle -o "$OUT/${APP_NAME}.iq" -y "$KEY" -e -w

ls -l "$OUT/${APP_NAME}.iq"
