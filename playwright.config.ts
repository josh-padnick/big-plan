import { defineConfig, devices } from "@playwright/test";

const ciRunId = process.env["GITHUB_RUN_ID"];
const ciPort = ciRunId
  ? 20_000 + (Number.parseInt(ciRunId.slice(-4), 10) % 10_000)
  : 4_321;
const docsPort = ciPort + (process.env["BIG_PLAN_PROXY"] === "0" ? 10_000 : 0);
const docsUrl = `http://127.0.0.1:${docsPort}/`;

// Most viewer journeys open static files, while docs journeys exercise Astro's
// built output through a local server from the declared Node toolchain. Keep
// each CI run and proxy mode on its own port because self-hosted runners may
// execute them concurrently.
export default defineConfig({
  testDir: "./test",
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
    reuseExistingServer: !process.env["CI"],
  },
});
