// Starts the installed Flatpak and inspects it from the host side of the CI container.
import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { chromium, type Browser, type Page } from "playwright-core";

export const APP_ID = "com.t3tools.t3code";
const DEBUG_URL = "http://127.0.0.1:9222";
const APP_URL = "t3code://app";

/** The repository checkout. run.sh runs these files from a copy, so it passes the original. */
export const checkout = process.env.T3_TEST_CHECKOUT ?? "";
if (!checkout) throw new Error("Run the packaged app checks through tests/packaged/run.sh.");
export const artifactsDir =
  process.env.T3_TEST_ARTIFACTS ?? path.join(checkout, "build-flatpak/packaged-test-artifacts");
/** Where fixtures/fake-command records each call that reached the host. */
export const CALL_LOG = "/tmp/t3-test-calls.log";
export const upstreamDir = "/opt/t3-upstream";
export const fixtureDatabase = path.join(upstreamDir, "scripts/fixtures/desktop-launch/statev2.sqlite");
export const hostRepo = "/srv/t3-host-repo";
export const userdata = path.join(os.homedir(), ".var/app", APP_ID, "data/t3/userdata");

export async function waitUntil<T>(
  what: string,
  check: () => T | undefined | null | false | Promise<T | undefined | null | false>,
  timeoutMs = 60_000,
): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const result = await check();
    if (result) return result;
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error(`Timed out waiting for ${what}`);
}

let launchCount = 0;

/** Launches the app the way the desktop entry does, plus a debugging port for Playwright. */
export function launchApp(): string {
  launchCount += 1;
  fs.mkdirSync(artifactsDir, { recursive: true });
  const logPath = path.join(artifactsDir, `app-${launchCount}.log`);
  const log = fs.openSync(logPath, "w");
  // Chromium's own sandbox cannot run as root in the CI container.
  spawn("flatpak", ["run", APP_ID, "--no-sandbox", "--remote-debugging-port=9222"], {
    stdio: ["ignore", log, log],
    detached: true,
  }).unref();
  return logPath;
}

/** Attaches to an app window, waiting for it to load after a launch or relaunch. */
export async function connect(urlPrefix = APP_URL): Promise<{ browser: Browser; page: Page }> {
  await waitUntil(
    `a window at ${urlPrefix}`,
    async () => {
      const targets: Array<{ url: string }> = await fetch(`${DEBUG_URL}/json`)
        .then((response) => response.json())
        .catch(() => []);
      return targets.some((target) => target.url.startsWith(urlPrefix));
    },
    90_000,
  );
  const browser = await chromium.connectOverCDP(DEBUG_URL);
  const page = browser
    .contexts()
    .flatMap((context) => context.pages())
    .find((candidate) => candidate.url().startsWith(urlPrefix));
  if (!page) throw new Error(`The window at ${urlPrefix} is not available over CDP.`);
  return { browser, page };
}

/** Closes the window like a user would and waits for the app and its host server to exit. */
export async function closeApp(page: Page): Promise<void> {
  await page.close({ runBeforeUnload: true }).catch(() => {});
  await waitUntil("the app and its host server to exit", () => appProcesses().length === 0, 30_000);
}

/** Every process running the packaged binary, inside or outside the sandbox. */
export function appProcesses(): number[] {
  return processes().filter((pid) => readProc(pid, "comm").trim() === "t3code");
}

/** The T3 server the desktop starts for itself. */
export function hostServerPid(): number | undefined {
  return processes().find((pid) => {
    const args = readProc(pid, "cmdline").split("\0");
    return args.includes("--bootstrap-fd") && !args[0]?.endsWith("flatpak-spawn");
  });
}

export function mountNamespace(pid: number | "self"): string {
  return fs.readlinkSync(`/proc/${pid}/ns/mnt`);
}

function processes(): number[] {
  return fs
    .readdirSync("/proc")
    .filter((entry) => /^\d+$/.test(entry))
    .map(Number);
}

function readProc(pid: number, file: string): string {
  try {
    return fs.readFileSync(`/proc/${pid}/${file}`, "utf8");
  } catch {
    return "";
  }
}

/** Flatpak's host-command service, which `flatpak-spawn --host` goes through. */
function sessionHelperPath(): string {
  const flatpak = spawnSync("sh", ["-c", "command -v flatpak"], { encoding: "utf8" }).stdout.trim();
  return path.join(path.dirname(flatpak), "../libexec/flatpak-session-helper");
}

/** Starts the host-command service, which desktop sessions start on demand. */
export function startSessionHelper() {
  spawn(sessionHelperPath(), [], { stdio: "ignore", detached: true }).unref();
}

/** Stops the host-command service, which leaves the sandbox with no way to reach the host. */
export async function stopSessionHelper() {
  const helper = sessionHelperPath();
  const running = () => processes().filter((pid) => readProc(pid, "cmdline").split("\0")[0] === helper);
  for (const pid of running()) process.kill(pid);
  await waitUntil("the host-command service to stop", () => running().length === 0);
}

/** Calls that reached the fake host commands in fixtures/fake-command. */
export function hostCalls(): string[] {
  return fs.existsSync(CALL_LOG) ? fs.readFileSync(CALL_LOG, "utf8").trim().split("\n") : [];
}

/** The local server URL the desktop reports once its backend is ready. */
export async function backendPort(logPath: string): Promise<number> {
  const match = await waitUntil("the backend to become ready", () =>
    fs.readFileSync(logPath, "utf8").match(/backend ready[\s\S]*?url: http:\/\/127\.0\.0\.1:(\d+)\//),
  );
  return Number(match[1]);
}

const IPV6_NAMES: Record<string, string> = {
  "00000000000000000000000000000000": "::",
  "00000000000000000000000001000000": "::1",
};

/** Addresses listening on `port`, read from the kernel so the check sees what the server bound. */
export function listeningAddresses(port: number): string[] {
  const portHex = port.toString(16).toUpperCase().padStart(4, "0");
  return ["/proc/net/tcp", "/proc/net/tcp6"].flatMap((table) =>
    fs
      .readFileSync(table, "utf8")
      .trim()
      .split("\n")
      .slice(1)
      .map((line) => line.trim().split(/\s+/))
      .filter(([, local, , state]) => state === "0A" && local?.endsWith(`:${portHex}`))
      .map(([, local]) => {
        const hex = local!.split(":")[0]!;
        if (hex.length > 8) return IPV6_NAMES[hex] ?? hex;
        // The kernel prints IPv4 addresses in little-endian byte order.
        return [3, 2, 1, 0].map((index) => parseInt(hex.slice(index * 2, index * 2 + 2), 16)).join(".");
      }),
  );
}

/** Runs the bundled CLI on the host, as the Flatpak's host server does. */
export function runBundledCli(args: string[]): void {
  const location = spawnSync("flatpak", ["info", "--show-location", APP_ID], { encoding: "utf8" });
  const runtime = path.join(location.stdout.trim(), "files/t3code");
  const result = spawnSync(
    path.join(runtime, "t3code"),
    [path.join(runtime, "resources/app.asar/apps/server/dist/bin.mjs"), ...args],
    { encoding: "utf8", env: { ...process.env, ELECTRON_RUN_AS_NODE: "1" } },
  );
  if (result.status !== 0) throw new Error(`t3 ${args.join(" ")} failed:\n${result.stderr}`);
}

/** Runs a shell script inside the app's sandbox. */
export function runInSandbox(script: string): { status: number | null; output: string } {
  const result = spawnSync("flatpak", ["run", "--command=sh", APP_ID, "-s"], {
    input: script,
    encoding: "utf8",
  });
  return { status: result.status, output: `${result.stdout}${result.stderr}` };
}

export async function openSettings(page: Page, route: string) {
  await page.goto(`t3code://app/#/settings/${route}`);
  const dialog = page.getByRole("dialog").filter({ hasText: "Settings" });
  await dialog.waitFor();
  return dialog;
}
