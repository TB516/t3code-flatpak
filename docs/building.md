# Building the Flatpak

The package builds a pinned upstream release with the numbered patches in
`patches/`. Dependencies come from the upstream lockfile during the build.

The host needs Flatpak, Flatpak Builder, and the runtimes, base app, and SDK
extensions declared in `flatpak/io.github.TB516.T3Code.yml`. The builder uses
the per-user installation for build dependencies. The script does not install
or update them.

```sh
./scripts/build-flatpak build
```

This builds the package, runs desktop tests and typecheck, and writes
`build-flatpak/io.github.TB516.T3Code.flatpak`.

To build and install the package for your user, then launch it:

```sh
./scripts/build-flatpak install
./scripts/build-flatpak run
```

Build state and output stay in `build-flatpak/`.
