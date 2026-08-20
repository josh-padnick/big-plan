// Proves the append-only log: in-force derivation, status against a digest,
// and that revoke names only the approval currently in force.

import { describe, expect, it } from "vitest";
import {
  appendApproval,
  appendRevocation,
  ApprovalRecordRejected,
  validateApprovalRecord,
} from "./approval-record.js";
import {
  approvalSummary,
  deriveApprovalStatus,
  emptyApprovalRecord,
  inForceApproval,
  type ApprovalEntry,
} from "./shared/approval.js";

const NOW = "2026-08-19T17:41:00.000Z";
const LATER = "2026-08-19T18:00:00.000Z";
const SNAPSHOT = "db1b466eeecbc416";
const NEXT_SNAPSHOT = "aaaaaaaaaaaaaaaa";

const approval = (overrides: Partial<ApprovalEntry> = {}): ApprovalEntry => ({
  kind: "approval",
  approvalId: "a1b2c3d4e5f60718",
  at: NOW,
  pinnedSnapshot: SNAPSHOT,
  message: "This plan is approved and we are ready to begin.",
  recordedAnswers: [
    {
      decisionId: "decision-which-release-path",
      optionId: "decision-which-release-path-option-gradual-rollout",
      optionTitle: "Gradual rollout",
    },
  ],
  alreadyDecided: [],
  unansweredDecisions: ["decision-what-should-trigger-rollback"],
  openItemCounts: {
    changeSetsAccepted: 2,
    changeSetsTotal: 4,
    decisionsAnswered: 1,
    decisionsTotal: 2,
    requestsCanceled: 0,
  },
  ...overrides,
});

describe("approval record", () => {
  it("treats an absent file as an empty log", () => {
    expect(validateApprovalRecord(undefined)).toEqual(emptyApprovalRecord());
  });

  it("appends an approval and reports it in force", () => {
    const entry = approval();
    const record = appendApproval({
      record: emptyApprovalRecord(),
      entry,
    });
    expect(inForceApproval(record)).toEqual(entry);
    expect(
      deriveApprovalStatus({ entry, currentSnapshot: SNAPSHOT }),
    ).toBe("approved");
    expect(
      deriveApprovalStatus({ entry, currentSnapshot: NEXT_SNAPSHOT }),
    ).toBe("stale");
  });

  it("revokes the in-force approval and leaves earlier entries as history", () => {
    const first = approval();
    const second = approval({
      approvalId: "b2c3d4e5f6071819",
      at: LATER,
      pinnedSnapshot: NEXT_SNAPSHOT,
    });
    const withBoth = appendApproval({
      record: appendApproval({ record: emptyApprovalRecord(), entry: first }),
      entry: second,
    });
    expect(inForceApproval(withBoth)?.approvalId).toBe(second.approvalId);
    const revoked = appendRevocation({
      record: withBoth,
      approvalId: second.approvalId,
      at: "2026-08-19T18:10:00.000Z",
    });
    expect(inForceApproval(revoked)).toBeUndefined();
    expect(revoked.entries).toHaveLength(3);
  });

  it("refuses to revoke an approval that is not in force", () => {
    const entry = approval();
    const record = appendApproval({
      record: emptyApprovalRecord(),
      entry,
    });
    expect(() =>
      appendRevocation({
        record,
        approvalId: "ffffffffffffffff",
        at: LATER,
      }),
    ).toThrow(ApprovalRecordRejected);
  });

  it("omits a summary when nothing is in force", () => {
    expect(
      approvalSummary({
        record: emptyApprovalRecord(),
        currentSnapshot: SNAPSHOT,
      }),
    ).toBeUndefined();
  });

  it("summarizes a stale in-force approval", () => {
    const entry = approval();
    const record = appendApproval({
      record: emptyApprovalRecord(),
      entry,
    });
    expect(
      approvalSummary({ record, currentSnapshot: NEXT_SNAPSHOT }),
    ).toMatchObject({
      approvalId: entry.approvalId,
      status: "stale",
      pinnedSnapshot: SNAPSHOT,
    });
  });
});
