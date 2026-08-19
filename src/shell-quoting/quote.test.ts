// Proves the quoting rule against the values that actually break a copied
// command: a path with a space, and a path with an apostrophe in it.

import { execFile } from "node:child_process";
import { describe, expect, it } from "vitest";
import { quoteShellArgument, quoteShellArgumentIfNeeded } from "./quote.js";

// The shell itself is the authority on whether a quoted value is one argument,
// so the assertion asks it rather than restating the quoting rule.
const shellArguments = async (command: string): Promise<Array<string>> =>
  new Promise((settle, fail) => {
    execFile(
      "/bin/sh",
      ["-c", `printf '%s\\n' ${command}`],
      (error, stdout) => {
        if (error !== null) {
          fail(error);
          return;
        }
        settle(stdout.split("\n").filter((line) => line !== ""));
      },
    );
  });

describe("quoting a shell argument", () => {
  it("should keep an awkward path as one argument", async () => {
    for (const value of [
      "/work/My Plans/plan.mdx",
      "/tmp/captain's plan.mdx",
      "/work/$(whoami)/plan.mdx",
      "/work/plan;rm -rf x.mdx",
    ]) {
      await expect(
        shellArguments(quoteShellArgument(value)),
      ).resolves.toEqual([value]);
    }
  });
});

describe("quoting only when the shell needs it", () => {
  it("should leave an ordinary path exactly as it reads", () => {
    expect(quoteShellArgumentIfNeeded("/work/plan.mdx")).toBe(
      "/work/plan.mdx",
    );
    expect(quoteShellArgumentIfNeeded("/Users/me/big_plan-2/plan.mdx")).toBe(
      "/Users/me/big_plan-2/plan.mdx",
    );
  });

  it("should still hand the shell one argument for a path that needs it", async () => {
    for (const value of [
      "/work/My Plans/plan.mdx",
      "/tmp/captain's plan.mdx",
      "",
    ]) {
      await expect(
        shellArguments(quoteShellArgumentIfNeeded(value)),
      ).resolves.toEqual(value === "" ? [] : [value]);
    }
  });
});
