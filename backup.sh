#!/bin/bash
# Writes <name>.mongodump and <name>.influxdump (see docs/runbooks/backup-and-restore.md).
#
# The disk the backup is written to is usually the one the databases live on. A
# backup that fills it takes down MongoDB and InfluxDB of every stack there, so
# this script keeps its peak low and refuses rather than run the disk full:
# - the Mongo dump is streamed out of the container, never written inside it;
# - the InfluxDB backup has to be a directory in the container first, its tar is
#   streamed out, and the directory is removed before the Mongo dump starts;
# - before each step it estimates the size from the database and stops when the
#   free space minus BACKUP_RESERVE_GB (default 5) would not hold it;
# - whatever happens, it removes what it left in the containers, and a file it
#   did not finish is removed too: only complete backups keep their name.
set -eo pipefail
BACKUP_TARGET="$1"

. "$(dirname "${BASH_SOURCE[0]}")/scripts/compose.sh"
. "$(dirname "${BASH_SOURCE[0]}")/scripts/mongodb.sh"

if [ -z "${BACKUP_FILENAME:-}" ]; then
    export BACKUP_FILENAME="backup-$(date +%F_%H-%M-%S)"
fi
RESERVE_KB=$(( ${BACKUP_RESERVE_GB:-5} * 1024 * 1024 ))

terpcontrol_container mongodb >/dev/null
[ "$BACKUP_TARGET" = mongo ] || terpcontrol_container influxdb >/dev/null

PARTIAL=""
cleanup() {
    local status=$?
    if [ "$BACKUP_TARGET" != "mongo" ]; then
        terpcontrol_compose exec -T influxdb rm -rf /influxdb-backup.tar /influxdb-backup/ >/dev/null 2>&1 || true
    fi
    if [ -n "$PARTIAL" ]; then
        rm -f "$PARTIAL"
    fi
    [ "$status" -eq 0 ] || echo "BACKUP FAILED: ${BACKUP_FILENAME}" >&2
}
trap cleanup EXIT

# Free kilobytes on the filesystem of a host path.
free_kb_host() {
    df -Pk "$1" | awk 'NR == 2 { print $4 }'
}

# Free kilobytes on the root filesystem of a service's container.
free_kb_in() {
    terpcontrol_compose exec -T "$1" df -Pk / | awk 'NR == 2 { print $4 }'
}

# Fails, saying so, unless $2 kilobytes plus the reserve fit into $3 free ones.
require_space() {
    local what="$1" need_kb="$2" free_kb="$3"
    if [ $(( need_kb + RESERVE_KB )) -gt "$free_kb" ]; then
        echo "Error: not enough disk space for $what: about $(( need_kb / 1024 / 1024 )) GB needed" \
            "plus a reserve of ${BACKUP_RESERVE_GB:-5} GB, $(( free_kb / 1024 / 1024 )) GB free." >&2
        return 1
    fi
}

TARGET_DIR="$(dirname "$BACKUP_FILENAME")"

if [ "$BACKUP_TARGET" != "mongo" ]; then
    # The backup copies the TSM files, so the engine directory is an upper bound.
    influx_kb="$(terpcontrol_compose exec -T influxdb du -sk /var/lib/influxdb2/engine | awk '{ print $1 }')"
    require_space "the InfluxDB backup in its container" "$influx_kb" "$(free_kb_in influxdb)"
    # Container and host file are usually on the same disk: both count there.
    require_space "the InfluxDB backup" "$(( influx_kb * 2 ))" "$(free_kb_host "$TARGET_DIR")"

    terpcontrol_compose exec -T influxdb rm -rf /influxdb-backup.tar /influxdb-backup/
    terpcontrol_compose exec -T influxdb influx backup --token "$INFLUXDB_TOKEN" /influxdb-backup
    PARTIAL="${BACKUP_FILENAME}.influxdump.partial"
    terpcontrol_compose exec -T influxdb tar cf - /influxdb-backup > "$PARTIAL"
    mv "$PARTIAL" "${BACKUP_FILENAME}.influxdump"
    PARTIAL=""
    terpcontrol_compose exec -T influxdb rm -rf /influxdb-backup/
fi

if [ "$BACKUP_TARGET" != "influx" ]; then
    # An archive is uncompressed BSON, about the data size of all databases.
    # shellcheck disable=SC2016 # Evaluated by the mongo shell.
    mongo_bytes="$(mongodb_eval 'let s = 0; db.adminCommand({listDatabases: 1}).databases.forEach(function (d) {
        s += db.getSiblingDB(d.name).stats().dataSize }); s' | tr -dc '0-9')"
    [ -n "$mongo_bytes" ] || { echo "Error: could not ask MongoDB for its data size." >&2; exit 1; }
    require_space "the MongoDB dump" "$(( mongo_bytes / 1024 ))" "$(free_kb_host "$TARGET_DIR")"

    PARTIAL="${BACKUP_FILENAME}.mongodump.partial"
    terpcontrol_compose exec -T mongodb mongodump \
        --username "$MONGODB_ADMINUSERNAME" \
        --password "$MONGODB_ADMINPASSWORD" \
        --quiet \
        --archive > "$PARTIAL"
    mv "$PARTIAL" "${BACKUP_FILENAME}.mongodump"
    PARTIAL=""
fi

echo "BACKUP SUCCESSFUL: ${BACKUP_FILENAME}"
