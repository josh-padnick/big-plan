// Runs browser journeys against the build and a docs server owned by this run.

import { defineConfig, devices } from "@playwright/test";

import { createServer } from "node:net";

/** Chooses an available loopback port without reusing another app's server. */
const availablePort = async (): Promise<number> => {
  const server = createServer();
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  await new Promise<void>((resolve, reject) => {
    server.close((error) => (error === undefined ? resolve() : reject(error)));
  });
  if (address === null || typeof address === "string") {
    throw new Error("The docs test server did not receive a TCP port");
  }
  return address.port;
};

// Workers reload this configuration, so inherit the port chosen by the runner.
const inheritedPort = process.env["BIG_PLAN_E2E_DOCS_PORT"];
const docsPort =
  inheritedPort === undefined ? await availablePort() : Number(inheritedPort);
if (!Number.isInteger(docsPort) || docsPort < 1 || docsPort > 65_535) {
  throw new Error("BIG_PLAN_E2E_DOCS_PORT must be a valid TCP port");
}
process.env["BIG_PLAN_E2E_DOCS_PORT"] = String(docsPort);
const docsUrl = `http://127.0.0.1:${docsPort}/`;

export default defineConfig({
  testDir: "./test",
  // Browser journeys are the *.spec.ts files. The behavioral probes under
  // test/probes/ are node:test contract tests for harness-driving scripts and
  // would otherwise be swept up by Playwright's default *.test.* match.
  testMatch: "**/*.spec.ts",
  fullyParallel: true,
  forbidOnly: Boolean(process.env["CI"]),
  // One retry in CI, none locally. A browser journey that fails only under
  // runner contention must not gate a good tree, but a retry that passes is
  // still evidence of an intermittent bug, so nothing here may hide it: the
  // list reporter prints each retried attempt and counts the run's flaky
  // tests, and the GitHub reporter annotates them on the run itself.
  retries: process.env["CI"] ? 1 : 0,
  reporter: process.env["CI"] ? [["list"], ["github"]] : "list",
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"], baseURL: docsUrl },
    },
  ],
  webServer: {
    command: `node docs/node_modules/astro/bin/astro.mjs build --root docs && node docs/node_modules/astro/bin/astro.mjs preview --root docs --host 127.0.0.1 --port ${docsPort}`,
    url: docsUrl,
    reuseExistingServer: false,
  },
});
