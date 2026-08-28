import { defineConfig, devices } from "@playwright/test";

// Most viewer journeys open static files, while docs journeys exercise Astro's
// built output through a local server from the declared Node toolchain. Keep
// this free of undeclared system-runtime dependencies so every journey starts.
export default defineConfig({
  testDir: "./test",
  fullyParallel: true,
  forbidOnly: Boolean(process.env["CI"]),
  reporter: "list",
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
    command:
      "npm exec --prefix docs -- astro build --root docs && npm exec --prefix docs -- astro preview --root docs --host 127.0.0.1 --port 4321",
    url: "http://127.0.0.1:4321/",
    reuseExistingServer: !process.env["CI"],
  },
});
