---
name: update-t3code
description: Update the T3 Code Flatpak to a new upstream release. Refresh the patches, check that the package still works the way it should, bring new upstream features into the Flatpak where they fit, and flag anything that needs a product decision.
---

# Update T3 Code

Handle the patch work and routine checks without asking. Ask only about
product decisions, and explain them in terms of what users see, not the code.

## What the package should be

This is upstream T3 Code, repackaged to be a good Flatpak citizen.

- **Stay close to upstream.** Follow upstream's behavior wherever it works in
  the Flatpak. Patch only what the Flatpak needs, and keep each patch as small
  as it can be. Leave upstream bugs to upstream.
- **Keep the system clean.** The Flatpak is a packaging mechanism, not a strict
  security boundary. T3 Code's own components and data stay where removing the
  Flatpak with its data cleans them up. It never installs things onto the host,
  changes system configuration or sets up host software for the user. Work the
  user asks for, such as agents editing projects or files saved to Downloads,
  is fine.
- **Users own their system.** When a feature needs something on the host,
  document the requirement instead of building workarounds or setting it up
  for them.
- **Flatpak owns updates.** The desktop app and the local server it starts are
  updated through Flatpak, never by themselves. Remote servers managed
  separately keep upstream's update behavior.
- **Use the desktop's own facilities.** Prefer portals and the user's normal
  desktop options over custom integrations.
- **Don't quietly lose features.** If something can't work as upstream built
  it, find the simplest way to keep what users actually get from it, often
  through the app's UI. If the feature isn't worth keeping, hide it so users
  never reach a broken option.
- **Prefer simple.** Choose the option with the least patch to maintain, unless
  a slightly bigger change clearly serves users better.

## Workflow

### 1. Start from the update PR

The **Check for T3 Code releases** workflow opens a draft PR on
`automation/update-t3code-vX`. If there isn't one yet, run that workflow. Work
on the PR branch.

### 2. Refresh the patches

Rebase the patch series in `patches/` onto the new upstream tag, using an
upstream checkout in the gitignored `build-flatpak/` directory. Keep one commit
per patch so the files can be regenerated from them. Follow each conflicting
upstream change's intent:

- Drop what upstream now does itself or no longer needs, including whole
  patches. Remove a retired patch's file and its manifest entry.
- Keep the Flatpak's behavior where both apply.
- Make sure the regenerated files reproduce the tree you tested.

### 3. Review the release

A clean rebase doesn't mean the package still works. Read the upstream changes
and check each of these.

- **Existing patches still hold.** Check that each patch's behavior still works,
  not just that it applies. Upstream often adds a new path next to the one a
  patch covers.
- **New features that need Flatpak support.** These are things users should
  get that break across the sandbox and host boundary. The desktop UI runs in
  the sandbox and the server runs on the host, so look at what crosses between
  them: environment, paths, files, startup arguments, and host tools the desktop
  calls. Check new settings, notices and recovery screens too, by tracing what
  they actually do.
- **Features that don't fit.** These are things that conflict with what the
  package should be, such as installing onto the host, setting up host
  software or self-updating. Judge each by what it does for users and what it
  does to the host, not by how upstream exposes it. Recommend keeping, adapting
  or hiding it.
- **Build requirements.** Compare upstream's toolchain needs, such as Node,
  pnpm and Electron, with the manifest's SDK extensions and build commands.

Also note existing gaps you come across, even if the release didn't cause them,
and anything worth testing on the currently installed version.

### 4. Report and get decisions

- Summarize the patch refresh briefly, in plain terms. Say what changed and why.
- Raise only the items that need a decision. Go one at a time, with the user
  impact, your recommendation and what it costs to maintain. Don't report
  things that need no action.
- Don't make product changes until they're approved.

### 5. Implement and verify

- Make the agreed changes in the style of the existing patches.
- Run `./scripts/build-flatpak build` from the repo root. It runs the desktop
  tests, the server tests listed in `flatpak/modules/t3code.yml` and both
  typechecks, but no web tests. Check web changes directly. Make sure the test
  files the manifest lists still exist.
- Run `./scripts/test-packaged` to check the built package where the sandbox
  and host meet. When the release changes a flow these checks don't cover,
  add a check to `tests/packaged/` or test it by hand with isolated data. Say
  what you tested, what you only checked by reading code, and what's
  unverified.
- Update the user documentation when host requirements, setup or supported
  behavior change.
- Before handing off, do a final review pass over the whole change set for
  bloat, leftovers and anything outside what was agreed.
- Ask before replacing the installed copy of the app to test a build. It shares
  data with the instance that's running.

### 6. Ship within the request

Do only as much as the current request asks. Merge and release only when
asked to.

- **PR:** push to the PR branch, rewrite the description to cover the update and
  any packaging changes, mark it ready, and wait for **Validate Flatpak
  update**. Bot-created runs need approval in the PR. Keep the title in the
  `type(scope): description` format, such as `fix(flatpak): ...` when packaging
  fixes are the main change.
- **Metainfo:** keep the release checker's formatting. Leave the release
  description empty for a plain upstream update. Write a short, specific note
  when the package itself changes. Packaging-only releases append a revision,
  such as `0.1.7-1`. If a release ships upstream and packaging changes
  together, use one entry for it, not two.
- **Merge:** squash-merge and delete the branch. **Publish Flatpak repository**
  then runs on `main` by itself. Check that it succeeds. A "release" means
  publishing the Flatpak repository, not creating a GitHub Release.
- **After release:** clean up the local and remote branches. The published
  update then gets tested on a real install. Fix regressions as the next `-N`
  revision. The app's server logs are under
  `~/.var/app/com.t3tools.t3code/data/t3/userdata/logs/`.
