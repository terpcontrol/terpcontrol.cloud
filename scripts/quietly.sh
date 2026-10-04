# shellcheck shell=bash
# Meant to be SOURCED by the build scripts.
#
#   quietly docker build -t image dir
#
# runs a command whose output only matters when it fails: the output is held
# back, printed in full if the command fails, and the script then exits with
# the command's status.
quietly() {
    local out status
    out=$("$@" 2>&1) && return
    status=$?
    printf '%s\n' "$out" >&2
    exit "$status"
}
