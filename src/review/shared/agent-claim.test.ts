// Proves the claim-lease rules the whole abandonment decision rests on: what a
// pickup means over time, and the two signals that together prove a claim
// outlived its agent.

import { describe, expect, it } from "vitest";
import {
  AGENT_CLAIM_LEASE_MS,
  claimExplainsQuiet,
  claimIsAbandoned,
  claimIsHeldByAnother,
  claimIsLive,
  claimLeaseExpiryMs,
  claimQuietForMs,
  claimSignalAtMs,
  requestWasClaimed,
} from "./agent-claim.js";
import { AGENT_RECOVERY_HORIZON_MS } from "./agent-timing.js";

const NOW = Date.parse("2026-08-18T12:00:00.000Z");
const holder = "aaaa0000aaaa0000";

/** One claim whose last signal was `quietForMs` ago. */
const claim = (quietForMs: number) => ({
  claimedBy: holder,
  claimExpiresAtMs: claimLeaseExpiryMs(NOW - quietForMs),
});

describe("claim lease facts", () => {
  it("should read a claim's signal time back out of its lease", () => {
    expect(claimSignalAtMs(claim(0))).toBe(NOW);
    expect(claimSignalAtMs({})).toBeUndefined();
    expect(claimSignalAtMs({ claimExpiresAtMs: Number.NaN })).toBeUndefined();
  });

  it("should call a claim live only until its lease lapses", () => {
    expect(claimIsLive({ request: claim(0), nowMs: NOW })).toBe(true);
    expect(
      claimIsLive({ request: claim(AGENT_CLAIM_LEASE_MS - 1), nowMs: NOW }),
    ).toBe(true);
    expect(
      claimIsLive({ request: claim(AGENT_CLAIM_LEASE_MS), nowMs: NOW }),
    ).toBe(false);
    expect(claimIsLive({ request: {}, nowMs: NOW })).toBe(false);
  });

  it("should report contention only for a live claim another session holds", () => {
    const held = { request: claim(0), claimedBy: "bbbb1111bbbb1111" };
    expect(claimIsHeldByAnother({ ...held, nowMs: NOW })).toBe(true);
    expect(
      claimIsHeldByAnother({
        request: claim(0),
        claimedBy: holder,
        nowMs: NOW,
      }),
    ).toBe(false);
    // A lapsed lease is what an ordinary turn leaves behind, so it no longer
    // holds the request against a taker.
    expect(
      claimIsHeldByAnother({
        request: claim(AGENT_CLAIM_LEASE_MS),
        claimedBy: "bbbb1111bbbb1111",
        nowMs: NOW,
      }),
    ).toBe(false);
  });
});

describe("what a pickup means over time", () => {
  it("should treat a pickup as durable, whether or not its lease still holds", () => {
    expect(requestWasClaimed(claim(0))).toBe(true);
    expect(requestWasClaimed(claim(AGENT_RECOVERY_HORIZON_MS * 2))).toBe(true);
    expect(requestWasClaimed({})).toBe(false);
    // Half a claim is not a pickup: both the holder and the lease are needed.
    expect(requestWasClaimed({ claimedBy: holder })).toBe(false);
    expect(requestWasClaimed({ claimExpiresAtMs: NOW })).toBe(false);
  });

  it("should measure quiet from the claim's own signal, never from the lease", () => {
    expect(claimQuietForMs({ request: claim(5_000), nowMs: NOW })).toBe(5_000);
    // A clock that reads behind the signal is reported as no quiet at all
    // rather than as negative time.
    expect(claimQuietForMs({ request: claim(-5_000), nowMs: NOW })).toBe(0);
    expect(claimQuietForMs({ request: {}, nowMs: NOW })).toBeUndefined();
  });

  it("should let a pickup explain silence up to the recovery horizon and no further", () => {
    expect(claimExplainsQuiet({ request: claim(0), nowMs: NOW })).toBe(true);
    expect(
      claimExplainsQuiet({ request: claim(AGENT_CLAIM_LEASE_MS), nowMs: NOW }),
    ).toBe(true);
    // The horizon itself is still explained; one millisecond past it is not.
    expect(
      claimExplainsQuiet({
        request: claim(AGENT_RECOVERY_HORIZON_MS),
        nowMs: NOW,
      }),
    ).toBe(true);
    expect(
      claimExplainsQuiet({
        request: claim(AGENT_RECOVERY_HORIZON_MS + 1),
        nowMs: NOW,
      }),
    ).toBe(false);
    expect(claimExplainsQuiet({ request: {}, nowMs: NOW })).toBe(false);
  });
});

describe("proving a claim abandoned", () => {
  const abandoned = (
    request: Parameters<typeof claimIsAbandoned>[0]["request"],
    agentConnected: boolean,
  ) => claimIsAbandoned({ request, agentConnected, nowMs: NOW });

  it("should need both signals, because neither is evidence alone", () => {
    expect(abandoned(claim(AGENT_RECOVERY_HORIZON_MS + 1), false)).toBe(true);
    // An attached agent may be the holder, so the same silence proves nothing.
    expect(abandoned(claim(AGENT_RECOVERY_HORIZON_MS + 1), true)).toBe(false);
    // A lapsed lease with nothing attached is every ordinary turn.
    expect(abandoned(claim(AGENT_CLAIM_LEASE_MS * 2), false)).toBe(false);
  });

  it("should hold the boundary at the horizon rather than one side of it", () => {
    expect(abandoned(claim(AGENT_RECOVERY_HORIZON_MS), false)).toBe(false);
    expect(abandoned(claim(AGENT_RECOVERY_HORIZON_MS + 1), false)).toBe(true);
  });

  it("should never prove abandonment without a claim to prove it about", () => {
    expect(abandoned({}, false)).toBe(false);
    // A claim stored without its lease can never be proven abandoned, which is
    // the safe direction: what cannot be proven keeps the request locked.
    expect(abandoned({ claimedBy: holder }, false)).toBe(false);
  });
});
