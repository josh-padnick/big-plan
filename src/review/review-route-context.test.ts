// Covers the two pieces of runtime state whose meaning is not obvious from
// their shape: the snapshot the browser is allowed to reload advances on the
// first sighting of an agent response and never again, and the write gate
// gives up on one mutation rather than on the whole session (BIG-44).

import { describe, expect, it } from "vitest";
import {
  createReaderProgress,
  createWriteGate,
} from "./review-route-context.js";
import {
  createMutationRegistry,
  ReviewWriteStalled,
} from "./runtime-watchdog.js";

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

describe("createWriteGate", () => {
  const gateFor = (stallMs: number) =>
    createWriteGate({ mutations: createMutationRegistry(), stallMs });

  it("runs one mutation at a time in the order they arrived", async () => {
    const gate = gateFor(1_000);
    const order: Array<string> = [];
    let active = 0;
    let mostActive = 0;
    const write = (name: string) =>
      gate.exclusively({
        route: `PUT /api/${name}`,
        work: async () => {
          active += 1;
          mostActive = Math.max(mostActive, active);
          await new Promise((settle) => setTimeout(settle, 5));
          active -= 1;
          order.push(name);
        },
      });

    await Promise.all([write("first"), write("second"), write("third")]);

    expect(order).toEqual(["first", "second", "third"]);
    expect(mostActive).toBe(1);
  });

  it("gives up on one mutation that never settles and runs the next", async () => {
    const gate = gateFor(40);
    const stuck = gate.exclusively({
      route: "PUT /api/drafts",
      work: () => new Promise<void>(() => undefined),
    });

    await expect(stuck).rejects.toBeInstanceOf(ReviewWriteStalled);
    await expect(
      gate.exclusively({
        route: "POST /api/feedback",
        work: async () => "written",
      }),
    ).resolves.toBe("written");
  });

  it("reports how long the oldest abandoned mutation has been stuck", async () => {
    const gate = gateFor(20);
    expect(gate.stalledForMs()).toBeUndefined();

    await gate
      .exclusively({
        route: "PUT /api/drafts",
        work: () => new Promise<void>(() => undefined),
      })
      .catch(() => undefined);

    expect(gate.stalledForMs()).toBeGreaterThanOrEqual(20);
  });

  it("reports no stall for a mutation that is merely still running", async () => {
    const gate = gateFor(60_000);
    let release = (): void => undefined;
    const held = new Promise<void>((settle) => {
      release = settle;
    });
    const running = gate.exclusively({
      route: "PUT /api/drafts",
      work: () => held,
    });
    await new Promise((settle) => setTimeout(settle, 5));

    expect(gate.stalledForMs()).toBeUndefined();
    release();
    await running;
    expect(gate.stalledForMs()).toBeUndefined();
  });
});
