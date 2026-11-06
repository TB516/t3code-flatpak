// Prepares the CI container as a stand-in desktop, then runs the packaged app checks.
import { spawnSync } from "node:child_process";
import { parseArgs } from "node:util";

import {
  type AppSource,
  collectArtifacts,
  configureDesktop,
  createHostRepo,
  fetchUpstreamFixtures,
  installApp,
  installFakeHostCommands,
  installFlatpakEditor,
  isDisposableContainer,
  seedAppData,
  startDesktopSession,
} from "./host.ts";

const { values } = parseArgs({ options: { repo: { type: "string" }, commit: { type: "string" } } });
let source: AppSource | undefined;
if (values.repo) source = { repo: values.repo };
if (values.commit) source = { commit: values.commit };
if (!source) {
  console.error("Usage: main.ts --repo <Flatpak repository> | --commit <published commit>");
  process.exit(2);
}
if (!isDisposableContainer()) {
  console.error("These checks change the system they run on. Run them with scripts/test-packaged.");
  process.exit(1);
}

installApp(source);
installFakeHostCommands();
installFlatpakEditor();
configureDesktop();
createHostRepo();
fetchUpstreamFixtures();
seedAppData();
startDesktopSession();

try {
  const tests = spawnSync(
    process.execPath,
    ["--test", "--test-concurrency=1", "packaged.test.ts"],
    { cwd: import.meta.dirname, stdio: "inherit" },
  );
  process.exitCode = tests.status ?? 1;
} finally {
  collectArtifacts();
}
