// Proves the server encoder and browser decoder share one review transport
// contract, including feedback target projection and stable progress codes.

import { describe, expect, it } from "vitest";
import { PROGRESS_STEP_CODES } from "./progress-code.js";
import {
  decodeAgentSnapshot,
  decodeChangeVerdicts,
  decodeCommittedChangeSets,
  decodeProgress,
  decodeRuntimeSession,
  decodeReviewInputContract,
  decodeReviewSnapshot,
  decodeReviewState,
  decodeSnapshotDiff,
  encodeAgentSnapshot,
  encodeCommittedChangeSets,
  encodeProgress,
  encodeRuntimeSession,
  encodeSnapshotDiff,
  type AgentSnapshotSource,
  type SnapshotDiff,
} from "./review-wire.js";

const WIRE_NOW = 1_775_000_000_000;

/**
 * One instant, and an empty roster unless a case is about the roster.
 *
 * The encoder resolves each agent's membership as it serves the snapshot, so
 * it needs the moment it is answering at; the exchange cases below are about
 * requests and presence and say nothing about who is attached.
 */
const encodeSnapshot = (
  value: Omit<AgentSnapshotSource, "agents"> &
    Partial<Pick<AgentSnapshotSource, "agents">>,
  nowMs = WIRE_NOW,
) => encodeAgentSnapshot({ agents: [], ...value }, { nowMs });

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
      // State stored before conditional writes existed names no version, and
      // an empty one is refused rather than accepted as a claim about the
      // content this state came from.
      version: "",
    });
  });

  it("should carry the version a conditional write must be prepared against", () => {
    expect(
      decodeReviewSnapshot({
        drafts: [],
        sent: [],
        resolvedCommentIds: [],
        version: "0123456789abcdef",
      }).version,
    ).toBe("0123456789abcdef");
    expect(
      decodeReviewSnapshot({ drafts: [], sent: [], resolvedCommentIds: [] })
        .version,
    ).toBe("");
  });

  it("should reject a comment whose target is malformed", () => {
    expect(
      decodeReviewSnapshot({
        drafts: [
          {
            id: "aabbccdd",
            body: "Malformed target",
            createdAt: "2026-08-10T12:00:00.000Z",
            premiseSnapshot: "a".repeat(16),
            target: {
              type: "selection",
              blockId: "slide-1",
              imageBlockIds: [42],
              kind: "paragraph",
              label: "Overview",
              start: 0,
              end: 1,
              quote: "A",
              isQuoteExcerpt: false,
            },
          },
        ],
        sent: [],
        resolvedCommentIds: [],
        version: "0123456789abcdef",
      }).drafts,
    ).toEqual([]);
  });

  it("should round-trip a server agent snapshot into the browser projection", () => {
    const encoded = encodeSnapshot({
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

  it("should round-trip push request and response vocabulary", () => {
    const threadId = "1".repeat(16);
    const encoded = encodeSnapshot({
      currentSnapshot: "b".repeat(16),
      presence: { connected: true, state: "working" },
      requests: [
        {
          requestId: threadId,
          premiseSnapshot: "a".repeat(16),
          createdAt: "2026-08-10T12:00:00.000Z",
          kind: "push",
          origin: "about",
          body: "Tightened the retry boundary.",
          threadId,
        },
      ],
      responses: [
        {
          requestId: threadId,
          resultSnapshot: "b".repeat(16),
          createdAt: "2026-08-10T12:01:00.000Z",
          kind: "push",
          outcomes: [
            {
              commentId: threadId,
              state: "changed",
              message: "Tightened the retry boundary.",
              changeTargets: ["section/retries/paragraph-1"],
            },
          ],
        },
      ],
      connectionLog: [],
      plan: "/tmp/plan.mdx",
      agentCommand: "big-plan agent /tmp/plan.mdx",
      recoveryPrompt: "Reconnect this review",
    });

    expect(decodeAgentSnapshot(encoded)).toMatchObject({
      requests: [
        {
          kind: "push",
          origin: "about",
          body: "Tightened the retry boundary.",
          threadId,
          commentIds: [threadId],
        },
      ],
      responses: [
        {
          kind: "push",
          outcomes: [
            {
              commentId: threadId,
              state: "changed",
              changeTargets: ["section/retries/paragraph-1"],
            },
          ],
        },
      ],
    });
  });

  it("should ignore unknown request and response kinds at the browser boundary", () => {
    const base = {
      currentSnapshot: "a".repeat(16),
      presence: { connected: false, state: "waiting" },
      connectionLog: [],
      plan: "/tmp/plan.mdx",
      agentCommand: "big-plan agent /tmp/plan.mdx",
      recoveryPrompt: "Reconnect this review",
    };
    expect(
      decodeAgentSnapshot({
        ...base,
        requests: [
          {
            requestId: "1".repeat(16),
            premiseSnapshot: "a".repeat(16),
            createdAt: "2026-08-10T12:00:00.000Z",
            kind: "future",
          },
        ],
        responses: [
          {
            requestId: "1".repeat(16),
            resultSnapshot: "a".repeat(16),
            createdAt: "2026-08-10T12:01:00.000Z",
            kind: "future",
          },
        ],
      }),
    ).toMatchObject({ requests: [], responses: [] });
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
      name: "malformed claimed connection",
      state: {
        baselineSnapshot: "a".repeat(16),
        claimedAt: "2026-08-10T12:00:30.000Z",
        claimedBy: "b".repeat(16),
        claimedByConnection: "not-an-id",
        claimExpiresAtMs: 1_775_000_000_000,
      },
    },
    {
      name: "claimed connection without a claim",
      state: { claimedByConnection: "c".repeat(16) },
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

  // Two ids ride on one claim and they mean different things: the pickup token
  // names a turn, the connection names the connector the roster draws a card
  // for. Only the second can name who did something to a reader.
  it("should carry the connection a claim recorded, not just its pickup token", () => {
    const decoded = decodeAgentSnapshot(
      encodeSnapshot({
        currentSnapshot: "a".repeat(16),
        presence: { connected: true, state: "working" },
        requests: [
          {
            requestId: "1".repeat(16),
            premiseSnapshot: "a".repeat(16),
            baselineSnapshot: "a".repeat(16),
            claimedAt: "2026-08-10T12:00:00.000Z",
            claimedBy: "b".repeat(16),
            claimedByConnection: "c".repeat(16),
            claimExpiresAtMs: 1_775_000_000_000,
            createdAt: "2026-08-10T11:59:00.000Z",
            kind: "chat",
          },
        ],
        responses: [],
        connectionLog: [],
        plan: "/tmp/plan.mdx",
        agentCommand: "big-plan agent /tmp/plan.mdx",
        recoveryPrompt: "Reconnect this review",
      }),
    );
    expect(decoded.requests[0]).toMatchObject({
      claimedBy: "b".repeat(16),
      claimedByConnection: "c".repeat(16),
    });
  });

  // The heartbeat may be written by a different, waiting agent than the one
  // holding the claim, so the claim stays authoritative for work in flight.
  // Presence still names the attached connector, which is the only source when
  // nothing is claimed at all; the reader prefers the claim wherever both exist.
  it("should keep the claim authoritative over a competing heartbeat", () => {
    const encoded = encodeSnapshot({
      currentSnapshot: "a".repeat(16),
      presence: {
        connected: true,
        state: "working",
        model: { name: "Wrong waiting agent" },
      },
      requests: [
        {
          requestId: "1".repeat(16),
          premiseSnapshot: "a".repeat(16),
          baselineSnapshot: "a".repeat(16),
          claimedAt: "2026-08-10T12:00:00.000Z",
          claimedBy: "b".repeat(16),
          claimedModel: { name: "Grok 4.6" },
          claimExpiresAtMs: 1_775_000_000_000,
          createdAt: "2026-08-10T11:59:00.000Z",
          kind: "chat",
        },
      ],
      responses: [],
      connectionLog: [],
      plan: "/tmp/plan.mdx",
      agentCommand: "big-plan agent /tmp/plan.mdx",
      recoveryPrompt: "Reconnect this review",
    });

    const decoded = decodeAgentSnapshot(encoded);
    expect(decoded.requests[0]).toMatchObject({
      claimedModel: { name: "Grok 4.6" },
    });
    expect(decoded.presence).toMatchObject({
      model: { name: "Wrong waiting agent" },
    });
  });

  it("should carry a reported session end to the browser", () => {
    const decoded = decodeAgentSnapshot(
      encodeSnapshot({
        currentSnapshot: "a".repeat(16),
        presence: {
          connected: false,
          state: "waiting",
          updatedAtMs: 1_775_000_000_000,
          endedAtMs: 1_775_000_000_000,
        },
        requests: [],
        responses: [],
        connectionLog: [],
        plan: "/tmp/plan.mdx",
        agentCommand: "big-plan agent /tmp/plan.mdx",
        recoveryPrompt: "Reconnect this review",
      }),
    );
    expect(decoded.presence).toEqual({
      connected: false,
      state: "waiting",
      updatedAtMs: 1_775_000_000_000,
      endedAtMs: 1_775_000_000_000,
    });
  });

  it("should drop a session end that is not a number", () => {
    const decoded = decodeAgentSnapshot(
      encodeSnapshot({
        currentSnapshot: "a".repeat(16),
        presence: {
          connected: false,
          state: "waiting",
          endedAtMs: "just now",
        },
        requests: [],
        responses: [],
        connectionLog: [],
        plan: "/tmp/plan.mdx",
        agentCommand: "big-plan agent /tmp/plan.mdx",
        recoveryPrompt: "Reconnect this review",
      }),
    );
    expect(decoded.presence).not.toHaveProperty("endedAtMs");
  });

  it("should reject a malformed model on a claim", () => {
    const encoded = encodeSnapshot({
      currentSnapshot: "a".repeat(16),
      presence: { connected: true, state: "working" },
      requests: [
        {
          requestId: "1".repeat(16),
          premiseSnapshot: "a".repeat(16),
          baselineSnapshot: "a".repeat(16),
          claimedAt: "2026-08-10T12:00:00.000Z",
          claimedBy: "b".repeat(16),
          claimedModel: { name: "" },
          claimExpiresAtMs: 1_775_000_000_000,
          createdAt: "2026-08-10T11:59:00.000Z",
          kind: "chat",
        },
      ],
      responses: [],
      connectionLog: [],
      plan: "/tmp/plan.mdx",
      agentCommand: "big-plan agent /tmp/plan.mdx",
      recoveryPrompt: "Reconnect this review",
    });

    expect(decodeAgentSnapshot(encoded).requests).toEqual([]);
  });

  // A pending request holds the comments that produced it, so the slide copy
  // carried for the agent's brief would otherwise reach the browser on every
  // poll. The browser projection keeps only comment ids, so none of it is read.
  it("should leave a request's slide copy out of what the browser polls", () => {
    const encoded = encodeSnapshot({
      currentSnapshot: "a".repeat(16),
      presence: { connected: true, state: "working" },
      requests: [
        {
          requestId: "1".repeat(16),
          premiseSnapshot: "a".repeat(16),
          createdAt: "2026-08-10T12:00:00.000Z",
          kind: "feedback",
          comments: [
            {
              id: "aabbccdd",
              body: "rewrite this in Spanish",
              createdAt: "2026-08-10T12:00:00.000Z",
              premiseSnapshot: "a".repeat(16),
              target: {
                type: "block",
                blockId: "section/http-endpoints/heading-1",
                kind: "slide",
                label: "HTTP endpoints",
                section: "HTTP endpoints",
                slideText: "HTTP endpoints\n\nEvery job arrives here.",
                isSlideTextExcerpt: false,
                slideSubHeadings: ["The queueing endpoint"],
              },
            },
          ],
        },
      ],
      responses: [],
      connectionLog: [],
      plan: "/tmp/plan.mdx",
      agentCommand: "big-plan agent /tmp/plan.mdx",
      recoveryPrompt: "Reconnect this review",
    });

    expect(JSON.stringify(encoded)).not.toContain("Every job arrives here.");
    expect(JSON.stringify(encoded)).not.toContain("The queueing endpoint");
    // Stripping the copy must not cost the browser the request itself.
    expect(decodeAgentSnapshot(encoded).requests).toMatchObject([
      { commentIds: ["aabbccdd"], targetLabel: "HTTP endpoints" },
    ]);
  });

  // The pickup token is the capability that fences publication, and the
  // browser has no use for it. Membership goes the other way: the browser
  // cannot work it out from what it is allowed to know, so the server answers
  // it here and the rail reads the answer.
  it("should withhold an agent's pickup token while carrying its membership", () => {
    const encoded = encodeSnapshot(
      {
        currentSnapshot: "a".repeat(16),
        presence: { connected: true, state: "working" },
        agents: [
          {
            writerId: "1111111111111111",
            role: "primary",
            attachedAtMs: WIRE_NOW - 600_000,
            // Quiet for far longer than the stall window, because it is mid
            // turn: `agent next` hands the work over and the process exits.
            signalAtMs: WIRE_NOW - 300_000,
            claimToken: "cafebabecafebabe",
            inheritedDraftPath: "/tmp/stage/candidate.mdx",
          },
        ],
        requests: [],
        responses: [],
        connectionLog: [],
        plan: "/tmp/plan.mdx",
        agentCommand: "big-plan agent /tmp/plan.mdx",
        recoveryPrompt: "Reconnect this review",
      },
      WIRE_NOW,
    );

    const serialized = JSON.stringify(encoded);
    expect(serialized).not.toContain("cafebabecafebabe");
    expect(serialized).not.toContain("/tmp/stage/candidate.mdx");
    expect(decodeAgentSnapshot(encoded).agents).toEqual([
      {
        writerId: "1111111111111111",
        role: "primary",
        attachedAtMs: WIRE_NOW - 600_000,
        signalAtMs: WIRE_NOW - 300_000,
        attached: true,
      },
    ]);
  });

  it("should drop an agent whose record cannot say whether it is still here", () => {
    expect(
      decodeAgentSnapshot({
        agents: [
          {
            writerId: "1111111111111111",
            role: "primary",
            attachedAtMs: WIRE_NOW,
            signalAtMs: WIRE_NOW,
          },
        ],
      }).agents,
    ).toEqual([]);
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
          oldView: '<img src="./assets/before.png" alt="Retry dashboard">',
          newView: '<img src="./assets/after.png" alt="Retry dashboard">',
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
      newView: '<img src="./assets/after.png" alt="Retry dashboard">',
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

  it("should keep only a non-empty review restart command", () => {
    const identity = {
      sessionId: "abcd1234",
      planId: "plan-1",
      plan: "/plans/checkout.mdx",
      authoritative: true,
    };
    const restartCommand =
      "node '/tools/big-plan.mjs' review '/plans/checkout.mdx'";

    expect(
      decodeRuntimeSession({
        value: { ...identity, restartCommand },
        sessionId: identity.sessionId,
      }),
    ).toMatchObject({ restartCommand });

    for (const malformedCommand of ["", "   ", 42, null]) {
      const decoded = decodeRuntimeSession({
        value: { ...identity, restartCommand: malformedCommand },
        sessionId: identity.sessionId,
      });
      expect(decoded).not.toHaveProperty("restartCommand");
    }
  });

  it("should preserve stable progress semantics and reject unknown codes", () => {
    const events = PROGRESS_STEP_CODES.map((stepCode, index) => ({
      seq: index + 1,
      stepCode,
      step: `Progress ${index + 1}`,
      state: "live" as const,
      requestId: "1".repeat(16),
    }));

    expect(decodeProgress(encodeProgress({ events }))).toEqual(events);
    expect(
      decodeProgress({
        events: [
          {
            ...events[0],
            stepCode: "wording-dependent-guess",
          },
        ],
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
      mode: "review",
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

  it("should drop change verdicts a browser could not act on", () => {
    const decoded = decodeChangeVerdicts({
      revision: 4,
      accepted: [
        {
          from: "a".repeat(16),
          to: "b".repeat(16),
          placeId: "place-1",
          acceptedAt: "2026-08-18T00:00:00.000Z",
          actor: "auto-accept",
        },
        { from: "not-a-digest", to: "b".repeat(16), placeId: "place-2" },
        { from: "a".repeat(16), to: "b".repeat(16), placeId: "" },
        {
          from: "a".repeat(16),
          to: "b".repeat(16),
          placeId: "place-3",
          acceptedAt: "2026-08-18T00:00:00.000Z",
          actor: "mode",
        },
        "not a verdict",
      ],
    });
    expect(decoded.revision).toBe(4);
    expect(decoded.accepted.map((entry) => entry.placeId)).toEqual(["place-1"]);
    expect(decoded.accepted[0]?.actor).toBe("auto-accept");
  });

  it("should expose only a usable review mode and armed time", () => {
    const sessionId = "a".repeat(16);
    const identity = {
      sessionId,
      planId: "b".repeat(16),
      plan: "/plans/plan.mdx",
      authoritative: true,
    };
    expect(
      decodeRuntimeSession({
        value: { ...identity, mode: "auto-accept", armedAtMs: 42 },
        sessionId,
      }),
    ).toMatchObject({ mode: "auto-accept", armedAtMs: 42 });
    expect(
      decodeRuntimeSession({
        value: { ...identity, mode: "future", armedAtMs: 42 },
        sessionId,
      }),
    ).toMatchObject({ mode: "review" });
  });

  // A body this build cannot read must never displace state the page already
  // applied, so it decodes older than any accepted write rather than as empty.
  it("should decode an unreadable verdict body as older than any write", () => {
    for (const value of [null, {}, { accepted: [] }, { revision: "4" }]) {
      expect(decodeChangeVerdicts(value).revision).toBe(-1);
    }
  });

  // A revision no store could have written is worse than useless if accepted:
  // it sits above the legitimate write that follows it, and would discard
  // every later response until the count climbed past it.
  it("should refuse a revision that is not a whole write count", () => {
    for (const revision of [
      0.5,
      -1,
      -2,
      Number.MAX_SAFE_INTEGER + 2,
      Number.NaN,
      Number.POSITIVE_INFINITY,
    ]) {
      expect(decodeChangeVerdicts({ accepted: [], revision }).revision).toBe(
        -1,
      );
      expect(decodeReviewState({ answers: [], revision }).revision).toBe(-1);
      // The contract has no place to put an unorderable revision: it is the
      // one record whose reader starts at -1, so a body carrying one would
      // slip past the guard on the first read and present as a definite
      // answer about the plan. It is reported unreadable instead.
      expect(
        decodeReviewInputContract({ inputs: [], revision }),
      ).toBeUndefined();
    }
  });

  // "Nobody could read this" and "the review needs nothing" are opposite
  // statements to a reader, so the decoder never turns the first into the
  // second.
  it("should report a contract body it cannot read rather than an empty one", () => {
    for (const body of [null, "contract", 7, {}, { inputs: "none" }]) {
      expect(decodeReviewInputContract(body)).toBeUndefined();
    }
    expect(decodeReviewInputContract({ inputs: [], revision: 0 })).toEqual({
      inputs: [],
      revision: 0,
    });
  });

  it("should carry a committed change set for every provenance a commit records", () => {
    const changeSets = (["feedback", "reply", "chat", "push"] as const).map(
      (provenance, index) => ({
        changeSetId: `${index}`.repeat(16),
        provenance,
        baseSnapshot: "a".repeat(16),
        resultSnapshot: "b".repeat(16),
        committedAt: "2026-08-21T00:00:00.000Z",
      }),
    );
    const encoded = encodeCommittedChangeSets({ changeSets });
    expect(
      decodeCommittedChangeSets(JSON.parse(JSON.stringify(encoded))),
    ).toEqual({ changeSets });
  });

  it("should drop a committed change set a browser could not act on, alone", () => {
    const usable = {
      changeSetId: "4444444444444444",
      provenance: "feedback",
      baseSnapshot: "a".repeat(16),
      resultSnapshot: "b".repeat(16),
      committedAt: "2026-08-21T00:00:00.000Z",
    };
    const decoded = decodeCommittedChangeSets({
      changeSets: [
        usable,
        { ...usable, changeSetId: "not hexadecimal" },
        { ...usable, provenance: "merge" },
        { ...usable, baseSnapshot: "not-a-digest" },
        { ...usable, committedAt: "whenever" },
        "not a change set",
      ],
    });
    expect(decoded?.changeSets).toEqual([usable]);
  });

  // "Nobody could read this" and "no thread changed the plan" are opposite
  // statements to a reader, so the decoder never turns the first into the
  // second.
  it("should report a change-set body it cannot read rather than an empty one", () => {
    for (const body of [null, "changes", 7, {}, { changeSets: "none" }]) {
      expect(decodeCommittedChangeSets(body)).toBeUndefined();
    }
    expect(decodeCommittedChangeSets({ changeSets: [] })).toEqual({
      changeSets: [],
    });
  });

  // Zero earns its own case: it is the first write every store makes, and a
  // predicate that refused it would report a fresh record as unreadable.
  it("should keep a whole write count, including the first one", () => {
    for (const revision of [0, 7]) {
      expect(decodeChangeVerdicts({ accepted: [], revision }).revision).toBe(
        revision,
      );
      expect(decodeReviewState({ answers: [], revision }).revision).toBe(
        revision,
      );
      expect(
        decodeReviewInputContract({ inputs: [], revision })?.revision,
      ).toBe(revision);
    }
  });
});
