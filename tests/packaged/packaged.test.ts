// Checks the installed Flatpak where the sandbox and host meet. The tests share one
// sequence of app launches and run in order: later steps build on earlier state.
import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { after, before, test } from "node:test";
import type { Browser, Page } from "playwright-core";

import {
  APP_ID,
  appProcesses,
  artifactsDir,
  backendPort,
  closeApp,
  connect,
  fixtureDatabase,
  hostCalls,
  hostRepo,
  hostServerPid,
  launchApp,
  listeningAddresses,
  mountNamespace,
  openSettings,
  runBundledCli,
  runInSandbox,
  startSessionHelper,
  stopSessionHelper,
  userdata,
  waitUntil,
} from "./app.ts";

// Upstream's desktop launch fixture, an older database the packaged server must migrate.
const FIXTURE_THREAD = "Release launch check";
const FIXTURE_MESSAGE = "The release opens and shows this thread.";
const POLICY_PATH = "/etc/t3code/policy.json";

let browser: Browser | undefined;
let page: Page;

async function attach(urlPrefix?: string) {
  await browser?.close().catch(() => {});
  ({ browser, page } = await connect(urlPrefix));
}

/** A test that leaves a screenshot of the window behind when it fails. */
function appTest(name: string, run: () => Promise<void>) {
  test(name, async () => {
    try {
      // Close anything an earlier failure left open, such as a popover.
      if (!page.isClosed()) await page.keyboard.press("Escape");
      await run();
    } catch (error) {
      const file = `${name.replace(/[^a-z0-9]+/gi, "-").toLowerCase()}.png`;
      await page?.screenshot({ path: path.join(artifactsDir, file) }).catch(() => {});
      throw error;
    }
  });
}

async function openSeededThread() {
  await page.goto("t3code://app/#/");
  await page.locator("li[data-thread-item]", { hasText: FIXTURE_THREAD }).click();
  await page.getByText(FIXTURE_MESSAGE).waitFor();
}

before(async () => {
  launchApp();
  await attach();
});

after(async () => {
  if (page && !page.isClosed()) await closeApp(page).catch(() => {});
  await browser?.close().catch(() => {});
});

appTest("opens and migrates the seeded history", openSeededThread);

appTest("runs its server on the host, outside the sandbox", async () => {
  const pid = await waitUntil("the host server", hostServerPid);
  assert.equal(mountNamespace(pid), mountNamespace("self"));
});

appTest("finds agent CLIs that only the host login shell knows", async () => {
  const dialog = await openSettings(page, "providers");
  await waitUntil("both agents to report a version", async () => {
    const text = await dialog.innerText();
    return /Codex\s+v9\.9\.9/.test(text) && /Claude\s+v9\.9\.9/.test(text);
  });
  const calls = hostCalls();
  assert.ok(calls.includes("claude --version"), calls.join("\n"));
  assert.ok(calls.includes("codex app-server"), calls.join("\n"));
});

appTest("leaves updates to Flatpak and offers no host installs", async () => {
  const about = await openSettings(page, "about");
  await about.getByText("Updates are managed by Flatpak.").first().waitFor();
  assert.ok(await about.getByLabel("Update track").isDisabled());

  const general = await openSettings(page, "general");
  await general.getByText("Notifications").first().waitFor();
  assert.doesNotMatch(await general.innerText(), /from any terminal/);
});

appTest("saves preview downloads to the host Downloads folder", async () => {
  const content = "t3code-flatpak download check\n";
  const server = http
    .createServer((request, response) => {
      if (request.url === "/file") {
        response.writeHead(200, {
          "Content-Type": "application/octet-stream",
          "Content-Disposition": 'attachment; filename="t3-download-check.txt"',
        });
        response.end(content);
        return;
      }
      response.writeHead(200, { "Content-Type": "text/html" });
      // A large link at the top leaves blank space below it for the focusing click.
      response.end(
        '<title>Download fixture</title><a href="/file" style="display:block;height:200px">Download</a>',
      );
    })
    .listen(8765, "127.0.0.1");
  try {
    await openSeededThread();
    const address = page.getByPlaceholder("Search or enter URL");
    if (!(await address.isVisible())) {
      if (!(await page.getByText("Open a surface").isVisible())) {
        await page.getByRole("button", { name: "Toggle right panel" }).click();
      }
      await page.getByText("Browser", { exact: true }).first().click();
    }
    await address.fill("http://127.0.0.1:8765/");
    await address.press("Enter");

    await page.locator("webview").first().waitFor();
    await page.getByText("Download fixture").first().waitFor();

    // Downloads only count when a person starts them, so click with the mouse. The first
    // click into the webview only focuses it, so make that one on blank space.
    const view = await page.locator("webview").first().boundingBox();
    assert.ok(view, "The preview webview is not on screen.");
    await page.mouse.click(view.x + view.width / 2, view.y + view.height - 20);

    // The desktop treats a download within 5 seconds of the server driving the tab as the
    // agent's and keeps it out of Downloads. Click until one lands, spacing the clicks past
    // that window.
    const saved = path.join(os.homedir(), "Downloads/t3-download-check.txt");
    await waitUntil("the download in ~/Downloads", async () => {
      await page.mouse.click(view.x + 50, view.y + 100);
      await page.waitForTimeout(6_000);
      return fs.existsSync(saved);
    });
    assert.equal(fs.readFileSync(saved, "utf8"), content);
  } finally {
    server.close();
  }
});

appTest("runs a free agent turn on the host and shows it", async () => {
  // The UI adds projects through a portal file chooser, so start the thread with
  // the bundled CLI against the running server instead.
  const baseDir = path.dirname(userdata);
  runBundledCli(["project", "add", "--base-dir", baseDir, "--title", "Host Repo", hostRepo]);
  runBundledCli([
    "thread", "start", "--base-dir", baseDir, "--title", "Host tour",
    "--provider", "replay", "--model", "showcase", hostRepo, "Give me the tour",
  ]);
  await page.goto("t3code://app/#/");
  await page.locator("li[data-thread-item]", { hasText: "Host tour" }).click();
  await page.getByText("and the tests pass").first().waitFor({ timeout: 90_000 });
});

appTest("runs terminals and git in a project only the host can see", async () => {
  const terminal = page.locator('[class*="terminal-background"]').first();
  if (!(await terminal.isVisible())) {
    await page.getByRole("button", { name: "Toggle terminal drawer" }).click();
  }
  await terminal.waitFor();
  await terminal.click();
  const marker = path.join(hostRepo, ".t3-terminal-check");
  await page.keyboard.type(`pwd > ${marker}; git branch --show-current >> ${marker}\n`);

  await waitUntil("the terminal command on the host", () =>
    fs.existsSync(marker) && fs.readFileSync(marker, "utf8").includes("main"),
  );
  assert.equal(fs.readFileSync(marker, "utf8"), `${hostRepo}\nmain\n`);
});

appTest("opens the project in editors on the host PATH and installed as Flatpaks", async () => {
  // VS Code is a fake command on the login PATH, and Zed a stand-in Flatpak app.
  await page.getByRole("button", { name: "Toggle thread details panel" }).click();
  for (const editor of ["VS Code", "Zed"]) {
    await page.getByRole("button", { name: "Choose editor" }).click();
    await page.getByRole("menuitem", { name: editor }).click();
    await page.getByRole("button", { name: `Open in ${editor}` }).click();
  }
  await page.keyboard.press("Escape");
  await waitUntil("both editors to open the project", () => {
    const calls = hostCalls();
    return calls.includes(`code ${hostRepo}`) && calls.includes(`zed ${hostRepo}`);
  });
});

appTest("reaches the host's SSH through the wrapper", async () => {
  // The app's SSH flows start with these calls. Running them in the sandbox directly keeps
  // the check free of the connection state the app would save.
  const result = runInSandbox("cat ~/.ssh/config && ssh -G ci-box");
  assert.match(result.output, /HostName 10\.9\.8\.7/);
  assert.ok(hostCalls().includes("ssh -G ci-box"), hostCalls().join("\n"));
});

appTest("relaunches with Network access and reads the host's Tailscale", async () => {
  const access = await openSettings(page, "access");
  await access.getByRole("switch", { name: "Enable network access" }).click();
  const previousRun = appProcesses();
  await page.getByRole("button", { name: "Restart and enable" }).click();
  // Until the old run exits, its closing window can still answer on the debugging port.
  await waitUntil(
    "the previous run to exit",
    () => !appProcesses().some((pid) => previousRun.includes(pid)),
    30_000,
  );
  await attach();

  const relaunched = await openSettings(page, "access");
  await relaunched.getByText("Reachable at").waitFor();
  await relaunched.getByText("Use Tailscale Serve").waitFor();
  assert.ok(hostCalls().includes("tailscale status --json"));
  // The later policy check relies on Network access really reaching the server.
  const reachable = (await relaunched.innerText()).match(/Reachable at\s+http:\/\/\S+:(\d+)/);
  assert.ok(reachable, "Access settings show no address with a port.");
  const addresses = listeningAddresses(Number(reachable[1]));
  assert.ok(addresses.some((address) => address === "0.0.0.0" || address === "::"), addresses.join());
});

appTest("stops the host server when the window closes", async () => {
  await closeApp(page);
  assert.equal(hostServerPid(), undefined);
});

appTest("starts local-only under a host policy despite saved Network access", async () => {
  fs.mkdirSync(path.dirname(POLICY_PATH), { recursive: true });
  fs.writeFileSync(
    POLICY_PATH,
    JSON.stringify({
      schemaVersion: 1,
      organization: "Packaged Test Org",
      limits: { clients: ["desktop", "local-browser"] },
    }),
  );
  try {
    const log = launchApp();
    await attach();
    const port = await backendPort(log);
    const access = await openSettings(page, "access");
    await access.getByText("managed by Packaged Test Org").waitFor();
    assert.deepEqual(listeningAddresses(port), ["127.0.0.1"]);
  } finally {
    fs.rmSync(POLICY_PATH);
  }
});

appTest("deletes the database from before 0.1.0 in Settings", async () => {
  // Removing the previous test's policy relaunches the app for Network access, so start fresh.
  await closeApp(page);
  const legacy = path.join(userdata, "state.sqlite");
  fs.copyFileSync(fixtureDatabase, legacy);
  launchApp();
  try {
    await attach();
    const maintenance = await openSettings(page, "maintenance");
    await maintenance.getByRole("button", { name: "Delete old database" }).click();
    await page.getByRole("button", { name: "Delete database" }).click();
    await maintenance.getByText("Database from before 0.1.0").waitFor({ state: "detached" });
    assert.ok(!fs.existsSync(legacy));
  } finally {
    await closeApp(page);
  }
});

appTest("shows Flatpak recovery steps while the host is out of reach, then recovers", async () => {
  await stopSessionHelper();
  try {
    launchApp();
    await attach("data:text/html");
    await page.getByText(`flatpak update ${APP_ID}`).waitFor();
  } finally {
    startSessionHelper();
  }
  // The desktop keeps retrying its server, so it starts once the host is back. The seeded
  // thread also shows the history survived the restarts.
  await attach();
  await openSeededThread();
});
