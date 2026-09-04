// Proves the one join the approve dialog and toolbar read: counts, the
// footnote, and which unanswered decisions actually block.

import { describe, expect, it } from "vitest";
import {
  changeSetsFromCommitted,
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

const SET_ID = "req1req1req1req1";

const changeSet = (overrides: Partial<OpenChangeSet> = {}): OpenChangeSet => ({
  id: SET_ID,
  label: "Retry backoff",
  from: FROM,
  to: TO,
  places: [{ placeId: "p1" }, { placeId: "p2" }],
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
      accepted: new Set([
        `${SET_ID}:${FROM}:${TO}:p1`,
        `${SET_ID}:${FROM}:${TO}:p2`,
      ]),
      rejected: new Set(),
      decidedDigests: new Map(),
      inputs: [input({ state: "answered", detail: "Answered: Gradual" })],
      requests: [],
    });
    expect(approveIsPrimary(items)).toBe(true);
    expect(approveChangeSetCaveat(items)).toBeUndefined();
    expect(approveDecisionCaveat(items)).toBeUndefined();
    expect(items.changeSets.open).toEqual([]);
  });

  // A rejected change is answered, not outstanding: the reviewer decided it and
  // the plan already carries that decision, so it must not keep Approve behind
  // work that no longer needs anyone.
  it("promotes Approve when every change is decided, rejections included", () => {
    const items = deriveOpenItems({
      changeSets: [changeSet()],
      accepted: new Set([`${SET_ID}:${FROM}:${TO}:p1`]),
      rejected: new Set([`${SET_ID}:${FROM}:${TO}:p2`]),
      decidedDigests: new Map(),
      inputs: [input({ state: "answered", detail: "Answered: Gradual" })],
      requests: [],
    });
    expect(approveIsPrimary(items)).toBe(true);
    expect(items.changeSets.open).toEqual([]);
    expect(items.changeSets.settled).toBe(1);
    expect(items.changeSets.accepted).toBe(0);
  });

  it("demotes Approve while a change set is open, even with unanswered decisions", () => {
    const items = deriveOpenItems({
      changeSets: [changeSet()],
      accepted: new Set(),
      rejected: new Set(),
      decidedDigests: new Map(),
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
      changeSets: [changeSet({ places: [] })],
      accepted: new Set(),
      rejected: new Set(),
      decidedDigests: new Map(),
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
      rejected: new Set(),
      decidedDigests: new Map(),
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
      rejected: new Set(),
      decidedDigests: new Map(),
      inputs: [input()],
      requests: [],
    });
    expect(approveIsPrimary(items)).toBe(false);
  });

  it("promotes Approve when the plan has no decisions and no change sets", () => {
    const items = deriveOpenItems({
      changeSets: [],
      accepted: new Set(),
      rejected: new Set(),
      decidedDigests: new Map(),
      inputs: [],
      requests: [],
    });
    expect(approveIsPrimary(items)).toBe(true);
  });

  it("keeps a changed-again place open for approval", () => {
    const key = `${SET_ID}:${FROM}:${TO}:p1`;
    const items = deriveOpenItems({
      changeSets: [
        changeSet({
          places: [{ placeId: "p1", contentDigest: "2".repeat(16) }],
        }),
      ],
      accepted: new Set([key]),
      rejected: new Set(),
      decidedDigests: new Map([[key, "1".repeat(16)]]),
      inputs: [],
      requests: [],
    });

    expect(items.changeSets.open).toHaveLength(1);
    expect(items.changeSets.standing[0]).toMatchObject({ open: 1, stale: 1 });
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

describe("changeSetsFromCommitted", () => {
  const S1 = "1".repeat(16);
  const S2 = "2".repeat(16);
  const S3 = "3".repeat(16);

  it("spans a multi-round thread once, from its baseline to its latest result", () => {
    expect(
      changeSetsFromCommitted({
        committed: [
          { changeSetId: "c0de", baseSnapshot: S1, resultSnapshot: S3 },
        ],
        requests: [
          {
            requestId: "req1req1req1req1",
            commentId: "c0de",
            targetLabel: "Retry backoff",
          },
          {
            requestId: "req2req2req2req2",
            commentId: "c0de",
            targetLabel: "Retry backoff",
          },
        ],
        placesByRevision: new Map([[`${S1}:${S3}`, [{ placeId: "p1" }]]]),
      }),
    ).toEqual([
      {
        id: "c0de",
        label: "Retry backoff",
        from: S1,
        to: S3,
        places: [{ placeId: "p1" }],
      },
    ]);
  });

  it("counts a thread the agent exchange window no longer carries", () => {
    expect(
      changeSetsFromCommitted({
        committed: [
          { changeSetId: "c0de", baseSnapshot: S1, resultSnapshot: S2 },
        ],
        requests: [],
        placesByRevision: new Map([[`${S1}:${S2}`, [{ placeId: "p1" }]]]),
      }),
    ).toEqual([
      {
        id: "c0de",
        label: `Version ${S2.slice(0, 7)}`,
        from: S1,
        to: S2,
        places: [{ placeId: "p1" }],
      },
    ]);
  });

  it("names a set from the comments the store holds on its opening round", () => {
    expect(
      changeSetsFromCommitted({
        committed: [
          { changeSetId: "c0de", baseSnapshot: S1, resultSnapshot: S2 },
        ],
        requests: [
          {
            requestId: "req1req1req1req1",
            comments: [{ id: "c0de" }],
            targetLabel: "2 · Rollout",
          },
        ],
        placesByRevision: new Map(),
      }),
    ).toEqual([
      {
        id: "c0de",
        label: "2 · Rollout",
        from: S1,
        to: S2,
        places: [],
        sectionId: "2",
      },
    ]);
  });

  it("keeps threads apart and holds the fold's order", () => {
    expect(
      changeSetsFromCommitted({
        committed: [
          { changeSetId: "c0de", baseSnapshot: S1, resultSnapshot: S2 },
          { changeSetId: "d1ce", baseSnapshot: S2, resultSnapshot: S3 },
        ],
        requests: [],
        placesByRevision: new Map(),
      }).map((changeSet) => changeSet.id),
    ).toEqual(["c0de", "d1ce"]);
  });

  it("drops a thread whose rounds cancelled out back to its baseline", () => {
    expect(
      changeSetsFromCommitted({
        committed: [
          { changeSetId: "c0de", baseSnapshot: S1, resultSnapshot: S1 },
        ],
        requests: [],
        placesByRevision: new Map(),
      }),
    ).toEqual([]);
  });
});
