// Covers the agent-health surface's pure readings, which decide what the
// reviewer is told a silence means.

import { describe, expect, it } from "vitest";
import {
  connectionEventEnded,
  connectionHealthReading,
  connectionLogRowReading,
  connectionLogState,
  connectionLogTally,
  connectionLogTallyLabel,
} from "./agent-connection.browser.js";
import { AGENT_SESSION_ENDED_REASON } from "../shared/agent-status.js";

const HEARTBEAT_AT = 1_775_000_000_000;
const ENDED_AT = HEARTBEAT_AT + 400;

describe("connectionHealthReading", () => {
  it("reports a live connection", () => {
    expect(
      connectionHealthReading({ connected: true, heartbeatAt: HEARTBEAT_AT }),
    ).toEqual({
      state: "connected",
      headline: "Agent connected",
      badge: "online",
      connection: "Healthy",
      signalTerm: "Last signal",
      signalAtMs: HEARTBEAT_AT,
    });
  });

  it("names a reported end instead of a missing signal", () => {
    expect(
      connectionHealthReading({
        connected: false,
        heartbeatAt: HEARTBEAT_AT,
        endedAtMs: ENDED_AT,
      }),
    ).toEqual({
      state: "ended",
      headline: "Agent session ended",
      badge: "ended",
      connection: "Session ended",
      signalTerm: "Ended",
      // The label says "Ended", so it has to date itself from the end and not
      // from the last heartbeat that happened to precede it.
      signalAtMs: ENDED_AT,
    });
  });

  it("keeps calling an unreported silence a silence", () => {
    // Nothing observed this end, so the card must not claim one (BIG-147).
    expect(
      connectionHealthReading({ connected: false, heartbeatAt: HEARTBEAT_AT }),
    ).toEqual({
      state: "quiet",
      headline: "No recent agent signal",
      badge: "quiet",
      connection: "No signal",
      signalTerm: "Last signal",
      signalAtMs: HEARTBEAT_AT,
    });
  });
});

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

const quietEdge = {
  connected: false,
  reason: "No agent signal within 75 seconds",
};
const endedEdge = { connected: false, reason: AGENT_SESSION_ENDED_REASON };
const connectedEdge = { connected: true };

describe("connectionLogState", () => {
  it("answers with the same word as the card above it", () => {
    expect(connectionLogState({ connected: false, ended: true })).toBe(
      "SESSION ENDED",
    );
    expect(connectionLogState({ connected: false, ended: false })).toBe(
      "NO SIGNAL",
    );
    expect(connectionLogState({ connected: true, ended: false })).toBe(
      "CONNECTED",
    );
  });
});

describe("connectionLogTally", () => {
  it("counts a reported end apart from an inferred gap", () => {
    expect(
      connectionLogTally([
        connectedEdge,
        quietEdge,
        connectedEdge,
        endedEdge,
        connectedEdge,
      ]),
    ).toEqual({ quietPeriods: 1, sessionsEnded: 1, resumed: 2 });
  });

  it("counts nothing for a session that has only ever been connected", () => {
    expect(connectionLogTally([connectedEdge])).toEqual({
      quietPeriods: 0,
      sessionsEnded: 0,
      resumed: 0,
    });
  });

  it("does not count a first signal as a resumption", () => {
    // The store's opening edge can be a disconnect, and the connect that
    // follows it is the session starting rather than recovering (BIG-147).
    expect(connectionLogTally([quietEdge, connectedEdge])).toEqual({
      quietPeriods: 0,
      sessionsEnded: 0,
      resumed: 0,
    });
  });
});

describe("connectionLogTallyLabel", () => {
  it("stays out of the way until a session has actually ended", () => {
    expect(
      connectionLogTallyLabel({
        quietPeriods: 2,
        sessionsEnded: 0,
        resumed: 1,
      }),
    ).toBe("2 quiet periods · 1 resumed");
  });

  it("names ended sessions once there are some", () => {
    expect(
      connectionLogTallyLabel({
        quietPeriods: 1,
        sessionsEnded: 1,
        resumed: 2,
      }),
    ).toBe("1 quiet period · 1 ended session · 2 resumed");
  });
});
