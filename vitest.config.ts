import { defineConfig } from "vitest/config";

// Only colocated unit tests run under vitest; test/*.spec.ts is Playwright's.
export default defineConfig({
  test: {
    include: ["src/**/*.test.ts"],
  },
});
