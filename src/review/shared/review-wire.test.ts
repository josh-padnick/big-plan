// Proves the server encoder and browser decoder share one review transport
// contract, including feedback target projection and stable progress codes.

import { describe, expect, it } from "vitest";
import {
  decodeAgentSnapshot,
  decodeProgress,
  decodeRuntimeSession,
  decodeReviewSnapshot,
  decodeSnapshotDiff,
  encodeAgentSnapshot,
  encodeProgress,
  encodeRuntimeSession,
  encodeSnapshotDiff,
  type SnapshotDiff,
} from "./review-wire.js";

describe("review wire contract", () => {
  it("should load reviewer state a runtime of another vintage stored", () => {
    const decoded = decodeReviewSnapshot({
      drafts: [
        {
          id: "aabbccdd",
          body: "Anchored and unsent.",
          createdAt: "2026-08-10T12:00:00.000Z",
          premiseSnapshot: "a".repeat(16),
          target: { type: "document" },
        },
      ],
      sent: [],
      // A field this contract no longer names, as an earlier runtime wrote it.
      activeDraft: "Text no composer will ever read back.",
      resolvedCommentIds: ["11223344"],
    });

    expect(decoded).toEqual({
      drafts: [expect.objectContaining({ id: "aabbccdd" })],
      sent: [],
      resolvedCommentIds: ["11223344"],
    });
  });

  it("should round-trip a server agent snapshot into the browser projection", () => {
    const encoded = encodeAgentSnapshot({
      currentSnapshot: "a".repeat(16),
      presence: {
        connected: true,
        state: "working",
        requestId: "1".repeat(16),
        updatedAtMs: 10,
      },
      requests: [
        {
          requestId: "1".repeat(16),
          premiseSnapshot: "a".repeat(16),
          createdAt: "2026-08-10T12:00:00.000Z",
          kind: "feedback",
          comments: [
            {
              id: "comment-1",
              body: "Clarify this section",
              createdAt: "2026-08-10T12:00:00.000Z",
              premiseSnapshot: "a".repeat(16),
              target: {
                type: "block",
                blockId: "slide-2",
                kind: "slide",
                label: "Goals",
                section: "2 · Goals",
              },
            },
          ],
        },
      ],
      responses: [],
      connectionLog: [
        {
          eventId: "event-1",
          sessionId: "2".repeat(16),
          connected: true,
          at: "2026-08-10T12:00:01.000Z",
        },
      ],
      plan: "/tmp/plan.mdx",
      agentCommand: "big-plan agent /tmp/plan.mdx",
      recoveryPrompt: "Reconnect this review",
    });

    expect(decodeAgentSnapshot(encoded)).toMatchObject({
      currentSnapshot: "a".repeat(16),
      presence: { connected: true, state: "working" },
      requests: [
        {
          requestId: "1".repeat(16),
          commentIds: ["comment-1"],
          targetLabel: "2 · Goals",
        },
      ],
      connectionLog: [{ eventId: "event-1", connected: true }],
      plan: "/tmp/plan.mdx",
    });
  });

  it.each([
    {
      name: "partial claim",
      state: { claimExpiresAtMs: 1_775_000_000_000 },
    },
    {
      name: "answer without a claim",
      state: { answeredAt: "2026-08-10T12:01:00.000Z" },
    },
    {
      name: "two terminal states",
      state: {
        answeredAt: "2026-08-10T12:01:00.000Z",
        canceledAt: "2026-08-10T12:01:01.000Z",
        baselineSnapshot: "a".repeat(16),
        claimedAt: "2026-08-10T12:00:30.000Z",
        claimedBy: "b".repeat(16),
        claimExpiresAtMs: 1_775_000_000_000,
      },
    },
  ])("should reject a $name at the browser boundary", ({ state }) => {
    expect(
      decodeAgentSnapshot({
        currentSnapshot: "a".repeat(16),
        presence: { connected: false, state: "waiting" },
        requests: [
          {
            requestId: "1".repeat(16),
            premiseSnapshot: "a".repeat(16),
            createdAt: "2026-08-10T12:00:00.000Z",
            kind: "chat",
            ...state,
          },
        ],
        responses: [],
        connectionLog: [],
        plan: "/tmp/plan.mdx",
        agentCommand: "big-plan agent /tmp/plan.mdx",
        recoveryPrompt: "Reconnect this review",
      }).requests,
    ).toEqual([]);
  });

  it("should carry the connector's reported model identity to the browser", () => {
    const encoded = encodeAgentSnapshot({
      currentSnapshot: "a".repeat(16),
      presence: {
        connected: true,
        state: "working",
        model: { name: "Grok 4.6" },
      },
      requests: [],
      responses: [],
      connectionLog: [],
      plan: "/tmp/plan.mdx",
      agentCommand: "big-plan agent /tmp/plan.mdx",
      recoveryPrompt: "Reconnect this review",
    });

    expect(decodeAgentSnapshot(encoded).presence).toMatchObject({
      connected: true,
      model: { name: "Grok 4.6" },
    });
  });

  it("should degrade to an unknown identity instead of trusting a malformed model", () => {
    const encoded = encodeAgentSnapshot({
      currentSnapshot: "a".repeat(16),
      presence: { connected: true, state: "working", model: { name: "" } },
      requests: [],
      responses: [],
      connectionLog: [],
      plan: "/tmp/plan.mdx",
      agentCommand: "big-plan agent /tmp/plan.mdx",
      recoveryPrompt: "Reconnect this review",
    });

    expect(decodeAgentSnapshot(encoded).presence).not.toHaveProperty("model");
  });

  it("should round-trip per-side presentation facts through a snapshot diff", () => {
    const diff: SnapshotDiff = {
      from: "a".repeat(16),
      to: "b".repeat(16),
      locations: [
        {
          status: "changed",
          scope: "section/risks",
          kind: "callout",
          label: "Rollback risk",
          section: "Risks",
          oldText: "Old body.",
          newText: "New body.",
          oldPresentation: { aspect: "callout", calloutType: "danger" },
          newPresentation: { aspect: "callout", calloutType: "warning" },
          runs: [],
        },
      ],
      places: [],
    };

    const decoded = decodeSnapshotDiff(encodeSnapshotDiff(diff));
    expect(decoded?.locations[0]).toMatchObject({
      oldPresentation: { aspect: "callout", calloutType: "danger" },
      newPresentation: { aspect: "callout", calloutType: "warning" },
    });
  });

  it("should carry a picture's source, words, and replaced note across the wire", () => {
    const decoded = decodeSnapshotDiff({
      from: "a".repeat(16),
      to: "b".repeat(16),
      locations: [
        {
          status: "changed",
          scope: "section/system-shape",
          kind: "image",
          label: "Retry dashboard",
          section: "System shape",
          oldText: "",
          newText: "",
          oldPresentation: {
            aspect: "image",
            source: "./assets/before.png",
            alt: "Retry dashboard",
          },
          newPresentation: {
            aspect: "image",
            source: "./assets/after.png",
            alt: "Retry dashboard",
          },
          oldHtml: '<img src="./assets/before.png" alt="Retry dashboard">',
          newHtml: '<img src="./assets/after.png" alt="Retry dashboard">',
          runs: [],
        },
        {
          status: "changed",
          scope: "section/system-shape",
          kind: "image",
          label: "Broken fact",
          section: "System shape",
          oldText: "",
          newText: "",
          newPresentation: { aspect: "image", source: 7, alt: "Missing" },
          runs: [],
        },
      ],
      places: [
        {
          placeId: "c".repeat(16),
          status: "changed",
          label: "Retry dashboard",
          section: "System shape",
          note: "replaced",
          locationIndexes: [0],
        },
      ],
    });

    expect(decoded?.locations[0]).toMatchObject({
      oldPresentation: { aspect: "image", source: "./assets/before.png" },
      newPresentation: { aspect: "image", alt: "Retry dashboard" },
      newHtml: '<img src="./assets/after.png" alt="Retry dashboard">',
    });
    expect(decoded?.locations[1]?.newPresentation).toBeUndefined();
    expect(decoded?.places[0]?.note).toBe("replaced");
  });

  it("should drop a malformed presentation fact instead of trusting it through", () => {
    const decoded = decodeSnapshotDiff({
      from: "a".repeat(16),
      to: "b".repeat(16),
      locations: [
        {
          status: "removed",
          scope: "section/risks",
          kind: "list",
          label: "Runbook",
          section: "Risks",
          oldText: "Freeze writes.",
          newText: "",
          // Neither fact is in the wire vocabulary: an out-of-range callout
          // type and a non-boolean ordering must decode to absence, so the
          // browser renders its neutral fallback rather than a guessed kind.
          oldPresentation: { aspect: "list", isOrdered: "yes" },
          newPresentation: { aspect: "callout", calloutType: "sparkly" },
          runs: [],
        },
      ],
      places: [],
    });

    expect(decoded?.locations[0]?.oldPresentation).toBeUndefined();
    expect(decoded?.locations[0]?.newPresentation).toBeUndefined();
    expect(decoded?.locations[0]).toMatchObject({ oldText: "Freeze writes." });
  });

  it("should keep only a usable session lifetime and drop a malformed one", () => {
    const identity = {
      sessionId: "abcd1234",
      planId: "plan-1",
      plan: "/plans/checkout.mdx",
      authoritative: true,
    };

    expect(
      decodeRuntimeSession({
        value: {
          ...identity,
          idleTimeoutMs: 1_800_000,
          expiresAtMs: 1_700_000,
        },
        sessionId: identity.sessionId,
      }),
    ).toMatchObject({ idleTimeoutMs: 1_800_000, expiresAtMs: 1_700_000 });

    const malformed = decodeRuntimeSession({
      value: {
        ...identity,
        idleTimeoutMs: "1800000",
        expiresAtMs: Number.NaN,
      },
      sessionId: identity.sessionId,
    });
    expect(malformed).toMatchObject({ authoritative: true });
    expect(malformed).not.toHaveProperty("idleTimeoutMs");
    expect(malformed).not.toHaveProperty("expiresAtMs");
  });

  it("should preserve stable progress semantics and reject unknown codes", () => {
    const event = {
      seq: 1,
      stepCode: "request-picked-up" as const,
      step: "Coding agent reviewing comment",
      state: "live" as const,
      requestId: "1".repeat(16),
    };

    expect(decodeProgress(encodeProgress({ events: [event] }))).toEqual([
      event,
    ]);
    expect(
      decodeProgress({
        events: [{ ...event, stepCode: "wording-dependent-guess" }],
      }),
    ).toEqual([]);
  });
  it("should carry a stalled write age to the browser as a present fact", () => {
    const sessionId = "a".repeat(16);
    const encoded = encodeRuntimeSession({
      sessionId,
      planId: "b".repeat(16),
      plan: "/plans/plan.mdx",
      authoritative: true,
      writesStalledMs: 42_000,
    });

    expect(decodeRuntimeSession({ value: encoded, sessionId })).toMatchObject({
      authoritative: true,
      writesStalledMs: 42_000,
    });
  });

  it("should treat an absent, zero, or malformed stall as no stall at all", () => {
    const sessionId = "a".repeat(16);
    const base = {
      sessionId,
      planId: "b".repeat(16),
      plan: "/plans/plan.mdx",
      authoritative: true,
    };

    for (const writesStalledMs of [undefined, 0, -1, Number.NaN, "30000"]) {
      const decoded = decodeRuntimeSession({
        value: { ...base, writesStalledMs },
        sessionId,
      });
      expect(decoded).not.toBeNull();
      expect(decoded?.writesStalledMs).toBeUndefined();
    }
  });
});
