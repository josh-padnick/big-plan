// The routes that finalize a review: approve pins the plan as it reads now,
// revoke cancels the approval still in force.
//
// Stamping the source and enqueueing the agent handoff belong to later
// increments. This increment records the approval, cancels leftover work, and
// publishes the derived status. The browser never writes the log itself.

import { readFile } from "node:fs/promises";
import { jsonResponse, payloadOf, refusal } from "./review-route-context.js";
import type {
  ReviewRouteContext,
  ReviewRouteRequest,
  ReviewRouteResponse,
} from "./review-route-context.js";
import {
  AgentExchangeRejected,
  deriveSnapshotDigest,
  readAgentExchange,
} from "./agent-exchange.js";
import {
  appendProgressEvent,
  cancelAgentRequest,
} from "./request-mailbox.js";
import { randomId, writeSnapshot } from "./store.js";
import { currentAnswers } from "./plan-inputs-store.js";
import { reviewInputs } from "./input-contract.js";
import {
  appendApproval,
  appendRevocation,
  ApprovalRecordRejected,
} from "./approval-record.js";
import {
  approvalSummary,
  APPROVAL_ID,
  deriveApprovalStatus,
  inForceApproval,
  type ApprovalEntry,
  type ApprovalSummary,
} from "./shared/approval.js";
import {
  APPROVAL_MESSAGE_LIMIT,
  DEFAULT_APPROVAL_MESSAGE,
} from "./shared/approval-message.js";
import { requestIsTerminal } from "./shared/agent-request-state.js";
import { encodeApprovalSummary } from "./shared/review-wire.js";
import { settleInterruptedCommitsFor } from "./staged-plan-mutation.js";

const coveringMessage = (value: unknown): string => {
  if (typeof value !== "string") return DEFAULT_APPROVAL_MESSAGE;
  if (value.length > APPROVAL_MESSAGE_LIMIT) {
    throw new ApprovalRecordRejected(
      `"message" is longer than ${APPROVAL_MESSAGE_LIMIT} characters`,
    );
  }
  const trimmed = value.trim();
  return trimmed === "" ? DEFAULT_APPROVAL_MESSAGE : trimmed;
};

const summaryResponse = (summary: ApprovalSummary | undefined): ReviewRouteResponse =>
  jsonResponse({
    status: 200,
    value: {
      approval:
        summary === undefined ? null : encodeApprovalSummary(summary),
    },
  });

const readCurrentSource = async (
  context: ReviewRouteContext,
): Promise<{ readonly source: string; readonly digest: string }> => {
  const source = await readFile(context.resolvedPlanPath, "utf8");
  return { source, digest: deriveSnapshotDigest(source) };
};

const loadSummary = async (
  context: ReviewRouteContext,
  currentSnapshot: string,
): Promise<ApprovalSummary | undefined> =>
  approvalSummary({
    record: await context.approvals.read(),
    currentSnapshot,
  });

const emitProgress = async ({
  context,
  stepCode,
  step,
  requestId,
  detail,
}: {
  readonly context: ReviewRouteContext;
  readonly stepCode: "plan-approved" | "approval-revoked" | "request-canceled";
  readonly step: string;
  readonly requestId?: string;
  readonly detail?: string;
}): Promise<void> => {
  try {
    await appendProgressEvent({
      store: context.store,
      event: {
        sessionId: context.sessionId,
        atMs: Date.now(),
        stepCode,
        step,
        state: "done",
        ...(requestId === undefined ? {} : { requestId }),
        ...(detail === undefined ? {} : { detail }),
      },
    });
  } catch (error: unknown) {
    context.reportDiagnostic({
      message: `Review progress update failed after ${stepCode}`,
      error,
    });
  }
};

const cancelOpenRequests = async (
  context: ReviewRouteContext,
): Promise<number> => {
  const exchange = await readAgentExchange({
    store: context.store,
    sessionId: context.sessionId,
    planId: context.planId,
  });
  const open = exchange.requests.filter(
    (request) =>
      !requestIsTerminal(request) &&
      !exchange.responses.some(
        (response) => response.requestId === request.requestId,
      ),
  );
  if (open.length === 0) return 0;
  try {
    await settleInterruptedCommitsFor({
      store: context.store,
      planPath: context.resolvedPlanPath,
      requestIds: open.map((request) => request.requestId),
    });
  } catch {
    // A journal that cannot settle is the same race the per-request cancel
    // already handles: the CAS on the source digest refuses if a write landed.
  }
  const now = new Date().toISOString();
  let canceled = 0;
  for (const request of open) {
    try {
      await cancelAgentRequest({
        store: context.store,
        requestId: request.requestId,
        now,
      });
      canceled += 1;
      await emitProgress({
        context,
        stepCode: "request-canceled",
        step: "Request canceled by approval",
        requestId: request.requestId,
      });
    } catch (error: unknown) {
      if (!(error instanceof AgentExchangeRejected)) throw error;
    }
  }
  return canceled;
};

const buildApprovalEntry = async ({
  context,
  pinnedSnapshot,
  message,
  requestsCanceled,
}: {
  readonly context: ReviewRouteContext;
  readonly pinnedSnapshot: string;
  readonly message: string;
  readonly requestsCanceled: number;
}): Promise<ApprovalEntry> => {
  const [inventory, inputs] = await Promise.all([
    context.decisionAnswers.inventory(),
    context.decisionAnswers.read(),
  ]);
  const live = currentAnswers({ inputs, inventory });
  const contract = reviewInputs({ inventory, inputs });
  const unanswered = contract
    .filter((input) => input.state !== "answered")
    .map((input) => input.inputId);
  const blocking = contract
    .filter((input) => input.isCritical && input.state !== "answered")
    .map((input) => input.inputId);
  if (blocking.length > 0) {
    throw new CriticalDecisionsOpen(blocking);
  }
  return {
    kind: "approval",
    approvalId: randomId(),
    at: new Date().toISOString(),
    pinnedSnapshot,
    message,
    recordedAnswers: live.map((answer) => ({
      decisionId: answer.decisionId,
      optionId: answer.optionId,
      optionTitle: answer.optionTitle,
    })),
    alreadyDecided: [],
    unansweredDecisions: unanswered,
    openItemCounts: {
      changeSetsAccepted: 0,
      changeSetsTotal: 0,
      decisionsAnswered: contract.filter((input) => input.state === "answered")
        .length,
      decisionsTotal: contract.length,
      requestsCanceled,
    },
  };
};

class CriticalDecisionsOpen extends Error {
  readonly blockingDecisionIds: ReadonlyArray<string>;

  constructor(blockingDecisionIds: ReadonlyArray<string>) {
    super("This plan cannot be approved until every critical decision is answered");
    this.name = "CriticalDecisionsOpen";
    this.blockingDecisionIds = blockingDecisionIds;
  }
}

/** Reads the approval still in force, derived against the current source. */
export const readApprovalState = async (
  context: ReviewRouteContext,
): Promise<ReviewRouteResponse> => {
  const { digest } = await readCurrentSource(context);
  return summaryResponse(await loadSummary(context, digest));
};

/**
 * Finalizes the review against the source as it reads right now. Stamping and
 * the agent mailbox handoff are later increments; this writes the record,
 * cancels leftover work, and publishes the derived approved state.
 */
export const approvePlan = async (
  context: ReviewRouteContext,
  request: ReviewRouteRequest,
): Promise<ReviewRouteResponse> => {
  const payload = payloadOf(request.body);
  const expectedSnapshot = payload.expectedSnapshot;
  if (typeof expectedSnapshot !== "string") {
    return refusal({ status: 400, reason: '"expectedSnapshot" is required' });
  }
  let message: string;
  try {
    message = coveringMessage(payload.message);
  } catch (error: unknown) {
    if (error instanceof ApprovalRecordRejected) {
      return refusal({ status: 400, reason: error.message });
    }
    throw error;
  }

  const { digest } = await readCurrentSource(context);
  if (digest !== expectedSnapshot) {
    return refusal({
      status: 409,
      reason: "The plan changed while the approve dialog was open",
      code: "plan-changed",
    });
  }

  const current = await context.approvals.read();
  const inForce = inForceApproval(current);
  if (
    deriveApprovalStatus({ entry: inForce, currentSnapshot: digest }) ===
    "approved"
  ) {
    return refusal({
      status: 409,
      reason: "This version is already approved",
      code: "already-approved",
    });
  }

  const requestsCanceled = await cancelOpenRequests(context);
  const afterCancel = await readCurrentSource(context);
  if (afterCancel.digest !== expectedSnapshot) {
    return refusal({
      status: 409,
      reason: "The plan changed while the approve dialog was open",
      code: "plan-changed",
    });
  }

  let entry: ApprovalEntry;
  try {
    entry = await buildApprovalEntry({
      context,
      pinnedSnapshot: afterCancel.digest,
      message,
      requestsCanceled,
    });
  } catch (error: unknown) {
    if (error instanceof CriticalDecisionsOpen) {
      return jsonResponse({
        status: 409,
        value: {
          error: error.message,
          code: "critical-unanswered",
          blockingDecisionIds: error.blockingDecisionIds,
        },
      });
    }
    throw error;
  }

  await writeSnapshot({
    store: context.store,
    snapshot: afterCancel.digest,
    source: afterCancel.source,
  });
  const next = appendApproval({ record: current, entry });
  await context.approvals.write(next);
  context.readerProgress.accept(afterCancel.digest);
  await emitProgress({
    context,
    stepCode: "plan-approved",
    step: "Plan approved",
    requestId: entry.approvalId,
  });
  const summary = approvalSummary({
    record: next,
    currentSnapshot: afterCancel.digest,
  });
  return jsonResponse({
    status: 200,
    value: {
      approvalId: entry.approvalId,
      pinnedSnapshot: entry.pinnedSnapshot,
      canceledRequests: requestsCanceled,
      approval: summary === undefined ? null : encodeApprovalSummary(summary),
    },
  });
};

/** Cancels the approval still in force. */
export const revokeApproval = async (
  context: ReviewRouteContext,
  request: ReviewRouteRequest,
): Promise<ReviewRouteResponse> => {
  const payload = payloadOf(request.body);
  const approvalId = payload.approvalId;
  if (typeof approvalId !== "string" || !APPROVAL_ID.test(approvalId)) {
    return refusal({
      status: 400,
      reason: '"approvalId" must be 16 hexadecimal characters',
    });
  }
  const current = await context.approvals.read();
  try {
    const next = appendRevocation({
      record: current,
      approvalId,
      at: new Date().toISOString(),
    });
    await context.approvals.write(next);
    await emitProgress({
      context,
      stepCode: "approval-revoked",
      step: "Approval revoked",
      requestId: approvalId,
    });
    const { digest } = await readCurrentSource(context);
    return summaryResponse(approvalSummary({ record: next, currentSnapshot: digest }));
  } catch (error: unknown) {
    if (error instanceof ApprovalRecordRejected) {
      return refusal({ status: 409, reason: error.message });
    }
    throw error;
  }
};
