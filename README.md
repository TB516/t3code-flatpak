# T3 Code Flatpak

An unofficial Flatpak package for [T3 Code](https://github.com/pingdotgg/t3code)
on x86_64 Linux.

## Install

[Install T3 Code](https://t3code.thomasberrios.com/com.t3tools.t3code.flatpakref)
with your software store. Accept the prompt to add the T3 Code repository so
the app receives updates and stays available to reinstall after uninstalling.

To install system-wide from a terminal:

```sh
flatpak install --system https://t3code.thomasberrios.com/com.t3tools.t3code.flatpakref
```

Launch T3 Code from your app menu. Updates are available through your software
store or `flatpak update --system`.

If you installed the previous `io.github.TB516.T3Code` package, uninstall it
and install this package using the link above. Flatpak treats the new ID as a
separate app, so it does not move the previous app's settings or history from
`~/.var/app/io.github.TB516.T3Code/`.

## Host integration

The Electron desktop runs inside Flatpak and starts its matching server on the
host directly from the installed package, without copying the bundled runtime.
Agents, terminals, Git, and project processes use the normal host environment.
T3 Code's settings, history, and cache stay in
`~/.var/app/com.t3tools.t3code/`.

Remote environments use the host's OpenSSH client, configuration, and agent.
The Flatpak can read `~/.ssh/config`, `~/.ssh/config.d`, and
`~/.ssh/known_hosts` to populate its connection list, while private keys stay
outside the sandbox.

For local builds, see [Building](docs/building.md). Maintainers can find update
and release instructions in [Publishing](docs/publishing.md).
