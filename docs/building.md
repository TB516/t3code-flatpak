# Building the Flatpak

The package builds a pinned upstream release with the numbered patches in
`patches/`. Dependencies come from the upstream lockfile during the build.

The host needs Flatpak, Flatpak Builder, and the runtimes, base app, and SDK
extensions declared in `flatpak/com.t3tools.t3code.yml`. The builder uses
the per-user installation for build dependencies. The script does not install
or update them.

```sh
./scripts/build-flatpak build
```

This builds the package, runs desktop tests and the editor launcher test,
typechecks the desktop and server, and writes
`build-flatpak/com.t3tools.t3code.flatpak`.

To build and install the package for your user, then launch it:

```sh
./scripts/build-flatpak install
./scripts/build-flatpak run
```

Build state and output stay in `build-flatpak/`.

## Testing the packaged app

The packaged app checks install a build in a throwaway container, launch it
headless, and check the places where the sandbox and host meet: the host
server, agent CLIs found through the login shell, downloads, terminals,
editors, SSH, Tailscale, managed policy, database maintenance, and the recovery
screen when the host is out of reach. Docker runs them by default; set
`CONTAINER_ENGINE=podman` to use Podman.

```sh
./scripts/test-packaged                     # the build from ./scripts/build-flatpak build
./scripts/test-packaged published <commit>  # a build from the published repository
```

The container stands in for a user's machine, so nothing is installed on yours.
A run needs network access to fetch runtimes and upstream test fixtures. The
fixtures come from the upstream release in the manifest, so an older published
commit is checked against the current fixtures. The app logs, plus screenshots
from failed checks, are written to `build-flatpak/packaged-test-artifacts/`. The
checks live in `tests/packaged/` and are typechecked before each run.
