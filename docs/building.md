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
