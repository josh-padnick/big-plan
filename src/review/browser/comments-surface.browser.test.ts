import { describe, expect, it } from "vitest";
import { batchSectionTone } from "./comments-surface.browser.js";
import type { AgentStatus } from "../shared/agent-status.js";

const status = (overrides: Partial<AgentStatus> = {}): AgentStatus => ({
  stage: "working",
  label: "Agent working",
  headline: "Agent is working on this",
  detail: "",
  tone: "positive",
  ...overrides,
});

describe("batch section tone", () => {
  // BIG-147. Warning is the tone of an ordinary long turn, so demoting it would
  // swap the spinner for an hourglass every time the agent went quiet and back
  // on the next note, relabelling started work as queued through a treatment.
  it("should keep a quiet turn in the picked-up treatment", () => {
    expect(
      batchSectionTone({
        status: status({ stage: "stalled", label: "Working", tone: "warning" }),
      }),
    ).toBe("working");
    expect(batchSectionTone({ status: status() })).toBe("working");
  });

  it("should demote a batch whose reading has turned to danger", () => {
    expect(
      batchSectionTone({
        status: status({
          stage: "stalled",
          label: "No longer reporting",
          tone: "danger",
        }),
      }),
    ).toBe("queued");
  });

  // BIG-158. The reviewer sends B1, the agent claims it and works, then the
  // reviewer sends B2. B2 heads the section while B1's threads fill the rail's
  // working group, so a rail-wide count put the spinner beside B2's own
  // "Queued, 1 ahead" label - asserting work nothing had picked up.
  it("should queue a batch nobody has picked up while an earlier batch works", () => {
    expect(
      batchSectionTone({
        status: status({
          stage: "waiting",
          label: "Queued, 1 ahead",
          headline: "Waiting for an agent",
          tone: "neutral",
        }),
      }),
    ).toBe("queued");
  });

  it("should queue a batch that cannot start because no agent is connected", () => {
    expect(
      batchSectionTone({
        status: status({
          stage: "blocked",
          label: "Blocked",
          headline: "Blocked - no agent connected",
          tone: "warning",
        }),
      }),
    ).toBe("queued");
  });
});
