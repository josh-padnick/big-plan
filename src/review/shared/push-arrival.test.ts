// Covers the arrival fact itself: what counts as newly present, what a first
// scan must stay silent about, and which blocks a swap settles.

import { describe, expect, it } from "vitest";
import {
  pushSettleTargets,
  scanPushArrivals,
  type PushArrivalScan,
} from "./push-arrival.js";
import type { AgentRequest, AgentResponse } from "./review-wire.js";

const request = (
  overrides: Partial<AgentRequest> & { readonly requestId: string },
): AgentRequest => ({
  premiseSnapshot: "base",
  createdAt: "2026-08-21T00:00:00.000Z",
  kind: "push",
  commentIds: [],
  origin: "about",
  threadId: `thread-${overrides.requestId}`,
  ...overrides,
});

const response = (
  overrides: Partial<AgentResponse> & { readonly requestId: string },
): AgentResponse => ({
  resultSnapshot: `snapshot-${overrides.requestId}`,
  createdAt: "2026-08-21T00:00:01.000Z",
  kind: "push",
  outcomes: [
    {
      commentId: `thread-${overrides.requestId}`,
      state: "changed",
      message: "Revised the retry approach.",
      changeTargets: ["section/retries/paragraph-1"],
    },
  ],
  ...overrides,
});

const scan = (
  requests: ReadonlyArray<AgentRequest>,
  responses: ReadonlyArray<AgentResponse>,
  seenPushResponseIds: ReadonlySet<string> | null,
): PushArrivalScan =>
  scanPushArrivals({ requests, responses, seenPushResponseIds });

describe("scanPushArrivals", () => {
  it("should report nothing on a first scan and seed what is already there", () => {
    const result = scan(
      [request({ requestId: "one" })],
      [response({ requestId: "one" })],
      null,
    );
    expect(result.arrivals).toEqual([]);
    expect([...result.seenPushResponseIds]).toEqual(["one"]);
  });

  it("should report a push that the payload newly carries", () => {
    const result = scan(
      [request({ requestId: "one" }), request({ requestId: "two" })],
      [response({ requestId: "one" }), response({ requestId: "two" })],
      new Set(["one"]),
    );
    expect(result.arrivals).toEqual([
      {
        requestId: "two",
        threadId: "thread-two",
        resultSnapshot: "snapshot-two",
        arrivedAt: "2026-08-21T00:00:01.000Z",
        changeTargets: ["section/retries/paragraph-1"],
      },
    ]);
    expect([...result.seenPushResponseIds]).toEqual(["one", "two"]);
  });

  it("should report the same push only once across repeated scans", () => {
    const first = scan(
      [request({ requestId: "one" })],
      [response({ requestId: "one" })],
      new Set(),
    );
    expect(first.arrivals).toHaveLength(1);
    const second = scan(
      [request({ requestId: "one" })],
      [response({ requestId: "one" })],
      first.seenPushResponseIds,
    );
    expect(second.arrivals).toEqual([]);
  });

  it("should ignore responses that are not pushes", () => {
    const result = scan(
      [request({ requestId: "one", kind: "chat" })],
      [response({ requestId: "one", kind: "chat" })],
      new Set(),
    );
    expect(result.arrivals).toEqual([]);
    expect([...result.seenPushResponseIds]).toEqual([]);
  });

  it("should hold an unattributable response back rather than lose its arrival", () => {
    const early = scan([], [response({ requestId: "one" })], new Set());
    expect(early.arrivals).toEqual([]);
    expect([...early.seenPushResponseIds]).toEqual([]);
    const later = scan(
      [request({ requestId: "one" })],
      [response({ requestId: "one" })],
      early.seenPushResponseIds,
    );
    expect(later.arrivals).toHaveLength(1);
  });

  it("should carry the identity the agent declared when it claimed the push", () => {
    const result = scan(
      [
        request({
          requestId: "one",
          claimedModel: {
            name: "claude-opus-5",
            client: "claude-code 2.1.217",
          },
        }),
      ],
      [response({ requestId: "one" })],
      new Set(),
    );
    expect(result.arrivals[0]?.model).toEqual({
      name: "claude-opus-5",
      client: "claude-code 2.1.217",
    });
  });

  it("should carry the writer that claimed the push, so two agents on one model stay apart", () => {
    const result = scan(
      [request({ requestId: "one", claimedBy: "aaaaaaaaaaaaa38a" })],
      [response({ requestId: "one" })],
      new Set(),
    );
    expect(result.arrivals[0]?.claimedBy).toBe("aaaaaaaaaaaaa38a");
  });

  it("should keep changed blocks in the order listed, without duplicates", () => {
    const result = scan(
      [request({ requestId: "one" })],
      [
        response({
          requestId: "one",
          outcomes: [
            {
              commentId: "thread-one",
              state: "changed",
              message: "Revised.",
              changeTargets: ["b", "a", "b"],
            },
          ],
        }),
      ],
      new Set(),
    );
    expect(result.arrivals[0]?.changeTargets).toEqual(["b", "a"]);
  });
});

describe("pushSettleTargets", () => {
  it("should name the blocks the pushed revision changed", () => {
    expect(
      pushSettleTargets({
        responses: [response({ requestId: "one" })],
        resultSnapshot: "snapshot-one",
      }),
    ).toEqual(["section/retries/paragraph-1"]);
  });

  it("should stay empty for a revision no push produced", () => {
    expect(
      pushSettleTargets({
        responses: [response({ requestId: "one", kind: "reply" })],
        resultSnapshot: "snapshot-one",
      }),
    ).toEqual([]);
  });

  it("should stay empty before any revision is displayed", () => {
    expect(
      pushSettleTargets({
        responses: [response({ requestId: "one", resultSnapshot: "" })],
        resultSnapshot: "",
      }),
    ).toEqual([]);
  });
});
