// Proves the server encoder and browser decoder share one review transport
// contract, including feedback target projection and stable progress codes.

import { describe, expect, it } from "vitest";
import {
  decodeAgentSnapshot,
  decodeProgress,
  encodeAgentSnapshot,
  encodeProgress,
} from "./review-wire.js";

describe("review wire contract", () => {
  it("should round-trip a server agent snapshot into the browser projection", () => {
    const encoded = encodeAgentSnapshot({
      sourceRevision: "a".repeat(16),
      presence: {
        connected: true,
        state: "working",
        requestId: "1".repeat(16),
        updatedAtMs: 10,
      },
      requests: [
        {
          requestId: "1".repeat(16),
          sourceRevision: "a".repeat(16),
          createdAt: "2026-08-10T12:00:00.000Z",
          kind: "feedback",
          comments: [
            {
              id: "comment-1",
              body: "Clarify this section",
              createdAt: "2026-08-10T12:00:00.000Z",
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
      sourceRevision: "a".repeat(16),
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
});
