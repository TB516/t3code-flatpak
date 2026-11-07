# Runs inside the sandbox and starts host database maintenance with the same
# command the desktop uses after its confirmation dialog, which CI cannot click.
# Keep it in step with runHostMaintenance in patch 0011.
app=$(awk '
    /^\[/ { in_instance = ($0 == "[Instance]") }
    in_instance && /^app-path=/ { sub(/^app-path=/, ""); print; exit }
' /.flatpak-info)
runtime="$app/t3code"

exec /usr/bin/flatpak-spawn --host --watch-bus "--directory=$runtime" \
    "--env=T3CODE_HOME=$XDG_DATA_HOME/t3" \
    "--env=T3CODE_FLATPAK_SERVER=$runtime/t3code" \
    "--env=T3CODE_FLATPAK_ENTRY=$runtime/resources/app.asar/apps/server/dist/bin.mjs" \
    "--env=T3CODE_FLATPAK_COMPILE_CACHE=$runtime/resources/app.asar/apps/desktop/dist-electron/compileCache.cjs" \
    /bin/sh "$runtime/host-server.sh" --database-maintenance --compact --remove-legacy
