# shellcheck shell=sh
# Central helper for locating and loading the TerpControl environment file.
#
# This file is meant to be SOURCED, not executed:
#
#   . "$(dirname "$0")/scripts/load-env.sh"   # sets $ENV_FILE
#   terpcontrol_load_env                       # exports its variables
#
# Sourcing resolves $ENV_FILE once. Call terpcontrol_load_env when you want the
# variables exported into the current shell; scripts that only need the path
# (e.g. to read/rewrite the file in place) can use $ENV_FILE directly.

# Resolve the env file into $ENV_FILE. Honour $TERPCONTROL_ENV_FILE when it is
# set (the deploy workflow points this at a host-specific file); otherwise fall
# back to ./.env and then ../.env so the scripts work both from the repo root
# and from a subdirectory such as firmware/.
terpcontrol_resolve_env_file() {
    if [ -n "${TERPCONTROL_ENV_FILE:-}" ]; then
        ENV_FILE="$TERPCONTROL_ENV_FILE"
    elif [ -f .env ]; then
        ENV_FILE=".env"
    elif [ -f ../.env ]; then
        ENV_FILE="../.env"
    else
        ENV_FILE=".env"
    fi
}

# Export every variable defined in $ENV_FILE. Comment lines are skipped, and
# CUSTOM_LINKS_HTML is excluded because its value can contain spaces/quotes that
# break the `xargs` round-trip used to turn the file into export arguments.
terpcontrol_load_env() {
    [ -n "${ENV_FILE:-}" ] || terpcontrol_resolve_env_file
    if [ -f "$ENV_FILE" ]; then
        # shellcheck disable=SC2046
        export $(grep -v '^#' "$ENV_FILE" | grep -v CUSTOM_LINKS_HTML | xargs)
    fi
}

terpcontrol_resolve_env_file
