// Covers the one-telling rule shared by sidebar lifecycle groups and rows.

import { describe, expect, it } from "vitest";

import { pendingThreadGroup, threadSubstate } from "./thread-group.js";

describe("pendingThreadGroup", () => {
  it("should call a connected queue Waiting and a disconnected queue Blocked", () => {
    expect(pendingThreadGroup(true)).toEqual({
      key: "waiting",
      label: "Waiting",
    });
    expect(pendingThreadGroup(false)).toEqual({
      key: "blocked",
      label: "Blocked",
    });
  });
});

describe("threadSubstate", () => {
  it("should expose only working and stalled states below a shared group", () => {
    expect(threadSubstate("working")).toBe("working");
    expect(threadSubstate("stalled")).toBe("stalled");
    expect(threadSubstate("waiting")).toBeNull();
    expect(threadSubstate("blocked")).toBeNull();
    expect(threadSubstate("outcome")).toBeNull();
  });
});
