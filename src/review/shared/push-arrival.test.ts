// Covers the arrival fact itself: what counts as newly present, what a first
// scan must stay silent about, and which blocks a swap settles.

import { describe, expect, it } from "vitest";
import {
  announcedArrival,
  pushSettleTargets,
  scanPushArrivals,
  type PushArrival,
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

  it("should carry the roster identity of the agent that pushed", () => {
    const result = scan(
      [
        request({
          requestId: "one",
          claimedBy: "0000000011112222",
          claimedByConnection: "aaaaaaaaaaaaa38a",
        }),
      ],
      [response({ requestId: "one" })],
      new Set(),
    );
    // The connection, never the pickup token beside it: the roster draws its
    // cards by the former, so an entry named by the latter matches no card.
    expect(result.arrivals[0]?.writerId).toBe("aaaaaaaaaaaaa38a");
  });

  it("should leave the pusher unnamed when the claim recorded no connection", () => {
    const result = scan(
      [request({ requestId: "one", claimedBy: "0000000011112222" })],
      [response({ requestId: "one" })],
      new Set(),
    );
    expect(result.arrivals[0]?.writerId).toBeUndefined();
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

describe("announcedArrival", () => {
  const landed = (
    overrides: Partial<PushArrival> & { readonly requestId: string },
  ): PushArrival => ({
    threadId: `thread-${overrides.requestId}`,
    resultSnapshot: `snapshot-${overrides.requestId}`,
    arrivedAt: "2026-08-21T00:00:01.000Z",
    changeTargets: [],
    ...overrides,
  });

  it("should have nothing to announce when the payload carried no push", () => {
    expect(announcedArrival([])).toBeUndefined();
  });

  it("should name the newest push in the payload", () => {
    const announced = announcedArrival([
      landed({ requestId: "one", writerId: "aaaaaaaaaaaaa38a" }),
      landed({ requestId: "two", writerId: "bbbbbbbbbbbbb12c" }),
    ]);
    expect(announced?.requestId).toBe("two");
    expect(announced?.threadId).toBe("thread-two");
    expect(announced?.resultSnapshot).toBe("snapshot-two");
    expect(announced?.writerId).toBe("bbbbbbbbbbbbb12c");
  });

  it("should report every block the payload changed, newest last", () => {
    // Two pushes landing in one poll leave the reader looking at a page that
    // differs in both places, so reporting only the newest push's block would
    // count and highlight less than actually moved.
    expect(
      announcedArrival([
        landed({ requestId: "one", changeTargets: ["a", "b"] }),
        landed({ requestId: "two", changeTargets: ["c"] }),
      ])?.changeTargets,
    ).toEqual(["a", "b", "c"]);
  });

  it("should count a block touched by two pushes once", () => {
    expect(
      announcedArrival([
        landed({ requestId: "one", changeTargets: ["a", "b"] }),
        landed({ requestId: "two", changeTargets: ["b", "c"] }),
      ])?.changeTargets,
    ).toEqual(["a", "b", "c"]);
  });

  it("should leave a lone arrival exactly as it landed", () => {
    const only = landed({ requestId: "one", changeTargets: ["a"] });
    expect(announcedArrival([only])).toEqual(only);
  });
});

describe("pushSettleTargets", () => {
  const arrival = (
    overrides: Partial<PushArrival> & { readonly resultSnapshot: string },
  ): PushArrival => ({
    requestId: "one",
    threadId: "thread-one",
    arrivedAt: "2026-08-21T00:00:01.000Z",
    changeTargets: ["section/retries/paragraph-1"],
    ...overrides,
  });

  it("should name the blocks the arriving push changed", () => {
    expect(
      pushSettleTargets({
        arrival: arrival({ resultSnapshot: "snapshot-one" }),
        resultSnapshot: "snapshot-one",
      }),
    ).toEqual(["section/retries/paragraph-1"]);
  });

  it("should stay empty for a swap no arrival is waiting on", () => {
    expect(
      pushSettleTargets({ arrival: null, resultSnapshot: "snapshot-one" }),
    ).toEqual([]);
  });

  it("should stay empty when a revert lands on an earlier push's snapshot", () => {
    // Reverting the second push restores the first push's result, so a settle
    // keyed on the snapshot alone would wash the blocks that push changed
    // rather than the ones the reviewer just watched change back.
    expect(
      pushSettleTargets({
        arrival: arrival({
          resultSnapshot: "snapshot-two",
          changeTargets: ["section/delivery/paragraph-1"],
        }),
        resultSnapshot: "snapshot-one",
      }),
    ).toEqual([]);
  });

  it("should stay empty before any revision is displayed", () => {
    expect(
      pushSettleTargets({
        arrival: arrival({ resultSnapshot: "" }),
        resultSnapshot: "",
      }),
    ).toEqual([]);
  });
});
