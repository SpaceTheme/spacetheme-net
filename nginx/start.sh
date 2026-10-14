#!/bin/sh
# Start command of the nginx container (docker-compose.yml).
#
# Reads site.conf + api.conf straight from the repo (no single file mounts, those keep pointing
# to the old file after a git pull), fills in ${STEAM_API_KEY} and reloads nginx automatically
# when a pull changed the config. Website files themselves are served directly, no reload needed.

set -eu

SRC=/usr/share/nginx/html/nginx
OUT=/etc/nginx/spacetheme
CHECK_INTERVAL=${CONFIG_CHECK_INTERVAL:-30}

render() {
    mkdir -p "$OUT"
    # Only this variable, nginx variables like $arg_steamid have to stay as they are
    envsubst '${STEAM_API_KEY}' < "$SRC/api.conf" > "$OUT/api.conf"
    cp "$SRC/site.conf" /etc/nginx/conf.d/default.conf
}

checksum() {
    cat "$SRC/site.conf" "$SRC/api.conf" 2>/dev/null | md5sum
}

render

(
    last=$(checksum)
    while sleep "$CHECK_INTERVAL"; do
        now=$(checksum)
        [ "$now" = "$last" ] && continue
        last=$now
        render
        if nginx -t -q; then
            nginx -s reload
            echo "start.sh: config changed, nginx reloaded"
        else
            echo "start.sh: new config is invalid, nginx keeps running with the old one"
        fi
    done
) &

exec nginx -g 'daemon off;'
