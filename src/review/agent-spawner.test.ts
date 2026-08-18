// Covers the rule that ends a connection loop whose spawner died.

import { describe, expect, it } from "vitest";
import { spawnerIsGone } from "./agent-spawner.js";

describe("spawnerIsGone", () => {
  it("reads a reparented process as a dead spawner", () => {
    expect(spawnerIsGone({ recordedPpid: 49435, livePpid: 1 })).toBe(true);
  });

  it("keeps waiting while the recorded parent is still the live one", () => {
    expect(spawnerIsGone({ recordedPpid: 49435, livePpid: 49435 })).toBe(false);
  });

  it("never triggers for a loop that started detached", () => {
    // An intentionally detached loop is already parented to pid 1, so no
    // change can ever be observed and today's waiting behavior stands.
    expect(spawnerIsGone({ recordedPpid: 1, livePpid: 1 })).toBe(false);
  });

  it("reads any reparenting as death, not only reparenting to pid 1", () => {
    // Linux subreapers adopt orphans without pid 1 ever appearing.
    expect(spawnerIsGone({ recordedPpid: 49435, livePpid: 902 })).toBe(true);
  });
});
