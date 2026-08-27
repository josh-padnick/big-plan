// Covers the two questions the arrival entry answers in words: when the push
// landed, and which agent pushed it.
//
// The identity half is the part worth pinning. The entry sits beside the
// roster card for the same agent, so the two have to name it identically -
// including the case the roster exists to handle, where two connectors running
// the same model are one name and two agents.

import { describe, expect, it } from "vitest";
import {
  pushArrivalAgentLabel,
  pushArrivalChangeLabel,
  pushArrivalTimeLabel,
} from "./push-arrival-entry.browser.js";
import { agentLabelResolver } from "../shared/agent-primacy.js";
import type { PushArrival } from "../shared/push-arrival.js";

const NOW = 1_787_115_000_000;

const arrival = (overrides: Partial<PushArrival> = {}): PushArrival => ({
  requestId: "request-one",
  threadId: "thread-one",
  resultSnapshot: "snapshot-one",
  arrivedAt: new Date(NOW).toISOString(),
  changeTargets: ["document/paragraph-1"],
  ...overrides,
});

describe("pushArrivalTimeLabel", () => {
  it("should call an arrival just landed just now", () => {
    expect(
      pushArrivalTimeLabel({
        arrivedAt: new Date(NOW).toISOString(),
        nowMs: NOW,
      }),
    ).toBe("Pushed just now");
  });

  it("should age honestly once the arrival is no longer fresh", () => {
    expect(
      pushArrivalTimeLabel({
        arrivedAt: new Date(NOW - 300_000).toISOString(),
        nowMs: NOW,
      }),
    ).toBe("Pushed 5m ago");
  });

  it("should fall back to just now rather than report an unusable clock", () => {
    expect(pushArrivalTimeLabel({ arrivedAt: "not a time", nowMs: NOW })).toBe(
      "Pushed just now",
    );
  });
});

describe("pushArrivalChangeLabel", () => {
  it("should count a single changed block in the singular", () => {
    expect(pushArrivalChangeLabel(["a"])).toBe("1 block changed in the plan.");
  });

  it("should count several changed blocks in the plural", () => {
    expect(pushArrivalChangeLabel(["a", "b"])).toBe(
      "2 blocks changed in the plan.",
    );
  });

  it("should say nothing at all for a push that revised nothing", () => {
    expect(pushArrivalChangeLabel([])).toBeNull();
  });
});

describe("pushArrivalAgentLabel", () => {
  const opusA = {
    writerId: "aaaaaaaaaaaaa38a",
    model: { name: "claude-opus-5" },
  };
  const opusB = {
    writerId: "bbbbbbbbbbbbb12c",
    model: { name: "claude-opus-5" },
  };
  const labelFor = agentLabelResolver([opusA, opusB]);
  const labelOf = (claimedBy: string): string =>
    pushArrivalAgentLabel({
      arrival: arrival({ claimedBy, model: { name: "claude-opus-5" } }),
      labelFor,
    });

  it("should name each connector exactly as the roster names it", () => {
    expect(labelOf(opusA.writerId)).toBe(labelFor(opusA));
    expect(labelOf(opusB.writerId)).toBe(labelFor(opusB));
  });

  it("should tell two connectors on the same model apart", () => {
    expect(labelOf(opusA.writerId)).not.toBe(labelOf(opusB.writerId));
  });

  it("should spend no id when the model name already names the agent", () => {
    expect(
      pushArrivalAgentLabel({
        arrival: arrival({
          claimedBy: opusA.writerId,
          model: { name: "claude-opus-5" },
        }),
        labelFor: agentLabelResolver([opusA]),
      }),
    ).toBe("Claude Opus 5");
  });

  it("should name a push with no recorded claim by what it declared", () => {
    expect(
      pushArrivalAgentLabel({
        arrival: arrival({ model: { name: "claude-opus-5" } }),
        labelFor,
      }),
    ).toBe("Claude Opus 5");
  });

  it("should fall back to a generic name when the push declared nothing", () => {
    expect(pushArrivalAgentLabel({ arrival: arrival(), labelFor })).toBe(
      "Agent",
    );
  });
});
