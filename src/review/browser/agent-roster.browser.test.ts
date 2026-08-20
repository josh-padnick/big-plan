// Covers the rail's own reading of the roster: who it draws, and the one
// question that decides whether the reviewer sees any of it.
//
// The hiding rule is the part worth pinning. It exists to keep the steady
// state quiet, and it once hid the only control that could give a review its
// primary back.

import { describe, expect, it } from "vitest";
import { readAgentRosterFor } from "./agent-roster.browser.js";
import type { RosterAgent } from "../shared/agent-primacy.js";

const NOW = 1_787_115_000_000;

const agent = (overrides: Partial<RosterAgent> = {}): RosterAgent => ({
  writerId: "aaaaaaaa",
  role: "primary",
  attachedAtMs: NOW - 10_000,
  signalAtMs: NOW,
  attached: true,
  ...overrides,
});

describe("readAgentRosterFor", () => {
  it("should stay quiet while one agent is answering and asking nothing", () => {
    expect(readAgentRosterFor({ agents: [agent()], nowMs: NOW }).isShown).toBe(
      false,
    );
  });

  it("should appear as soon as there is more than one agent to tell apart", () => {
    const reading = readAgentRosterFor({
      agents: [agent(), agent({ writerId: "bbbbbbbb", role: "observer" })],
      nowMs: NOW,
    });
    expect(reading.isShown).toBe(true);
    expect(reading.attached).toHaveLength(2);
  });

  it("should appear whenever nobody is answering the review", () => {
    /*
    The dead end this rule exists to prevent. The reviewer disconnects the
    primary - deliberately leaving the seat empty - and a watching agent is all
    that is left. Nothing succeeds into a seat they emptied, so the cards are
    the only way to appoint anyone; hidden, the review has nobody able to
    answer and no control that changes it.
    */
    const reading = readAgentRosterFor({
      agents: [agent({ role: "observer" })],
      nowMs: NOW,
    });
    expect(reading.isShown).toBe(true);
    expect(reading.primary).toBeUndefined();
    expect(reading.requesting).toBeUndefined();
  });

  it("should surface a pending question even from a single agent", () => {
    const reading = readAgentRosterFor({
      agents: [agent({ role: "observer", requestedPrimacyAtMs: NOW - 1_000 })],
      nowMs: NOW,
    });
    expect(reading.isShown).toBe(true);
    expect(reading.requesting?.writerId).toBe("aaaaaaaa");
  });

  it("should leave a record the server no longer counts as attached out", () => {
    const reading = readAgentRosterFor({
      agents: [agent(), agent({ writerId: "gone", attached: false })],
      nowMs: NOW,
    });
    expect(reading.attached.map(({ writerId }) => writerId)).toEqual([
      "aaaaaaaa",
    ]);
    expect(reading.isShown).toBe(false);
  });
});
