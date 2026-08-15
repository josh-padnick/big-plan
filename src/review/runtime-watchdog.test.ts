// The watchdog decides what a stalled review session says about itself, so
// these tests fix the boundary cases the decision is only useful at: a
// mutation exactly on the bound, one that merely waited its turn, and growth
// that has not moved since it was last reported.

import { describe, expect, it } from "vitest";
import {
  createMutationRegistry,
  describeRuntimeDiagnostics,
  growthMilestone,
  stalledMutations,
} from "./runtime-watchdog.js";

describe("stalled mutations", () => {
  it("should report nothing when every mutation is younger than the bound", () => {
    expect(
      stalledMutations({
        inFlight: [
          { id: "1", route: "PUT /api/drafts", startedAtMs: 1_000 },
          { id: "2", route: "POST /api/feedback", startedAtMs: 5_000 },
        ],
        nowMs: 10_000,
        boundMs: 30_000,
      }),
    ).toEqual([]);
  });

  it("should report a mutation that has reached the bound exactly", () => {
    expect(
      stalledMutations({
        inFlight: [{ id: "1", route: "PUT /api/drafts", startedAtMs: 0 }],
        nowMs: 30_000,
        boundMs: 30_000,
      }),
    ).toEqual([{ id: "1", route: "PUT /api/drafts", ageMs: 30_000 }]);
  });

  it("should order stalled mutations oldest first and leave younger ones out", () => {
    expect(
      stalledMutations({
        inFlight: [
          { id: "1", route: "PUT /api/drafts", startedAtMs: 20_000 },
          { id: "2", route: "POST /api/feedback", startedAtMs: 1_000 },
          { id: "3", route: "POST /api/agent-requests", startedAtMs: 80_000 },
        ],
        nowMs: 100_000,
        boundMs: 30_000,
      }).map((mutation) => mutation.route),
    ).toEqual(["POST /api/feedback", "PUT /api/drafts"]);
  });

  it("should report nothing when no mutation is in flight", () => {
    expect(
      stalledMutations({ inFlight: [], nowMs: 100_000, boundMs: 30_000 }),
    ).toEqual([]);
  });
});

describe("growth milestones", () => {
  it("should stay on the same milestone until the largest count crosses again", () => {
    const threshold = 1_000;
    const first = growthMilestone({
      growth: { progressLines: 1_200, agentRequests: 4, agentResponses: 4 },
      threshold,
    });
    const unchanged = growthMilestone({
      growth: { progressLines: 1_900, agentRequests: 4, agentResponses: 4 },
      threshold,
    });
    const crossed = growthMilestone({
      growth: { progressLines: 2_000, agentRequests: 4, agentResponses: 4 },
      threshold,
    });
    expect([first, unchanged, crossed]).toEqual([1, 1, 2]);
  });

  it("should report no milestone for a session that has written nothing", () => {
    expect(
      growthMilestone({
        growth: { progressLines: 0, agentRequests: 0, agentResponses: 0 },
        threshold: 1_000,
      }),
    ).toBe(0);
  });

  it("should take the milestone from whichever count grew fastest", () => {
    expect(
      growthMilestone({
        growth: { progressLines: 10, agentRequests: 40, agentResponses: 3_100 },
        threshold: 1_000,
      }),
    ).toBe(3);
  });
});

describe("the mutation registry", () => {
  it("should keep a mutation in flight until its own work settles", () => {
    const registry = createMutationRegistry();
    const settleFirst = registry.begin({
      route: "PUT /api/drafts",
      atMs: 1_000,
    });
    registry.begin({ route: "POST /api/feedback", atMs: 2_000 });
    expect(registry.inFlight()).toHaveLength(2);
    settleFirst();
    expect(registry.inFlight()).toEqual([
      { id: "2", route: "POST /api/feedback", startedAtMs: 2_000 },
    ]);
  });

  it("should ignore a mutation settled more than once", () => {
    const registry = createMutationRegistry();
    const settle = registry.begin({ route: "PUT /api/drafts", atMs: 1_000 });
    settle();
    settle();
    expect(registry.inFlight()).toEqual([]);
  });
});

describe("the diagnostics dump", () => {
  it("should name every stalled route and the growth counts", () => {
    const dump = describeRuntimeDiagnostics({
      sessionId: "0123456789abcdef",
      planPath: "/plans/plan.mdx",
      nowMs: 100_000,
      inFlight: [{ id: "1", route: "PUT /api/drafts", startedAtMs: 10_000 }],
      stalled: [{ id: "1", route: "PUT /api/drafts", ageMs: 90_000 }],
      growth: { progressLines: 12, agentRequests: 3, agentResponses: 2 },
    });
    expect(dump).toContain("session 0123456789abcdef");
    expect(dump).toContain("in-flight mutations: 1");
    expect(dump).toContain("PUT /api/drafts has not settled for 90s");
    expect(dump).toContain("12 progress lines");
  });

  it("should report a healthy runtime without inventing a stall", () => {
    const dump = describeRuntimeDiagnostics({
      sessionId: "0123456789abcdef",
      planPath: "/plans/plan.mdx",
      nowMs: 100_000,
      inFlight: [],
      stalled: [],
    });
    expect(dump).toContain("in-flight mutations: 0");
    expect(dump).not.toContain("stalled");
    expect(dump).not.toContain("growth");
  });
});
