// Turns the disposable CI container into a stand-in for a user's desktop and installs the
// app there. Every step changes the system it runs on, so main.ts checks for a container first.
import { execFileSync, spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import {
  APP_ID,
  CALL_LOG,
  artifactsDir,
  checkout,
  fixtureDatabase,
  hostRepo,
  startSessionHelper,
  upstreamDir,
  userdata,
} from "./app.ts";

const PUBLISHED_REPO = "https://t3code.thomasberrios.com/t3code.flatpakrepo";
const LOGIN_BIN = "/opt/t3-test/bin";
const FAKE_COMMAND = path.join(import.meta.dirname, "fixtures/fake-command");

export type AppSource = { repo: string } | { commit: string };

function run(command: string, ...args: string[]): string {
  return execFileSync(command, args, { encoding: "utf8", stdio: ["ignore", "pipe", "inherit"] });
}

export function isDisposableContainer(): boolean {
  return fs.existsSync("/.dockerenv") || fs.existsSync("/run/.containerenv");
}

/** Installs a local build's repository, or a commit from the published repository. */
export function installApp(source: AppSource) {
  if ("repo" in source) {
    run("flatpak", "remote-add", "--system", "--no-gpg-verify", "t3code-test", path.resolve(source.repo));
    run("flatpak", "install", "--system", "-y", "--noninteractive", "t3code-test", `${APP_ID}//stable`);
    return;
  }
  const repoFile = path.join(os.tmpdir(), "t3code.flatpakrepo");
  run("curl", "-fsSL", PUBLISHED_REPO, "-o", repoFile);
  run("flatpak", "remote-add", "--system", "t3code", repoFile);
  run("flatpak", "install", "--system", "-y", "--noninteractive", "t3code", APP_ID);
  run("flatpak", "update", "--system", "-y", "--noninteractive", `--commit=${source.commit}`, APP_ID);
}

function installFakeCommand(target: string) {
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.copyFileSync(FAKE_COMMAND, target);
  fs.chmodSync(target, 0o755);
}

/**
 * Host tools the app should only reach outside the sandbox. Agents, Tailscale and VS Code
 * come from the login shell's PATH, and ssh from the host service's default PATH.
 */
export function installFakeHostCommands() {
  for (const name of ["claude", "codex", "tailscale", "code"]) {
    installFakeCommand(path.join(LOGIN_BIN, name));
  }
  installFakeCommand("/usr/local/bin/ssh");
  for (const file of [".profile", ".bashrc"]) {
    fs.appendFileSync(path.join(os.homedir(), file), `export PATH=${LOGIN_BIN}:$PATH\n`);
  }
}

/**
 * A stand-in Zed installed as a Flatpak. Flatpak apps put no command on the host PATH, so
 * the host server can only find it through `flatpak list`.
 */
export function installFlatpakEditor() {
  const appId = "dev.zed.Zed";
  const build = fs.mkdtempSync(path.join(os.tmpdir(), "editor-build-"));
  const repo = fs.mkdtempSync(path.join(os.tmpdir(), "editor-repo-"));
  // The app's own runtime is already installed, and a shell script needs nothing more.
  const [runtime, , branch] = run("flatpak", "info", "--show-runtime", APP_ID).trim().split("/");
  if (!runtime || !branch) throw new Error(`${APP_ID} reports no runtime.`);
  run("flatpak", "build-init", build, appId, runtime, runtime, branch);
  installFakeCommand(path.join(build, "files/bin/zed"));
  // Shares /tmp so the stand-in can write to the call log.
  run("flatpak", "build-finish", build, "--command=zed", "--filesystem=/tmp");
  run("flatpak", "build-export", repo, build);
  run("flatpak", "remote-add", "--system", "--no-gpg-verify", "t3code-test-editor", repo);
  run("flatpak", "install", "--system", "-y", "--noninteractive", "t3code-test-editor", appId);
}

/** Folders and config that every desktop session has. */
export function configureDesktop() {
  const home = os.homedir();
  fs.mkdirSync(path.join(home, "Downloads"), { recursive: true });
  fs.mkdirSync(path.join(home, ".config"), { recursive: true });
  fs.writeFileSync(path.join(home, ".config/user-dirs.dirs"), 'XDG_DOWNLOAD_DIR="$HOME/Downloads"\n');
  fs.mkdirSync(path.join(home, ".ssh"), { recursive: true });
  fs.writeFileSync(path.join(home, ".ssh/config"), "Host ci-box\n  HostName 10.9.8.7\n  User ci\n");
}

/** A git project outside every filesystem permission the sandbox has. */
export function createHostRepo() {
  fs.mkdirSync(hostRepo, { recursive: true });
  run("git", "-C", hostRepo, "init", "-q", "-b", "main");
  run("git", "-C", hostRepo, "-c", "user.name=t3", "-c", "user.email=t3@example.invalid",
    "commit", "-q", "--allow-empty", "-m", "init");
}

/** Upstream's launch fixture and free replay agent, from the release the manifest packages. */
export function fetchUpstreamFixtures() {
  const manifest = fs.readFileSync(path.join(checkout, "flatpak/modules/t3code.yml"), "utf8");
  const tag = manifest.match(/^\s*tag:\s*(\S+)/m)?.[1];
  if (!tag) throw new Error("The manifest does not pin an upstream tag.");
  run("git", "-c", "advice.detachedHead=false", "clone", "-q", "--depth", "1", "--filter=blob:none",
    "--sparse", "--branch", tag, "https://github.com/pingdotgg/t3code.git", upstreamDir);
  run("git", "-C", upstreamDir, "sparse-checkout", "set", "--no-cone",
    "/scripts/fixtures/desktop-launch/",
    "/apps/server/scripts/dev-replay-agent.ts",
    "/apps/server/scripts/dev-replay/",
    "/apps/server/src/orchestration-v2/testkit/fixtures/");
}

/** Seeds the fixture history and registers the replay agent the way upstream's dev servers do. */
export function seedAppData() {
  fs.mkdirSync(userdata, { recursive: true });
  fs.copyFileSync(fixtureDatabase, path.join(userdata, "statev2.sqlite"));
  const settings = {
    providerInstances: {
      replay: {
        displayName: "Replay",
        driver: "acpRegistry",
        config: {
          source: "local",
          commandPath: process.execPath,
          commandArgs: [path.join(upstreamDir, "apps/server/scripts/dev-replay-agent.ts")],
        },
      },
    },
  };
  fs.writeFileSync(path.join(userdata, "settings.json"), JSON.stringify(settings, null, 2));
}

/**
 * Starts a headless display, a session bus, and Flatpak's host-command service. The app
 * inherits them through this process's environment.
 */
export function startDesktopSession() {
  const runtimeDir = `/run/user/${os.userInfo().uid}`;
  fs.mkdirSync(runtimeDir, { recursive: true, mode: 0o700 });
  Object.assign(process.env, { DISPLAY: ":99", XDG_RUNTIME_DIR: runtimeDir, SHELL: "/bin/bash" });

  spawn("Xvfb", [":99", "-screen", "0", "1280x800x24"], { stdio: "ignore", detached: true }).unref();
  process.env.DBUS_SESSION_BUS_ADDRESS = run("dbus-daemon", "--session", "--fork", "--print-address").trim();
  startSessionHelper();
}

/** Copies logs next to the failure screenshots, owned by the user who ran the checks. */
export function collectArtifacts() {
  fs.mkdirSync(artifactsDir, { recursive: true });
  for (const source of [path.join(userdata, "logs"), CALL_LOG]) {
    if (fs.existsSync(source)) {
      fs.cpSync(source, path.join(artifactsDir, path.basename(source)), { recursive: true });
    }
  }
  const owner = Number(process.env.HOST_UID);
  if (Number.isInteger(owner)) run("chown", "-R", String(owner), artifactsDir);
}
