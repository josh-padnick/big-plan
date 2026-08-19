// Proves the Change Engine seam: a change set describes committed revisions
// only, and a thread's baseline and provenance survive every later reply.

import { describe, expect, it } from "vitest";
import { changeSetsFrom, changeSetIdsFor } from "./change-set-commit.js";
import type { CommittedPlanRevision } from "./change-set-commit.js";
import type { AgentResponse } from "./agent-exchange.js";

const THREAD = "4444444444444444";
const OTHER_THREAD = "5555555555555555";
const BASE = "1111111111111111";
const FIRST = "2222222222222222";
const SECOND = "3333333333333333";

const revision = (
  overrides: Partial<CommittedPlanRevision>,
): CommittedPlanRevision => ({
  requestId: "aaaaaaaaaaaaaaaa",
  changeSetIds: [THREAD],
  baseSnapshot: BASE,
  resultSnapshot: FIRST,
  provenance: "feedback",
  committedAt: "2026-08-17T12:00:00.000Z",
  ...overrides,
});

describe("committed change sets", () => {
  it("should keep a thread's baseline and provenance across later replies", () => {
    const changeSets = changeSetsFrom([
      revision({}),
      revision({
        requestId: "bbbbbbbbbbbbbbbb",
        baseSnapshot: FIRST,
        resultSnapshot: SECOND,
        provenance: "reply",
        committedAt: "2026-08-17T12:05:00.000Z",
      }),
    ]);
    // Was keeps naming where the thread started, not where its latest reply
    // happened to start.
    expect(changeSets).toEqual([
      {
        changeSetId: THREAD,
        provenance: "feedback",
        baseSnapshot: BASE,
        resultSnapshot: SECOND,
        committedAt: "2026-08-17T12:05:00.000Z",
      },
    ]);
  });

  it("should give one commit a change set for every thread it answers", () => {
    expect(
      changeSetsFrom([revision({ changeSetIds: [THREAD, OTHER_THREAD] })]).map(
        (changeSet) => changeSet.changeSetId,
      ),
    ).toEqual([THREAD, OTHER_THREAD]);
  });

  it("should address a plan-wide question's change set to the question", () => {
    const chat: AgentResponse = {
      version: 3,
      kind: "chat",
      requestId: "cccccccccccccccc",
      sessionId: "dddddddddddddddd",
      planId: "eeeeeeeeeeeeeeee",
      claimGeneration: 1,
      resultSnapshot: FIRST,
      createdAt: "2026-08-17T12:00:00.000Z",
      message: "No thread contains this one.",
    };
    expect(changeSetIdsFor(chat)).toEqual(["cccccccccccccccc"]);
  });

  it("should give one change set per answered thread, however many outcomes repeat it", () => {
    const feedback: AgentResponse = {
      version: 3,
      kind: "feedback",
      requestId: "cccccccccccccccc",
      sessionId: "dddddddddddddddd",
      planId: "eeeeeeeeeeeeeeee",
      claimGeneration: 2,
      resultSnapshot: FIRST,
      createdAt: "2026-08-17T12:00:00.000Z",
      outcomes: [
        { commentId: THREAD, state: "answered", message: "One." },
        { commentId: OTHER_THREAD, state: "answered", message: "Two." },
        { commentId: THREAD, state: "changed", message: "One again." },
      ],
    };
    expect(changeSetIdsFor(feedback)).toEqual([THREAD, OTHER_THREAD]);
  });
});
