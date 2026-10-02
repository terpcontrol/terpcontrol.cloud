#!/bin/bash
# Upgrades the MongoDB data to the release of the image compose runs it from -
# the default in docker-compose.yaml, or DOCKER_MONGODB_IMAGE in .env.
#
# MongoDB moves forward one supported release at a time: the next release is
# started on the data as it is, and only then is the featureCompatibilityVersion
# (FCV) raised to it. Until that last part a step can be undone by starting the
# previous image again, which is what happens when a release does not come up
# (MongoDB 5.0 and later need AVX on x86 and ARMv8.2-A on ARM). Raising the FCV
# cannot be undone, so the data is backed up before the first step; going back
# from there is ./restore.sh with that backup.
#
# The rest of the stack keeps running and reconnects after each restart.
#
# When the default image in docker-compose.yaml moves to a newer release, the
# steps below have to learn the way there.
set -euo pipefail
trap 'echo "upgrade-mongodb.sh failed at line $LINENO." >&2' ERR

cd "$(dirname "${BASH_SOURCE[0]}")"
. scripts/compose.sh
. scripts/mongodb.sh

# The release that follows an FCV on the way up. Rapid releases (8.2, 8.3) are
# only on the path for data that is already on one.
next_release() {
    case "$1" in
        4.4) echo 5.0 ;;
        5.0) echo 6.0 ;;
        6.0) echo 7.0 ;;
        7.0) echo 8.0 ;;
        8.0) echo 9.0 ;;
        8.2) echo 8.3 ;;
        8.3) echo 9.0 ;;
        *) return 1 ;;
    esac
}

# Recreates the mongodb container from an image and waits for it to be healthy.
run_on() {
    DOCKER_MONGODB_IMAGE="$1" terpcontrol_compose up -d --no-deps --force-recreate mongodb >/dev/null 2>&1
    mongodb_wait_healthy 180
}

TARGET_IMAGE="$(mongodb_image)"
TARGET="$(mongodb_image_version "$TARGET_IMAGE")"
[ -n "$TARGET" ] || { echo "Cannot tell the MongoDB release of $TARGET_IMAGE." >&2; exit 1; }

FCV="$(mongodb_fcv)" || { echo "Cannot read the featureCompatibilityVersion of the MongoDB data." >&2; exit 1; }
if [ -z "$FCV" ]; then
    echo "There is no MongoDB data yet, so there is nothing to upgrade."
    exit 0
elif [ "$FCV" = "$TARGET" ]; then
    echo "The MongoDB data is already at $TARGET."
    run_on "$TARGET_IMAGE"
    exit 0
elif mongodb_version_lt "$TARGET" "$FCV"; then
    echo "The MongoDB data is at $FCV, newer than $TARGET_IMAGE (MongoDB $TARGET). Nothing to upgrade." >&2
    exit 1
fi

STEPS=()
VERSION="$FCV"
while [ "$VERSION" != "$TARGET" ]; do
    VERSION="$(next_release "$VERSION")" || { echo "No known upgrade from MongoDB $FCV to $TARGET." >&2; exit 1; }
    if mongodb_version_lt "$TARGET" "$VERSION"; then
        echo "No known upgrade from MongoDB $FCV to $TARGET." >&2
        exit 1
    fi
    STEPS+=("$VERSION")
done
echo "Upgrading the MongoDB data from $FCV to $TARGET via ${STEPS[*]}."

# The data's own release is the one image sure to open it, and the backup needs
# a running mongod - the current container may be one that refuses to start.
CURRENT="$FCV"
run_on "mongo:$CURRENT" || { echo "MongoDB $CURRENT does not start on the data." >&2; exit 1; }

BACKUP_FILENAME="backup-$(date +%F_%H-%M-%S)-mongodb-$FCV"
BACKUP_FILENAME="$BACKUP_FILENAME" ./backup.sh mongo
echo "Backed up to $BACKUP_FILENAME.mongodump."

for STEP in "${STEPS[@]}"; do
    echo "Starting MongoDB $STEP on FCV $CURRENT..."
    if ! run_on "mongo:$STEP"; then
        terpcontrol_compose logs --tail 20 mongodb >&2 || true
        echo "MongoDB $STEP did not come up; going back to $CURRENT. The data is unchanged." >&2
        run_on "mongo:$CURRENT" || true
        exit 1
    fi

    # Since 7.0 raising the FCV has to be confirmed, as it cannot be undone.
    CONFIRM=""
    mongodb_version_lt "$STEP" 7.0 || CONFIRM=", confirm: true"
    mongodb_eval "db.adminCommand({ setFeatureCompatibilityVersion: '$STEP'$CONFIRM }).ok" >/dev/null
    CURRENT="$(mongodb_fcv)"
    [ "$CURRENT" = "$STEP" ] || { echo "The FCV is $CURRENT after setting it to $STEP." >&2; exit 1; }
    echo "The MongoDB data is at $STEP."
done

run_on "$TARGET_IMAGE" || { echo "$TARGET_IMAGE did not come up." >&2; exit 1; }
echo "Done: MongoDB runs $TARGET_IMAGE on data at $TARGET."
