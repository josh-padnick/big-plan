// Verifies the captain-facing docs domain wizard through its executable interface.

import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { describe, expect, it } from "vitest";

const execFileAsync = promisify(execFile);
const WIZARD_PATH = new URL(
  "../../scripts/docs-domain-wizard.sh",
  import.meta.url,
);

describe("docs domain wizard", () => {
  it("should explain its setup and verification modes without requiring network tools", async () => {
    const { stderr, stdout } = await execFileAsync("bash", [
      WIZARD_PATH.pathname,
      "--help",
    ]);

    expect(stderr).toBe("");
    expect(stdout).toContain(
      "Usage: scripts/docs-domain-wizard.sh [--check|--help]",
    );
    expect(stdout).toContain("finish with read-only verification");
    expect(stdout).toContain("DNS-provider settings.");
  });
});
