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
  },
});
