import { defineConfig, devices } from "@playwright/test";

// The viewer is a static file opened via file://, so no web server is needed.
export default defineConfig({
  testDir: "./test",
  fullyParallel: true,
  forbidOnly: Boolean(process.env["CI"]),
  reporter: "list",
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
});
