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
        workingCount: 3,
      }),
    ).toBe("working");
    expect(batchSectionTone({ status: status(), workingCount: 3 })).toBe(
      "working",
    );
  });

  it("should demote a batch whose reading has turned to danger", () => {
    expect(
      batchSectionTone({
        status: status({
          stage: "stalled",
          label: "No longer reporting",
          tone: "danger",
        }),
        workingCount: 3,
      }),
    ).toBe("queued");
  });

  it("should demote a batch whose cards have left the working group", () => {
    expect(batchSectionTone({ status: status(), workingCount: 0 })).toBe(
      "queued",
    );
  });
});
