#!/bin/sh
# Pulls the latest version of the website from GitHub (your pushes, the data workflows, new supporters).
#
#   sh nginx/update.sh           once - e.g. from cron or the task scheduler of the NAS
#   sh nginx/update.sh --loop    forever, every $UPDATE_INTERVAL seconds (the "updater" in docker-compose.yml)
#
# Only fast-forwards: if files were changed on the NAS, the update is skipped instead of overwriting them.
# Without Docker set RELOAD_NGINX=1 to reload the system nginx after an update (needs the rights to do so).

set -u

REPO=$(cd "$(dirname "$0")/.." && pwd)
BRANCH=${UPDATE_BRANCH:-main}
INTERVAL=${UPDATE_INTERVAL:-120}

git_repo() {
    git -c safe.directory="$REPO" -C "$REPO" "$@"
}

log() {
    echo "$(date '+%Y-%m-%d %H:%M:%S') $*"
}

update() {
    git_repo fetch --quiet origin "$BRANCH" || { log "fetch failed, trying again later"; return 1; }

    current=$(git_repo rev-parse HEAD)
    latest=$(git_repo rev-parse "origin/$BRANCH")
    [ "$current" = "$latest" ] && return 0

    if ! git_repo diff --quiet || ! git_repo diff --cached --quiet; then
        log "local changes on this machine, update skipped (git -C $REPO status)"
        return 1
    fi

    if git_repo merge --ff-only --quiet "origin/$BRANCH"; then
        log "updated to $(git_repo rev-parse --short HEAD): $(git_repo log -1 --format=%s)"
        if [ -n "${RELOAD_NGINX:-}" ]; then
            nginx -t -q && nginx -s reload && log "nginx reloaded"
        fi
    else
        log "fast-forward not possible (local commits?), update skipped"
        return 1
    fi
}

if [ "${1:-}" = "--loop" ]; then
    log "checking $BRANCH every ${INTERVAL}s"
    while true; do
        update
        sleep "$INTERVAL"
    done
else
    update
fi
