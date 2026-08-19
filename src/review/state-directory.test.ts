// Proves a blank override never becomes a state directory. `BIG_PLAN_STATE_DIR`
// is the one input that can relocate every user-level path, and an empty value
// relocates them to whatever directory the command was run from, which is where
// the service token would then be written.

import { homedir, tmpdir } from "node:os";
import { isAbsolute, join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  candidateStateDirectories,
  primaryStateDirectory,
} from "./state-directory.js";

const previous = process.env["BIG_PLAN_STATE_DIR"];

afterEach(() => {
  if (previous === undefined) {
    delete process.env["BIG_PLAN_STATE_DIR"];
  } else {
    process.env["BIG_PLAN_STATE_DIR"] = previous;
  }
});

describe("user-level state directories", () => {
  it("should prefer home and fall back to the temporary directory", () => {
    delete process.env["BIG_PLAN_STATE_DIR"];
    expect(candidateStateDirectories()).toEqual([
      join(homedir(), ".big-plan"),
      join(tmpdir(), "big-plan"),
    ]);
  });

  it("should honour an explicit override", () => {
    process.env["BIG_PLAN_STATE_DIR"] = join(tmpdir(), "pinned-state");
    expect(candidateStateDirectories()).toEqual([
      join(tmpdir(), "pinned-state"),
    ]);
    expect(primaryStateDirectory()).toBe(join(tmpdir(), "pinned-state"));
  });

  it("should ignore a blank override rather than resolve state relatively", () => {
    for (const value of ["", " ", "\t", "\n  "]) {
      process.env["BIG_PLAN_STATE_DIR"] = value;
      expect(candidateStateDirectories()).toEqual([
        join(homedir(), ".big-plan"),
        join(tmpdir(), "big-plan"),
      ]);
      expect(isAbsolute(primaryStateDirectory())).toBe(true);
    }
  });
});
