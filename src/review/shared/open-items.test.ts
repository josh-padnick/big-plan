// Proves the one join the approve dialog and toolbar read: counts, the
// footnote, and which unanswered decisions actually block.

import { describe, expect, it } from "vitest";
import {
  changeSetsFromExchange,
  approveChangeSetCaveat,
  approveDecisionCaveat,
  approveIsPrimary,
  deriveOpenItems,
  openRequestsFromExchange,
  sectionIdFromLabel,
  titleAfterSectionId,
  type OpenChangeSet,
} from "./open-items.js";
import type { ReviewInput } from "./input-contract.js";

const FROM = "aaaaaaaaaaaaaaaa";
const TO = "bbbbbbbbbbbbbbbb";

const changeSet = (overrides: Partial<OpenChangeSet> = {}): OpenChangeSet => ({
  id: "req1req1req1req1",
  label: "Retry backoff",
  from: FROM,
  to: TO,
  placeIds: ["p1", "p2"],
  ...overrides,
});

const input = (overrides: Partial<ReviewInput> = {}): ReviewInput => ({
  inputId: "decision-one",
  label: "Which release path?",
  isCritical: false,
  state: "unanswered",
  detail: "No answer recorded",
  ...overrides,
});

describe("deriveOpenItems", () => {
  it("promotes Approve when every change set is accepted", () => {
    const items = deriveOpenItems({
      changeSets: [changeSet()],
      accepted: new Set([`${FROM}:${TO}:p1`, `${FROM}:${TO}:p2`]),
      inputs: [input({ state: "answered", detail: "Answered: Gradual" })],
      requests: [],
    });
    expect(approveIsPrimary(items)).toBe(true);
    expect(approveChangeSetCaveat(items)).toBeUndefined();
    expect(approveDecisionCaveat(items)).toBeUndefined();
    expect(items.changeSets.open).toEqual([]);
  });

  it("demotes Approve while a change set is open, even with unanswered decisions", () => {
    const items = deriveOpenItems({
      changeSets: [changeSet()],
      accepted: new Set(),
      inputs: [input()],
      requests: [],
    });
    expect(approveIsPrimary(items)).toBe(false);
    expect(approveChangeSetCaveat(items)).toBe(
      "Approval will auto-accept all change sets.",
    );
    expect(approveDecisionCaveat(items)).toBe(
      "Approval will report unanswered decisions as not answered.",
    );
  });

  it("treats a change set with no loaded places as still open", () => {
    const items = deriveOpenItems({
      changeSets: [changeSet({ placeIds: [] })],
      accepted: new Set(),
      inputs: [],
      requests: [],
    });
    expect(items.changeSets.open).toHaveLength(1);
    expect(approveIsPrimary(items)).toBe(false);
  });

  it("separates critical unanswered decisions from advisory ones", () => {
    const items = deriveOpenItems({
      changeSets: [],
      accepted: new Set(),
      inputs: [
        input({ inputId: "critical", isCritical: true }),
        input({ inputId: "advisory" }),
        input({
          inputId: "done",
          state: "answered",
          detail: "Answered: Yes",
        }),
      ],
      requests: [],
    });
    expect(approveIsPrimary(items)).toBe(false);
    expect(items.decisions.blockingCritical.map((row) => row.inputId)).toEqual([
      "critical",
    ]);
    expect(items.decisions.unanswered.map((row) => row.inputId)).toEqual([
      "critical",
      "advisory",
    ]);
    expect(
      items.decisions.unansweredNonCritical.map((row) => row.inputId),
    ).toEqual(["advisory"]);
    expect(approveDecisionCaveat(items)).toBeDefined();
    expect(approveChangeSetCaveat(items)).toBeUndefined();
  });

  it("demotes Approve while a decision is unanswered even with no change sets", () => {
    const items = deriveOpenItems({
      changeSets: [],
      accepted: new Set(),
      inputs: [input()],
      requests: [],
    });
    expect(approveIsPrimary(items)).toBe(false);
  });

  it("promotes Approve when the plan has no decisions and no change sets", () => {
    const items = deriveOpenItems({
      changeSets: [],
      accepted: new Set(),
      inputs: [],
      requests: [],
    });
    expect(approveIsPrimary(items)).toBe(true);
  });
});

describe("sectionIdFromLabel", () => {
  it("reads a dotted kicker and leaves the title", () => {
    expect(sectionIdFromLabel("1.1 · Status quo")).toBe("1.1");
    expect(titleAfterSectionId("1.1 · Status quo", "1.1")).toBe("Status quo");
  });

  it("reads a slash kicker", () => {
    expect(sectionIdFromLabel("2 / Goals")).toBe("2");
    expect(titleAfterSectionId("2 / Goals", "2")).toBe("Goals");
  });

  it("leaves a title with no kicker alone", () => {
    expect(sectionIdFromLabel("Status quo")).toBeUndefined();
    expect(titleAfterSectionId("Status quo", undefined)).toBe("Status quo");
  });
});

describe("openRequestsFromExchange", () => {
  it("lists only requests that have not reached a terminal state", () => {
    expect(
      openRequestsFromExchange([
        {
          requestId: "aaaaaaaaaaaaaaaa",
          kind: "chat",
          body: "Please start.",
        },
        {
          requestId: "bbbbbbbbbbbbbbbb",
          kind: "feedback",
          canceledAt: "2026-08-19T18:00:00.000Z",
        },
        {
          requestId: "cccccccccccccccc",
          kind: "reply",
          answeredAt: "2026-08-19T18:00:00.000Z",
        },
      ]),
    ).toEqual([{ requestId: "aaaaaaaaaaaaaaaa", label: "Please start." }]);
  });

  it("names an unanswered approval as the handoff, not its covering message", () => {
    expect(
      openRequestsFromExchange([
        {
          requestId: "dddddddddddddddd",
          kind: "approval",
          body: "This plan is approved and we are ready to begin. Start on it now and check in when the first stage is done.",
        },
      ]),
    ).toEqual([{ requestId: "dddddddddddddddd", label: "Plan approval" }]);
  });
});

describe("changeSetsFromExchange", () => {
  const S1 = "1".repeat(16);
  const S2 = "2".repeat(16);
  const S3 = "3".repeat(16);

  it("counts a multi-round thread once, spanning its whole span", () => {
    expect(
      changeSetsFromExchange({
        requests: [
          {
            requestId: "req1req1req1req1",
            premiseSnapshot: S1,
            baselineSnapshot: S1,
            commentId: "c0de",
            targetLabel: "Retry backoff",
          },
          {
            requestId: "req2req2req2req2",
            premiseSnapshot: S2,
            baselineSnapshot: S2,
            commentId: "c0de",
            targetLabel: "Retry backoff",
          },
        ],
        responses: [
          { requestId: "req1req1req1req1", resultSnapshot: S2 },
          { requestId: "req2req2req2req2", resultSnapshot: S3 },
        ],
        placeIdsByRevision: new Map([[`${S1}:${S3}`, ["p1"]]]),
        committedChangeSetIds: new Set(["c0de"]),
      }),
    ).toEqual([
      {
        id: "c0de",
        label: "Retry backoff",
        from: S1,
        to: S3,
        placeIds: ["p1"],
      },
    ]);
  });

  it("folds the opening feedback round the store names by its comments", () => {
    expect(
      changeSetsFromExchange({
        requests: [
          {
            requestId: "req1req1req1req1",
            premiseSnapshot: S1,
            comments: [{ id: "c0de" }],
          },
          {
            requestId: "req2req2req2req2",
            premiseSnapshot: S2,
            commentId: "c0de",
          },
        ],
        responses: [
          { requestId: "req1req1req1req1", resultSnapshot: S2 },
          { requestId: "req2req2req2req2", resultSnapshot: S3 },
        ],
        placeIdsByRevision: new Map(),
        committedChangeSetIds: new Set(["c0de"]),
      }),
    ).toMatchObject([{ id: "c0de", from: S1, to: S3 }]);
  });

  it("keeps threads apart when they changed the plan in turn", () => {
    expect(
      changeSetsFromExchange({
        requests: [
          {
            requestId: "req1req1req1req1",
            premiseSnapshot: S1,
            commentId: "c0de",
          },
          {
            requestId: "req2req2req2req2",
            premiseSnapshot: S2,
            commentId: "d1ce",
          },
        ],
        responses: [
          { requestId: "req1req1req1req1", resultSnapshot: S2 },
          { requestId: "req2req2req2req2", resultSnapshot: S3 },
        ],
        placeIdsByRevision: new Map(),
        committedChangeSetIds: new Set(["c0de", "d1ce"]),
      }).map((changeSet) => changeSet.id),
    ).toEqual(["c0de", "d1ce"]);
  });

  it("falls back to the request when the fold has not named the thread yet", () => {
    expect(
      changeSetsFromExchange({
        requests: [
          {
            requestId: "req1req1req1req1",
            premiseSnapshot: S1,
            commentId: "c0de",
          },
        ],
        responses: [{ requestId: "req1req1req1req1", resultSnapshot: S2 }],
        placeIdsByRevision: new Map(),
      }).map((changeSet) => changeSet.id),
    ).toEqual(["req1req1req1req1"]);
  });

  it("drops a thread whose rounds cancelled out back to its baseline", () => {
    expect(
      changeSetsFromExchange({
        requests: [
          {
            requestId: "req1req1req1req1",
            premiseSnapshot: S1,
            commentId: "c0de",
          },
          {
            requestId: "req2req2req2req2",
            premiseSnapshot: S2,
            commentId: "c0de",
          },
        ],
        responses: [
          { requestId: "req1req1req1req1", resultSnapshot: S2 },
          { requestId: "req2req2req2req2", resultSnapshot: S1 },
        ],
        placeIdsByRevision: new Map(),
        committedChangeSetIds: new Set(["c0de"]),
      }),
    ).toEqual([]);
  });
});
