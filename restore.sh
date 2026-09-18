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
  MONGO_CONTAINER="$(terpcontrol_compose ps -q mongodb)"
  if [ -z "$MONGO_CONTAINER" ]; then
      echo "Error: MongoDB container is not running."
      exit 1
  fi

  docker cp "$MONGO_FILENAME" "$MONGO_CONTAINER":/backup.mongodump
  terpcontrol_compose exec mongodb mongorestore \
      --drop \
      --archive=/backup.mongodump \
      --nsInclude="${MONGODB_DATABASE}.*" \
      "mongodb://${MONGODB_ADMINUSERNAME}:${MONGODB_ADMINPASSWORD}@localhost:27017"
  terpcontrol_compose exec mongodb rm -rf /backup.mongodump || true
fi

if [ -n "$INFLUX_FILENAME" ]; then
  INFLUX_CONTAINER="$(terpcontrol_compose ps -q influxdb)"
  if [ -z "$INFLUX_CONTAINER" ]; then
      echo "Error: InfluxDB container is not running."
      exit 1
  fi

  terpcontrol_compose exec -T influxdb rm -rf /influxdb-backup.tar /influxdb-backup/ || true
  docker cp "$INFLUX_FILENAME" "$INFLUX_CONTAINER":/influxdb-backup.tar
  terpcontrol_compose exec influxdb tar xf /influxdb-backup.tar
  terpcontrol_compose exec influxdb influx bucket delete -n "${INFLUXDB_BUCKET}" -o "${INFLUXDB_ORG}"
  terpcontrol_compose exec influxdb influx restore --bucket="${INFLUXDB_BUCKET}" --org="${INFLUXDB_ORG}" /influxdb-backup
  terpcontrol_compose exec -T influxdb rm -rf /influxdb-backup.tar /influxdb-backup/ || true
fi

echo "RESTORE SUCCESSUL: ${BACKUP_FILENAME}"