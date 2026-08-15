// Covers the reader-progress rule, the one piece of runtime state whose
// meaning is not obvious from its shape: the snapshot the browser is allowed to
// reload advances on the first sighting of an agent response and never again.

import { describe, expect, it } from "vitest";
import { createReaderProgress } from "./review-route-context.js";

describe("createReaderProgress", () => {
  it("starts at the snapshot the runtime opened on", () => {
    const progress = createReaderProgress({
      initialSnapshot: "aaaa",
      observedResponseIds: [],
    });

    expect(progress.currentSnapshot()).toBe("aaaa");
  });

  it("advances on the first sighting of a response", () => {
    const progress = createReaderProgress({
      initialSnapshot: "aaaa",
      observedResponseIds: [],
    });

    progress.observe({ requestId: "r1", resultSnapshot: "bbbb" });

    expect(progress.currentSnapshot()).toBe("bbbb");
  });

  it("ignores a response it has already seen", () => {
    const progress = createReaderProgress({
      initialSnapshot: "aaaa",
      observedResponseIds: [],
    });

    progress.observe({ requestId: "r1", resultSnapshot: "bbbb" });
    progress.accept("cccc");
    progress.observe({ requestId: "r1", resultSnapshot: "bbbb" });

    expect(progress.currentSnapshot()).toBe("cccc");
  });

  it("treats responses present when the runtime started as already seen", () => {
    const progress = createReaderProgress({
      initialSnapshot: "aaaa",
      observedResponseIds: ["r1"],
    });

    progress.observe({ requestId: "r1", resultSnapshot: "bbbb" });

    expect(progress.currentSnapshot()).toBe("aaaa");
  });

  it("advances to the last unseen response when several arrive together", () => {
    const progress = createReaderProgress({
      initialSnapshot: "aaaa",
      observedResponseIds: ["r1"],
    });

    for (const response of [
      { requestId: "r1", resultSnapshot: "bbbb" },
      { requestId: "r2", resultSnapshot: "cccc" },
      { requestId: "r3", resultSnapshot: "dddd" },
    ]) {
      progress.observe(response);
    }

    expect(progress.currentSnapshot()).toBe("dddd");
  });

  it("accepts a snapshot the reviewer reverted to", () => {
    const progress = createReaderProgress({
      initialSnapshot: "aaaa",
      observedResponseIds: [],
    });

    progress.observe({ requestId: "r1", resultSnapshot: "bbbb" });
    progress.accept("aaaa");

    expect(progress.currentSnapshot()).toBe("aaaa");
  });
});
