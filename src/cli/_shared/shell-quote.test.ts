// Proves quoted values survive a real shell round-trip and never require
// display escaping in structured output.

import { spawnSync } from "node:child_process";
import { describe, expect, it } from "vitest";
import { shellQuote } from "./shell-quote.js";

const roundTripThroughShell = (value: string): string => {
  const result = spawnSync(
    "/bin/sh",
    ["-c", `printf '%s' ${shellQuote(value)}`],
    {
      encoding: "utf8",
    },
  );
  expect(result.status).toBe(0);
  return result.stdout;
};

describe("shellQuote", () => {
  it("should round-trip plain paths through a real shell", () => {
    const value = "/tmp/big-plan/agent prompt.md";
    expect(roundTripThroughShell(value)).toBe(value);
  });

  it("should round-trip single quotes, dollars, and backslashes when the value is hostile", () => {
    const value = 'it\'s "$(rm -rf /)" \\ $HOME `id`';
    expect(roundTripThroughShell(value)).toBe(value);
  });

  it("should add no double quotes of its own so structured output prints the value verbatim", () => {
    expect(shellQuote("/tmp/plan's drafts/plan review.mdx")).not.toContain('"');
  });
});
