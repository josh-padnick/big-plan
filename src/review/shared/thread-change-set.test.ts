// Proves the thread-to-change-set join: which committed set a thread owns, and
// which blocks its aggregate may be attributed to.

import { describe, expect, it } from "vitest";
import {
  threadChangeFor,
  threadChangeSpanFor,
  threadChangeTargets,
} from "./thread-change-set.js";
import type { CommittedChangeSet } from "./review-wire.js";
import type {
  ProjectedThreadExchange,
  ThreadRequest,
  ThreadResponse,
} from "./thread-projection.js";

const BASELINE = "a".repeat(64);
const ROUND_ONE = "b".repeat(64);
const ROUND_TWO = "c".repeat(64);

const changeSet = ({
  changeSetId,
  baseSnapshot = "a".repeat(64),
  resultSnapshot = "b".repeat(64),
  committedAt = "2026-08-21T00:00:00.000Z",
}: {
  readonly changeSetId: string;
  readonly baseSnapshot?: string;
  readonly resultSnapshot?: string;
  readonly committedAt?: string;
}): CommittedChangeSet => ({
  changeSetId,
  provenance: "feedback",
  baseSnapshot,
  resultSnapshot,
  committedAt,
});

describe("threadChangeSpanFor", () => {
  it("should find the thread's set by comment id when the thread grew from a comment", () => {
    expect(
      threadChangeSpanFor({
        changeSets: [
          changeSet({ changeSetId: "beef" }),
          changeSet({
            changeSetId: "c0de",
            baseSnapshot: BASELINE,
            resultSnapshot: ROUND_ONE,
          }),
        ],
        commentId: "c0de",
        requestIds: ["req-1"],
      }),
    ).toEqual({ from: BASELINE, to: ROUND_ONE });
  });

  it("should find the thread's set by request id when the set is a transaction", () => {
    expect(
      threadChangeSpanFor({
        changeSets: [
          changeSet({
            changeSetId: "req-1",
            baseSnapshot: BASELINE,
            resultSnapshot: ROUND_ONE,
          }),
        ],
        commentId: "c0de",
        requestIds: ["req-1"],
      }),
    ).toEqual({ from: BASELINE, to: ROUND_ONE });
  });

  it("should report no span when the thread has committed nothing", () => {
    expect(
      threadChangeSpanFor({
        changeSets: [changeSet({ changeSetId: "beef" })],
        commentId: "c0de",
        requestIds: ["req-1"],
      }),
    ).toBeUndefined();
  });

  it("should report no span when nothing has been committed at all", () => {
    expect(
      threadChangeSpanFor({
        changeSets: [],
        commentId: "c0de",
        requestIds: [],
      }),
    ).toBeUndefined();
  });

  it("should read several sets one thread owns as one span across them all", () => {
    expect(
      threadChangeSpanFor({
        changeSets: [
          changeSet({
            changeSetId: "req-2",
            baseSnapshot: ROUND_ONE,
            resultSnapshot: ROUND_TWO,
            committedAt: "2026-08-21T02:00:00.000Z",
          }),
          changeSet({
            changeSetId: "c0de",
            baseSnapshot: BASELINE,
            resultSnapshot: ROUND_ONE,
            committedAt: "2026-08-21T01:00:00.000Z",
          }),
        ],
        commentId: "c0de",
        requestIds: ["req-2"],
      }),
    ).toEqual({ from: BASELINE, to: ROUND_TWO });
  });
});

describe("threadChangeTargets", () => {
  it("should union the blocks every committed reply reported changing", () => {
    expect(
      threadChangeTargets([
        ["block-a", "block-b"],
        ["block-b", "block-c"],
      ]),
    ).toEqual(["block-a", "block-b", "block-c"]);
  });

  it("should report the whole set unattributed when one reply declared no targets", () => {
    expect(threadChangeTargets([["block-a"], undefined])).toBeUndefined();
  });

  it("should report the set unattributed when the thread has no committed replies", () => {
    expect(threadChangeTargets([])).toBeUndefined();
  });

  it("should report the set unattributed when every reply declared an empty target list", () => {
    expect(threadChangeTargets([[], []])).toBeUndefined();
  });
});

const exchange = ({
  requestId,
  baselineSnapshot,
  resultSnapshot,
  state = "changed",
  changeTargets,
}: {
  readonly requestId: string;
  readonly baselineSnapshot: string;
  readonly resultSnapshot?: string;
  readonly state?: "changed" | "answered";
  readonly changeTargets?: ReadonlyArray<string>;
}): ProjectedThreadExchange<ThreadRequest, ThreadResponse> => ({
  request: {
    requestId,
    kind: "feedback",
    premiseSnapshot: baselineSnapshot,
    baselineSnapshot,
    createdAt: "2026-08-21T00:00:00.000Z",
  },
  ...(resultSnapshot === undefined
    ? {}
    : {
        response: {
          requestId,
          resultSnapshot,
          createdAt: "2026-08-21T00:00:00.000Z",
          kind: "feedback",
        },
        outcome: {
          commentId: "c0de",
          state,
          message: "done",
          ...(changeTargets === undefined ? {} : { changeTargets }),
        },
      }),
  activity: [],
  status: { stage: "idle", tone: "neutral", label: "Idle" },
  delivery: "Sent",
  canceled: false,
  baselineSnapshot,
  canReviseMessage: false,
  canDeleteMessage: false,
  claimAbandoned: false,
});

describe("threadChangeFor", () => {
  it("should span every round, from the thread's baseline to the plan now", () => {
    expect(
      threadChangeFor({
        changeSets: [
          changeSet({
            changeSetId: "c0de",
            baseSnapshot: BASELINE,
            resultSnapshot: ROUND_TWO,
          }),
        ],
        commentId: "c0de",
        currentSnapshot: ROUND_TWO,
        exchanges: [
          exchange({
            requestId: "req-1",
            baselineSnapshot: BASELINE,
            resultSnapshot: ROUND_ONE,
            changeTargets: ["block-a"],
          }),
          exchange({
            requestId: "req-2",
            baselineSnapshot: ROUND_ONE,
            resultSnapshot: ROUND_TWO,
            changeTargets: ["block-b"],
          }),
        ],
      }),
    ).toEqual({
      requestId: "req-2",
      from: BASELINE,
      to: ROUND_TWO,
      changeTargets: ["block-a", "block-b"],
    });
  });

  it("should keep the baseline where the thread started even before the fold is read", () => {
    expect(
      threadChangeFor({
        changeSets: [],
        commentId: "c0de",
        currentSnapshot: ROUND_TWO,
        exchanges: [
          exchange({
            requestId: "req-1",
            baselineSnapshot: BASELINE,
            resultSnapshot: ROUND_ONE,
          }),
          exchange({
            requestId: "req-2",
            baselineSnapshot: ROUND_ONE,
            resultSnapshot: ROUND_TWO,
          }),
        ],
      }),
    ).toMatchObject({ from: BASELINE, to: ROUND_TWO });
  });

  it("should end at the latest reply while the fold still describes the round before it", () => {
    expect(
      threadChangeFor({
        changeSets: [
          changeSet({
            changeSetId: "c0de",
            baseSnapshot: BASELINE,
            resultSnapshot: ROUND_ONE,
          }),
        ],
        commentId: "c0de",
        currentSnapshot: ROUND_TWO,
        exchanges: [
          exchange({
            requestId: "req-1",
            baselineSnapshot: BASELINE,
            resultSnapshot: ROUND_ONE,
          }),
          exchange({
            requestId: "req-2",
            baselineSnapshot: ROUND_ONE,
            resultSnapshot: ROUND_TWO,
          }),
        ],
      }),
    ).toMatchObject({ requestId: "req-2", from: BASELINE, to: ROUND_TWO });
  });

  it("should report nothing while the thread has answered without changing the plan", () => {
    expect(
      threadChangeFor({
        changeSets: [],
        commentId: "c0de",
        currentSnapshot: BASELINE,
        exchanges: [
          exchange({
            requestId: "req-1",
            baselineSnapshot: BASELINE,
            resultSnapshot: BASELINE,
            state: "answered",
          }),
        ],
      }),
    ).toBeUndefined();
  });

  it("should report nothing while the thread is still waiting on its first reply", () => {
    expect(
      threadChangeFor({
        changeSets: [],
        commentId: "c0de",
        currentSnapshot: BASELINE,
        exchanges: [
          exchange({ requestId: "req-1", baselineSnapshot: BASELINE }),
        ],
      }),
    ).toBeUndefined();
  });
});
