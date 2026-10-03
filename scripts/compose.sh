# shellcheck shell=bash
# Central helper for talking to this repo's compose stack.
#
# This file is meant to be SOURCED, not executed:
#
#   . "$(dirname "${BASH_SOURCE[0]}")/scripts/compose.sh"
#   terpcontrol_compose up -d
#
# Sourcing loads the environment file (see load-env.sh) and resolves the compose
# project the scripts act on. That resolution has to be shared: a script that
# guesses a different project than the one the stack was started with looks at
# containers nobody started, so backup, restore and the deploy's health check
# would each address their own stack.
#
# The project name comes from DOCKER_COMPOSE_NAME in the env file. It is
# exported as COMPOSE_PROJECT_NAME rather than passed as `-p`, because
# docker-compose.yaml interpolates that variable into the volume names, and only
# an environment variable reaches both the CLI and the interpolation. Anything
# already in COMPOSE_OPTIONS still wins - a flag beats the environment.
. "$(dirname "${BASH_SOURCE[0]}")/load-env.sh"
terpcontrol_load_env

if [ -n "${DOCKER_COMPOSE_NAME:-}" ]; then
    export COMPOSE_PROJECT_NAME="$DOCKER_COMPOSE_NAME"
fi

# TERPCONTROL_ENV_FILE is passed on as a flag as well: exporting its variables
# is not enough, compose interpolates docker-compose.yaml from the env file it
# was pointed at, and defaults to ./.env when pointed at none.
terpcontrol_compose() {
    # shellcheck disable=SC2086 # COMPOSE_OPTIONS holds flags, not one argument.
    docker compose ${COMPOSE_OPTIONS:-} ${TERPCONTROL_ENV_FILE:+--env-file "$TERPCONTROL_ENV_FILE"} "$@"
}
