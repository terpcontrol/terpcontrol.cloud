#!/bin/sh
# Waits for a compose service to report healthy, and fails if it does not.
#
#   ./scripts/wait-for-healthy.sh server [timeout-seconds]
#
# `docker compose up -d` answers as soon as the containers are started, which
# says nothing about whether the server came up: one that exits on a bad
# environment or cannot reach the database is restarted forever by
# `restart: always` while the deploy that shipped it reports success. This is
# what turns that into a failed deploy, and it prints the container's own
# reasons when it fails so the log is in the job rather than only on the host.
#
# COMPOSE_OPTIONS and TERPCONTROL_ENV_FILE are read the way the deploy passes
# them to `docker compose`, so this reads the same project as the deploy did.
set -eu

SERVICE="${1:?usage: wait-for-healthy.sh <service> [timeout-seconds]}"
TIMEOUT="${2:-300}"

# shellcheck disable=SC2086 # both are command-line flags, not one argument.
compose() {
    docker compose ${COMPOSE_OPTIONS:-} ${TERPCONTROL_ENV_FILE:+--env-file "$TERPCONTROL_ENV_FILE"} "$@"
}

CONTAINER="$(compose ps -q "$SERVICE")"
if [ -z "$CONTAINER" ]; then
    echo "No container is running for the '$SERVICE' service" >&2
    exit 1
fi

# A service with no healthcheck reports its plain state, so this is still a
# check that it is running rather than a wait that always passes.
state() {
    docker inspect -f '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}' "$CONTAINER"
}

DEADLINE=$(($(date +%s) + TIMEOUT))
while :; do
    STATE="$(state)"
    case "$STATE" in
        healthy | running)
            echo "The '$SERVICE' service is $STATE"
            exit 0
            ;;
        exited | dead)
            # Restarting forever looks like 'restarting' rather than this, so
            # reaching here means it has given up entirely.
            echo "The '$SERVICE' service is $STATE" >&2
            break
            ;;
    esac

    if [ "$(date +%s)" -ge "$DEADLINE" ]; then
        echo "The '$SERVICE' service was still '$STATE' after ${TIMEOUT}s" >&2
        break
    fi

    sleep 5
done

# Whatever it last said for itself, which is the point of failing here at all.
docker inspect -f '{{if .State.Health}}{{range .State.Health.Log}}{{.Output}}{{end}}{{end}}' "$CONTAINER" >&2 || true
compose logs --tail 50 "$SERVICE" >&2 || true
exit 1
