#!/bin/sh
set -eu

: "${T3CODE_HOME:?Missing app-owned data directory}"
: "${T3CODE_FLATPAK_SERVER:?Missing bundled server executable}"
: "${T3CODE_FLATPAK_ENTRY:?Missing bundled server entry point}"
: "${T3CODE_FLATPAK_COMPILE_CACHE:?Missing bundled compile cache preload}"
unset NODE_OPTIONS NODE_PATH
unset T3CODE_PORT T3CODE_MODE T3CODE_NO_BROWSER T3CODE_HOST
unset T3CODE_DESKTOP_WS_URL T3CODE_DESKTOP_LAN_ACCESS T3CODE_DESKTOP_LAN_HOST
unset T3CODE_DESKTOP_HTTPS_ENDPOINTS T3CODE_TAILSCALE_SERVE T3CODE_TAILSCALE_SERVE_PORT
cd "$HOME"

export ELECTRON_RUN_AS_NODE=1
# Desktop maintenance runs with the same runtime and sanitized host environment,
# after the desktop has stopped its server. No user-facing CLI is installed.
if [ "${1:-}" = "--compact-database" ]; then
    exec "$T3CODE_FLATPAK_SERVER" --require "$T3CODE_FLATPAK_COMPILE_CACHE" "$T3CODE_FLATPAK_ENTRY" flatpak-compact-database --base-dir "$T3CODE_HOME"
fi

exec "$T3CODE_FLATPAK_SERVER" --require "$T3CODE_FLATPAK_COMPILE_CACHE" "$T3CODE_FLATPAK_ENTRY" --bootstrap-fd 3
