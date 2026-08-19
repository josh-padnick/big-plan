// Covers the connection log's pure readings, which decide what the reviewer is
// told a silence means, and the marker paint rule that keeps a timeline dot
// round and filled.

import { describe, expect, it } from "vitest";
import {
  connectionEventEnded,
  connectionLogRowReading,
  connectionMarkerClassName,
  summarizeAgentConnection,
} from "./agent-connection.browser.js";
import { AGENT_SESSION_ENDED_REASON } from "../shared/agent-status.js";

describe("connectionEventEnded", () => {
  it("recognizes the edge the runtime writes for a reported end", () => {
    expect(
      connectionEventEnded({
        connected: false,
        reason: AGENT_SESSION_ENDED_REASON,
      }),
    ).toBe(true);
  });

  it("leaves an aged-out edge and a connect edge alone", () => {
    expect(
      connectionEventEnded({
        connected: false,
        reason: "No agent signal within 75 seconds",
      }),
    ).toBe(false);
    expect(connectionEventEnded({ connected: true })).toBe(false);
  });
});

describe("connectionLogRowReading", () => {
  it("narrates a reported end as an end", () => {
    expect(
      connectionLogRowReading({
        connected: false,
        ended: true,
        nextConnected: undefined,
        knownSession: true,
      }),
    ).toEqual({
      label: "Session ended",
      prefix: "Ended ",
      suffix: " ago",
      // The row is already headed "Session ended"; repeating the stored reason
      // under it would say the same thing twice.
      showReason: false,
    });
  });

  it("narrates an unreported gap as a quiet period", () => {
    expect(
      connectionLogRowReading({
        connected: false,
        ended: false,
        nextConnected: undefined,
        knownSession: true,
      }),
    ).toEqual({
      label: "No signal",
      prefix: "Quiet for ",
      suffix: "",
      // The stored reason names the threshold, which no label states.
      showReason: true,
    });
  });

  it("measures the gap once the signal returns, however it started", () => {
    expect(
      connectionLogRowReading({
        connected: false,
        ended: true,
        nextConnected: true,
        knownSession: true,
      }),
    ).toEqual({
      label: "Session ended",
      prefix: "Signal returned after ",
      // Not "quiet": the gap after a reported end is a measured interval, not
      // a silence anyone had to interpret.
      suffix: "",
      showReason: false,
    });
    expect(
      connectionLogRowReading({
        connected: false,
        ended: false,
        nextConnected: true,
        knownSession: false,
      }),
    ).toEqual({
      label: "No signal",
      prefix: "First signal after ",
      suffix: " quiet",
      showReason: true,
    });
  });

  it("leaves connected rows unchanged", () => {
    expect(
      connectionLogRowReading({
        connected: true,
        ended: false,
        nextConnected: false,
        knownSession: true,
      }),
    ).toEqual({
      label: "Connected",
      prefix: "Connected for ",
      suffix: "",
      showReason: true,
    });
  });
});

describe("summarizeAgentConnection", () => {
  const at = (minute: number) =>
    `2026-08-19T10:${String(minute).padStart(2, "0")}:00.000Z`;
  const quietEdge = (minute: number) => ({
    connected: false,
    at: at(minute),
    reason: "No agent signal within 75 seconds",
  });
  const endedEdge = (minute: number) => ({
    connected: false,
    at: at(minute),
    reason: AGENT_SESSION_ENDED_REASON,
  });
  const connectedEdge = (minute: number) => ({
    connected: true,
    at: at(minute),
  });

  it("counts a reported end apart from an inferred gap", () => {
    expect(
      summarizeAgentConnection({
        events: [
          connectedEdge(1),
          quietEdge(2),
          connectedEdge(3),
          endedEdge(4),
          connectedEdge(5),
        ],
      }),
    ).toMatchObject({ quietPeriods: 1, sessionsEnded: 1, resumed: 2 });
  });

  it("counts nothing for a session that has only ever been connected", () => {
    expect(
      summarizeAgentConnection({ events: [connectedEdge(1)] }),
    ).toMatchObject({ quietPeriods: 0, sessionsEnded: 0, resumed: 0 });
  });

  it("does not count a first signal as a resumption", () => {
    // The store's opening edge can be a disconnect, and the connect that
    // follows it is the session starting rather than recovering (BIG-147).
    expect(
      summarizeAgentConnection({ events: [quietEdge(1), connectedEdge(2)] }),
    ).toMatchObject({ quietPeriods: 0, sessionsEnded: 0, resumed: 0 });
  });
});

describe("connectionMarkerClassName", () => {
  const states = [
    { name: "connected", input: { connected: true, isLatest: false } },
    {
      name: "the latest quiet entry",
      input: { connected: false, isLatest: true },
    },
    {
      name: "a settled quiet entry",
      input: { connected: false, isLatest: false },
    },
  ];

  it.each(states)("names exactly one background for $name", ({ input }) => {
    // Two background utilities in one class list are decided by the order the
    // generated stylesheet emits them, not by the order they are written, so a
    // second one is never an override - it is a coin flip. Carrying `bg-paper`
    // in the base is what made every connected marker render hollow (BIG-176).
    const backgrounds = connectionMarkerClassName(input)
      .split(" ")
      .filter((utility) => utility.startsWith("bg-"));
    expect(backgrounds).toHaveLength(1);
  });

  it.each(states)("draws a circle for $name", ({ input }) => {
    // A marker is round because width and height agree and the radius is a
    // pill. Nothing here may set a height on its own.
    const utilities = connectionMarkerClassName(input).split(" ");
    expect(utilities).toContain("size-[6px]");
    expect(utilities).toContain("rounded-full");
    expect(
      utilities.filter((utility) => /^(min-)?h-/.test(utility)),
    ).toHaveLength(0);
  });

  it("fills a connected entry with the colour it outlines", () => {
    const utilities = connectionMarkerClassName({
      connected: true,
      isLatest: false,
    }).split(" ");
    expect(utilities).toContain("bg-[var(--diff-add-c)]");
    expect(utilities).toContain("border-[var(--diff-add-c)]");
  });

  it("leaves a settled quiet entry hollow against the page ground", () => {
    const utilities = connectionMarkerClassName({
      connected: false,
      isLatest: false,
    }).split(" ");
    expect(utilities).toContain("bg-paper");
    expect(utilities).toContain("border-muted");
  });
});
