import { defineConfig, devices } from "@playwright/test";

// Most viewer journeys open static files, while docs journeys exercise Astro's
// built output through a local static server.
export default defineConfig({
  testDir: "./test",
  fullyParallel: true,
  forbidOnly: Boolean(process.env["CI"]),
  reporter: "list",
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
    command:
      "cd docs && node_modules/.bin/astro build && node_modules/.bin/astro preview --host 127.0.0.1 --port 4321",
    url: "http://127.0.0.1:4321/",
    reuseExistingServer: !process.env["CI"],
  },
});
