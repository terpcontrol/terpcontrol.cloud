#!/bin/bash
set -e

. "$(dirname "${BASH_SOURCE[0]}")/scripts/compose.sh"

if [ -z "$BACKUP_FILENAME" ]; then
    export BACKUP_FILENAME="$1"

    if [ -z "$BACKUP_FILENAME" ]; then
        echo "Error: Backup filename not provided."
        echo "Usage: $0 <backup-filename-without-extension>"
        exit 1
    fi
fi

if [[ $BACKUP_FILENAME == *.mongodump ]]; then
  MONGO_FILENAME="$BACKUP_FILENAME"
  INFLUX_FILENAME=""
elif [[ $BACKUP_FILENAME == *.influxdump ]]; then
  MONGO_FILENAME=""
  INFLUX_FILENAME="$BACKUP_FILENAME"
else
  MONGO_FILENAME="${BACKUP_FILENAME}.mongodump"
  INFLUX_FILENAME="${BACKUP_FILENAME}.influxdump"
fi


if [ -n "$MONGO_FILENAME" ]; then
  MONGO_CONTAINER="$(terpcontrol_container mongodb)"

  docker cp "$MONGO_FILENAME" "$MONGO_CONTAINER":/backup.mongodump
  # --drop drops only the collections the archive carries. A dump taken before
  # the data model was rewritten carries no `migrations` collection, so whatever
  # this database already had of one survives the restore - and a record saying
  # every migration has run is how the server decides there is nothing to do.
  # It refuses to start on that rather than serving the restored shapes, and
  # says what to do: drop `migrations` and `migrationLock` and start it again,
  # unless the database was migrated already - then the `legacy_*` copies the
  # migration left survive beside the restored ones and the server cannot tell
  # which generation to keep. Restoring into an empty database (`./down.sh
  # --volumes` first) avoids the question altogether.
  terpcontrol_compose exec mongodb mongorestore \
      --drop \
      --archive=/backup.mongodump \
      --nsInclude="${MONGODB_DATABASE}.*" \
      "mongodb://${MONGODB_ADMINUSERNAME}:${MONGODB_ADMINPASSWORD}@localhost:27017"
  terpcontrol_compose exec mongodb rm -rf /backup.mongodump || true
fi

if [ -n "$INFLUX_FILENAME" ]; then
  INFLUX_CONTAINER="$(terpcontrol_container influxdb)"

  terpcontrol_compose exec -T influxdb rm -rf /influxdb-backup.tar /influxdb-backup/ || true
  docker cp "$INFLUX_FILENAME" "$INFLUX_CONTAINER":/influxdb-backup.tar
  terpcontrol_compose exec influxdb tar xf /influxdb-backup.tar
  # The token is passed explicitly: the image writes the CLI's config (with the
  # admin token) to /etc/influxdb2 only on first-time setup, and that path is not
  # a volume, so a recreated container has the data but no CLI config and the
  # tokenless CLI fails with 401 Unauthorized.
  terpcontrol_compose exec influxdb influx bucket delete --token "$INFLUXDB_TOKEN" -n "${INFLUXDB_BUCKET}" -o "${INFLUXDB_ORG}"
  terpcontrol_compose exec influxdb influx restore --token "$INFLUXDB_TOKEN" --bucket="${INFLUXDB_BUCKET}" --org="${INFLUXDB_ORG}" /influxdb-backup
  terpcontrol_compose exec -T influxdb rm -rf /influxdb-backup.tar /influxdb-backup/ || true
fi

echo "RESTORE SUCCESSUL: ${BACKUP_FILENAME}"