import { readFileSync } from "node:fs";
import { defineConfig } from "vitest/config";

// Only colocated unit tests run under vitest; test/*.spec.ts is Playwright's.
export default defineConfig({
  // Root tests must not require the separately installed docs toolchain.
  esbuild: {
    tsconfigRaw: readFileSync(
      new URL("./tsconfig.json", import.meta.url),
      "utf8",
    ),
  },
  test: {
    include: ["src/**/*.test.ts", "docs/src/**/*.test.ts"],
    // Several document-delivery suites start the pinned browser synchronously.
    // Bound file concurrency so those processes cannot starve one another on
    // the fixed-capacity CI runners and turn honest render work into timeouts.
    maxWorkers: 2,
  },
});
