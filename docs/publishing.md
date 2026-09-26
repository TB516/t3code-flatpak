# Publishing the Flatpak repository

## Updating T3 Code

The **Check for T3 Code releases** workflow checks daily and opens a draft PR
when upstream publishes a new stable release. The external data checker updates
the release tag and matching commit in `flatpak/modules/t3code.yml` and adds the
release to `flatpak/com.t3tools.t3code.metainfo.xml`. Refresh the numbered
patches in `patches/` before merging.

Each release gets its own branch, such as `automation/update-t3code-v0.0.43`.
The updater leaves an existing PR for that version alone, so newer releases
can open separate PRs without overwriting patch fixes under review.

**Validate Flatpak update** runs when packaging PRs are opened, updated, or
reopened. It can also be started from the Actions tab. GitHub requires approval
for runs triggered by the updater's `GITHUB_TOKEN`; approve them in the PR.
New commits cancel older validation runs for the same PR. Website-only changes
skip package validation and do not change the build cache key.
The workflow applies the patches, builds the Flatpak, and runs desktop tests
and typecheck. The WSL test file is excluded because some of its tests inspect
host processes that the Flatpak build sandbox cannot see.

## Publishing

The **Publish Flatpak repository** workflow builds and signs the stable x86_64
package, then deploys it to `https://t3code.thomasberrios.com` with GitHub
Pages. It runs desktop tests and typecheck before publishing, and starts only
when manually triggered from the Actions tab.

Keep **Settings → Pages → Source** set to **GitHub Actions**. The workflow
uploads the website and Flatpak repository together as a Pages artifact.
The repository contains binary files too large to store in a Git branch.

The workflow restores and verifies the published repository before exporting
a new build. If restoration fails, publishing stops. It keeps the current
release and two parent commits, allowing users to list older builds with
`flatpak remote-info --log` and install one with
`flatpak update --commit`. Debug symbols and older unreachable objects are not
published.

All builds generate AppStream metadata, so local builds and PR validation
check the same software store metadata as publishing.

The repository and ref files are maintained as standalone templates in
`flatpak/pages/` and receive the current signing key during the workflow.

## Signing key

Create a dedicated GPG signing key without a passphrase. The workflow is
unattended, and this key should only be used for the Flatpak repository. Keep
an encrypted backup in Bitwarden.

```sh
gpg --batch --passphrase '' --quick-generate-key \
  'T3 Code Flatpak Repository <noreply@t3code.invalid>' ed25519 sign 0

gpg --list-secret-keys --keyid-format=long noreply@t3code.invalid
gpg --armor --export-secret-keys <KEY_ID> > t3code-flatpak-signing-key.asc
```

Save `t3code-flatpak-signing-key.asc` in Bitwarden, then add its complete
contents to the GitHub repository secret:

```sh
gh secret set FLATPAK_GPG_PRIVATE_KEY < t3code-flatpak-signing-key.asc
```

Delete the exported file from disk after both copies are stored.

For the first publication with `com.t3tools.t3code`, select **first-publish**
when starting the workflow. This replaces the published repository and removes
the old `io.github.TB516.T3Code` ref from GitHub Pages. Existing installations
of that ID will no longer receive updates. Leave **first-publish** off for
subsequent releases to preserve the new repository's history.
