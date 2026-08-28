// Owns validation and immutable updates for the append-only approval log.
//
// Status derivation and the in-force rule live in the shared module, because
// the browser paints from the same facts. This file only enforces the stored
// shape and the two mutations that grow it: append an approval, append a
// revocation. Entries are never rewritten.

import { SNAPSHOT_DIGEST } from "./shared/change-verdict.js";
import { APPROVAL_MESSAGE_LIMIT } from "./shared/approval-message.js";
import {
  APPROVAL_ID,
  emptyApprovalRecord,
  inForceApproval,
  type AlreadyDecidedAnswer,
  type ApprovalEntry,
  type ApprovalLogEntry,
  type ApprovalOpenItemCounts,
  type ApprovalRecord,
  type RecordedApprovalAnswer,
  type RevocationEntry,
} from "./shared/approval.js";

export class ApprovalRecordRejected extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ApprovalRecordRejected";
  }
}

const record = ({
  value,
  field,
}: {
  readonly value: unknown;
  readonly field: string;
}): Readonly<Record<string, unknown>> => {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new ApprovalRecordRejected(`"${field}" must be an object`);
  }
  return value as Readonly<Record<string, unknown>>;
};

const text = ({
  value,
  field,
  limit,
}: {
  readonly value: unknown;
  readonly field: string;
  readonly limit: number;
}): string => {
  if (typeof value !== "string") {
    throw new ApprovalRecordRejected(`"${field}" must be text`);
  }
  if (value.length > limit) {
    throw new ApprovalRecordRejected(
      `"${field}" is longer than ${limit} characters`,
    );
  }
  return value;
};

const digest = ({
  value,
  field,
}: {
  readonly value: unknown;
  readonly field: string;
}): string => {
  if (typeof value !== "string" || !SNAPSHOT_DIGEST.test(value)) {
    throw new ApprovalRecordRejected(
      `"${field}" must be a hexadecimal snapshot digest`,
    );
  }
  return value;
};

const approvalId = (value: unknown): string => {
  if (typeof value !== "string" || !APPROVAL_ID.test(value)) {
    throw new ApprovalRecordRejected(
      '"approvalId" must be 16 hexadecimal characters',
    );
  }
  return value;
};

const timestamp = ({
  value,
  field,
}: {
  readonly value: unknown;
  readonly field: string;
}): string => {
  if (typeof value !== "string") {
    throw new ApprovalRecordRejected(`"${field}" must be an ISO timestamp`);
  }
  const parsed = Date.parse(value);
  if (Number.isNaN(parsed) || new Date(parsed).toISOString() !== value) {
    throw new ApprovalRecordRejected(`"${field}" must be an ISO timestamp`);
  }
  return value;
};

const recordedAnswer = (value: unknown): RecordedApprovalAnswer => {
  const candidate = record({ value, field: "recordedAnswer" });
  return {
    decisionId: text({
      value: candidate.decisionId,
      field: "decisionId",
      limit: 512,
    }),
    optionId: text({
      value: candidate.optionId,
      field: "optionId",
      limit: 512,
    }),
    optionTitle: text({
      value: candidate.optionTitle,
      field: "optionTitle",
      limit: 512,
    }),
  };
};

const alreadyDecided = (value: unknown): AlreadyDecidedAnswer => {
  const candidate = record({ value, field: "alreadyDecided" });
  return {
    decisionId: text({
      value: candidate.decisionId,
      field: "decisionId",
      limit: 512,
    }),
    optionId: text({
      value: candidate.optionId,
      field: "optionId",
      limit: 512,
    }),
  };
};

const wholeCount = ({
  value,
  field,
}: {
  readonly value: unknown;
  readonly field: string;
}): number => {
  if (
    typeof value !== "number" ||
    !Number.isInteger(value) ||
    value < 0 ||
    !Number.isSafeInteger(value)
  ) {
    throw new ApprovalRecordRejected(`"${field}" must be a whole count`);
  }
  return value;
};

const openItemCounts = (value: unknown): ApprovalOpenItemCounts => {
  const candidate = record({ value, field: "openItemCounts" });
  return {
    changeSetsAccepted: wholeCount({
      value: candidate.changeSetsAccepted,
      field: "changeSetsAccepted",
    }),
    changeSetsTotal: wholeCount({
      value: candidate.changeSetsTotal,
      field: "changeSetsTotal",
    }),
    decisionsAnswered: wholeCount({
      value: candidate.decisionsAnswered,
      field: "decisionsAnswered",
    }),
    decisionsTotal: wholeCount({
      value: candidate.decisionsTotal,
      field: "decisionsTotal",
    }),
    requestsCanceled: wholeCount({
      value: candidate.requestsCanceled,
      field: "requestsCanceled",
    }),
  };
};

const approvalEntry = (value: unknown): ApprovalEntry => {
  const candidate = record({ value, field: "approval" });
  if (!Array.isArray(candidate.recordedAnswers)) {
    throw new ApprovalRecordRejected('"recordedAnswers" must be an array');
  }
  if (!Array.isArray(candidate.alreadyDecided)) {
    throw new ApprovalRecordRejected('"alreadyDecided" must be an array');
  }
  if (!Array.isArray(candidate.unansweredDecisions)) {
    throw new ApprovalRecordRejected('"unansweredDecisions" must be an array');
  }
  return {
    kind: "approval",
    approvalId: approvalId(candidate.approvalId),
    at: timestamp({ value: candidate.at, field: "at" }),
    pinnedSnapshot: digest({
      value: candidate.pinnedSnapshot,
      field: "pinnedSnapshot",
    }),
    message: text({
      value: candidate.message,
      field: "message",
      limit: APPROVAL_MESSAGE_LIMIT,
    }),
    recordedAnswers: candidate.recordedAnswers.map(recordedAnswer),
    alreadyDecided: candidate.alreadyDecided.map(alreadyDecided),
    unansweredDecisions: candidate.unansweredDecisions.map((id) =>
      text({ value: id, field: "unansweredDecision", limit: 512 }),
    ),
    openItemCounts: openItemCounts(candidate.openItemCounts),
  };
};

const revocationEntry = (value: unknown): RevocationEntry => {
  const candidate = record({ value, field: "revocation" });
  return {
    kind: "revocation",
    approvalId: approvalId(candidate.approvalId),
    at: timestamp({ value: candidate.at, field: "at" }),
  };
};

const logEntry = (value: unknown): ApprovalLogEntry => {
  const candidate = record({ value, field: "entry" });
  if (candidate.kind === "approval") return approvalEntry(candidate);
  if (candidate.kind === "revocation") return revocationEntry(candidate);
  throw new ApprovalRecordRejected('"kind" must be "approval" or "revocation"');
};

/** Validates the complete on-disk record, treating an absent file as empty. */
export const validateApprovalRecord = (value: unknown): ApprovalRecord => {
  if (value === undefined) return emptyApprovalRecord();
  const candidate = record({ value, field: "approval" });
  if (candidate.version !== 1) {
    throw new ApprovalRecordRejected("Approval must be a version 1 record");
  }
  if (!Array.isArray(candidate.entries)) {
    throw new ApprovalRecordRejected('"entries" must be an array');
  }
  return {
    version: 1,
    entries: candidate.entries.map(logEntry),
  };
};

/** Appends one approval. The previous in-force entry stays as history. */
export const appendApproval = ({
  record: current,
  entry,
}: {
  readonly record: ApprovalRecord;
  readonly entry: ApprovalEntry;
}): ApprovalRecord => ({
  version: 1,
  entries: [...current.entries, entry],
});

/**
 * Appends a revocation for the approval still in force. Naming any other id,
 * or revoking when nothing is in force, is refused rather than written: a
 * revocation that does not cancel the current approval would leave the log
 * saying something the page cannot show.
 */
export const appendRevocation = ({
  record: current,
  approvalId: targetId,
  at,
}: {
  readonly record: ApprovalRecord;
  readonly approvalId: string;
  readonly at: string;
}): ApprovalRecord => {
  const inForce = inForceApproval(current);
  if (inForce === undefined) {
    throw new ApprovalRecordRejected("There is no approval to revoke");
  }
  if (inForce.approvalId !== targetId) {
    throw new ApprovalRecordRejected(
      "Only the approval currently in force can be revoked",
    );
  }
  return {
    version: 1,
    entries: [
      ...current.entries,
      { kind: "revocation", approvalId: targetId, at },
    ],
  };
};
