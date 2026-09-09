// Runs browser journeys against the build and a docs server owned by this run.

import { defineConfig, devices } from "@playwright/test";

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
      use: { ...devices["Desktop Chrome"] },
    },
  ],
  webServer: {
    command:
      "node _docs/node_modules/astro/bin/astro.mjs build --root _docs && node _docs/scripts/preview-for-tests.mjs",
    wait: {
      stdout:
        /BIG_PLAN_DOCS_READY (?<big_plan_e2e_docs_url>http:\/\/127\.0\.0\.1:\d+\/)/,
    },
    reuseExistingServer: false,
  },
});
