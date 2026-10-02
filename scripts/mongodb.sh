# shellcheck shell=bash
# Helpers for keeping the MongoDB data and the image that runs it in step.
# Meant to be SOURCED after compose.sh.
#
# MongoDB only starts on data whose featureCompatibilityVersion (FCV) its own
# release accepts - its own version and one or two before it - and only ever
# moves forward one supported release at a time. Pulling a newer image than the
# data allows leaves mongod refusing to start, so up.sh compares the two before
# it recreates the container, and upgrade-mongodb.sh walks the data forward.

# The image compose runs the mongodb service from, after .env overrides.
mongodb_image() {
    terpcontrol_compose config --images mongodb 2>/dev/null
}

# The major.minor release inside an image, or nothing for an image that does not
# say (the unofficial Raspberry Pi builds), which the callers then cannot check.
mongodb_image_version() {
    docker image inspect "$1" >/dev/null 2>&1 || docker pull -q "$1" >/dev/null
    docker image inspect -f '{{range .Config.Env}}{{println .}}{{end}}' "$1" |
        sed -n 's/^MONGO_VERSION=\([0-9]*\.[0-9]*\).*/\1/p'
}

# Succeeds when version $1 is older than version $2.
mongodb_version_lt() {
    [ "$1" != "$2" ] && [ "$(printf '%s\n%s\n' "$1" "$2" | sort -V | head -n1)" = "$1" ]
}

# Runs a mongo shell command against the running container, as the admin user.
mongodb_eval() {
    # shellcheck disable=SC2016 # Expanded inside the container.
    terpcontrol_compose exec -T mongodb sh -c '"$(command -v mongosh || command -v mongo)" --quiet \
        -u "$MONGO_INITDB_ROOT_USERNAME" -p "$MONGO_INITDB_ROOT_PASSWORD" --authenticationDatabase admin \
        --eval "$1"' sh "$1"
}

# Waits until the mongodb container is healthy. Fails as soon as it is seen to
# restart or stop, which is what a refused start looks like; a busy one that
# misses a health check gets until the deadline.
mongodb_wait_healthy() {
    local container state restarts deadline=$(($(date +%s) + ${1:-120}))
    container="$(terpcontrol_compose ps -q mongodb)"
    [ -n "$container" ] || return 1
    restarts="$(docker inspect -f '{{.RestartCount}}' "$container")"
    while :; do
        state="$(docker inspect -f '{{.State.Status}}/{{if .State.Health}}{{.State.Health.Status}}{{end}}/{{.RestartCount}}' "$container")"
        case "$state" in
            running/healthy/*) return 0 ;;
            running/*/"$restarts") [ "$(date +%s)" -lt "$deadline" ] || return 1 ;;
            *) return 1 ;;
        esac
        sleep 3
    done
}

# The data's FCV, or nothing for a volume that holds no database yet.
#
# A healthy container is asked directly. Otherwise the data is opened by a
# throwaway mongod from the compose image: one that accepts the FCV is asked and
# shut down again, one that refuses names the FCV in its refusal. The container
# is stopped first, as the files can only be opened by one mongod at a time.
mongodb_fcv() {
    if mongodb_wait_healthy; then
        mongodb_eval 'db.adminCommand({ getParameter: 1, featureCompatibilityVersion: 1 }).featureCompatibilityVersion.version'
        return
    fi

    terpcontrol_compose stop mongodb >/dev/null 2>&1 || true
    # shellcheck disable=SC2016 # Runs inside the container.
    terpcontrol_compose run --rm --no-deps -T --user mongodb --entrypoint sh mongodb -c '
        [ -f /data/db/WiredTiger ] || exit 0
        if mongod --dbpath /data/db --bind_ip 127.0.0.1 --port 27099 --fork --logpath /tmp/mongod.log >/dev/null; then
            "$(command -v mongosh || command -v mongo)" --quiet --port 27099 --eval \
                "db.adminCommand({ getParameter: 1, featureCompatibilityVersion: 1 }).featureCompatibilityVersion.version"
            mongod --dbpath /data/db --shutdown >/dev/null
        else
            fcv="$(grep -o "featureCompatibilityVersion[^}]*version: [^0-9]*[0-9][0-9.]*" /tmp/mongod.log | grep -o "[0-9][0-9.]*$" | head -n1)"
            [ -n "$fcv" ] || { tail -n 20 /tmp/mongod.log >&2; exit 1; }
            echo "$fcv"
        fi' 2>/dev/null
}

# Fails, with what to do about it, when the data's FCV is not the release of the
# compose image. Equal is the only state a stack is left in: a lower FCV still
# starts, but would be the next upgrade's problem a release later.
mongodb_check() {
    local image version fcv
    image="$(mongodb_image)"
    version="$(mongodb_image_version "$image")"
    if [ -z "$version" ]; then
        echo "Cannot tell the MongoDB release of $image, so the data is not checked against it." >&2
        return 0
    fi

    fcv="$(mongodb_fcv)" || { echo "Cannot read the featureCompatibilityVersion of the MongoDB data." >&2; return 1; }
    if [ -z "$fcv" ] || [ "$fcv" = "$version" ]; then
        return 0
    fi

    if mongodb_version_lt "$fcv" "$version"; then
        echo "The MongoDB data is at featureCompatibilityVersion $fcv, but $image is MongoDB $version." >&2
        echo "Run ./upgrade-mongodb.sh to upgrade the data first, then ./up.sh again." >&2
    else
        echo "The MongoDB data is at featureCompatibilityVersion $fcv, newer than $image (MongoDB $version)." >&2
        echo "Set DOCKER_MONGODB_IMAGE in .env to mongo:$fcv or newer." >&2
    fi
    return 1
}
