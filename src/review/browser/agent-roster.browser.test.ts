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
    expect(
      readAgentRosterFor({
        agents: [agent()],
        nowMs: NOW,
        carriedByActivity: "aaaaaaaa",
      }).isShown,
    ).toBe(false);
  });

  it("should draw the primary itself when the status card is not drawing it", () => {
    /*
    The status card is the primary's card whenever it has one to draw. When it
    has not - presence lapsed, or it is naming somebody else for a poll - the
    reviewer would otherwise be shown a review with an attached agent and no
    card saying so, which is the failure the hiding rule keeps re-creating.
    */
    const reading = readAgentRosterFor({ agents: [agent()], nowMs: NOW });
    expect(reading.carried).toBeUndefined();
    expect(reading.cards.map(({ writerId }) => writerId)).toEqual(["aaaaaaaa"]);
    expect(reading.isShown).toBe(true);
  });

  it("should draw each agent once when the status card carries the primary", () => {
    const reading = readAgentRosterFor({
      agents: [agent(), agent({ writerId: "bbbbbbbb", role: "observer" })],
      nowMs: NOW,
      carriedByActivity: "aaaaaaaa",
    });
    expect(reading.carried).toBe("aaaaaaaa");
    expect(reading.cards.map(({ writerId }) => writerId)).toEqual(["bbbbbbbb"]);
  });

  it("should draw each agent once when presence trails a primary handoff", () => {
    /*
    The two surfaces read different records and can name different agents for
    a poll after a hand-off. The status card still draws the outgoing agent, so
    the roster must omit that same agent while drawing the incoming primary.
    */
    const reading = readAgentRosterFor({
      agents: [agent(), agent({ writerId: "bbbbbbbb", role: "observer" })],
      nowMs: NOW,
      carriedByActivity: "bbbbbbbb",
    });
    expect(reading.carried).toBe("bbbbbbbb");
    expect(reading.cards.map(({ writerId }) => writerId)).toEqual(["aaaaaaaa"]);
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
      carriedByActivity: "aaaaaaaa",
    });
    expect(reading.attached.map(({ writerId }) => writerId)).toEqual([
      "aaaaaaaa",
    ]);
    expect(reading.isShown).toBe(false);
  });
});
