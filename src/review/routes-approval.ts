// The routes that finalize a review: approve pins the plan as it reads now,
// delivers the approval to the agent mailbox, and revoke cancels both the
// approval still in force and a still-unresponded handoff.
//
// Stamping decided attributes into the source belongs to a later increment.
// This increment finalizes accepted changes, leftover work, the approval
// record, and the agent handoff through one recoverable commit plus the
// mailbox write that follows it. The browser never writes the log itself.

import { readFile } from "node:fs/promises";
import { basename, extname } from "node:path";
import { renderDocument } from "../render/render-document.js";
import { jsonResponse, payloadOf, refusal } from "./review-route-context.js";
import type {
  ReviewRouteContext,
  ReviewRouteRequest,
  ReviewRouteResponse,
} from "./review-route-context.js";
import {
  AgentExchangeRejected,
  type AgentApprovalRequest,
  approvalAgentRequest,
  deriveSnapshotDigest,
  readAgentExchange,
  writeAgentRequest,
} from "./agent-exchange.js";
import { appendProgressEvent, cancelAgentRequest } from "./request-mailbox.js";
import {
  randomId,
  readSnapshot,
  writeApprovalBrief,
  writeSnapshot,
} from "./store.js";
import { currentAnswers } from "./plan-inputs-store.js";
import { reviewInputs } from "./input-contract.js";
import {
  appendApproval,
  appendRevocation,
  ApprovalRecordRejected,
  buildApprovalBrief,
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
import { buildSnapshotDiff } from "./snapshot-diff.js";
import {
  applyChangeVerdictMutation,
  type StoredChangeVerdicts,
} from "./change-verdicts-store.js";
import { changeVerdictKey } from "./shared/change-verdict.js";
import {
  changeSetsFromExchange,
  deriveOpenItems,
} from "./shared/open-items.js";
import {
  commitApprovalFinalization,
  type ApprovalFinalization,
} from "./approval-finalization.js";

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

const summaryResponse = (
  summary: ApprovalSummary | undefined,
): ReviewRouteResponse =>
  jsonResponse({
    status: 200,
    value: {
      approval: summary === undefined ? null : encodeApprovalSummary(summary),
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

const openRequestIds = async (
  context: ReviewRouteContext,
): Promise<ReadonlyArray<string>> => {
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
  if (open.length > 0) {
    await settleInterruptedCommitsFor({
      store: context.store,
      planPath: context.resolvedPlanPath,
      requestIds: open.map((request) => request.requestId),
    });
  }
  return open.map((request) => request.requestId);
};

const changeSetsAtApproval = async (
  context: ReviewRouteContext,
): Promise<ReturnType<typeof changeSetsFromExchange>> => {
  const exchange = await readAgentExchange({
    store: context.store,
    sessionId: context.sessionId,
    planId: context.planId,
  });
  const placeIdsByRevision = new Map<string, ReadonlyArray<string>>();
  const requests = new Map(
    exchange.requests.map((request) => [request.requestId, request]),
  );
  const fallbackTitle = basename(
    context.resolvedPlanPath,
    extname(context.resolvedPlanPath),
  );
  for (const response of exchange.responses) {
    const request = requests.get(response.requestId);
    if (request === undefined) continue;
    const from = request.baselineSnapshot ?? request.premiseSnapshot;
    const to = response.resultSnapshot;
    if (from === to) continue;
    const [beforeSource, afterSource] = await Promise.all([
      readSnapshot({ store: context.store, snapshot: from }),
      readSnapshot({ store: context.store, snapshot: to }),
    ]);
    const before = renderDocument({
      markdown: beforeSource,
      fallbackTitle,
      identity: {},
    });
    const after = renderDocument({
      markdown: afterSource,
      fallbackTitle,
      identity: {},
    });
    const diff = buildSnapshotDiff({
      from,
      to,
      before: before.blocks,
      after: after.blocks,
    });
    placeIdsByRevision.set(
      `${from}:${to}`,
      diff.places.map((place) => place.placeId),
    );
  }
  return changeSetsFromExchange({
    requests: exchange.requests,
    responses: exchange.responses,
    placeIdsByRevision,
  });
};

const acceptChangeSets = async ({
  context,
  inputs,
  requestIds,
}: {
  readonly context: ReviewRouteContext;
  readonly inputs: ReturnType<typeof reviewInputs>;
  readonly requestIds: ReadonlyArray<string>;
}): Promise<{
  readonly verdicts: StoredChangeVerdicts;
  readonly accepted: number;
  readonly total: number;
}> => {
  let verdicts = await context.changeVerdicts.read();
  const changeSets = await changeSetsAtApproval(context);
  const items = deriveOpenItems({
    changeSets,
    accepted: new Set(verdicts.accepted.map(changeVerdictKey)),
    inputs,
    requests: requestIds.map((requestId) => ({ requestId, label: requestId })),
  });
  const acceptedAt = new Date().toISOString();
  for (const changeSet of items.changeSets.open) {
    if (changeSet.placeIds.length === 0) {
      throw new ApprovalRecordRejected(
        `Change set ${changeSet.id} could not be resolved for approval`,
      );
    }
    verdicts = applyChangeVerdictMutation({
      verdicts,
      mutation: {
        op: "accept",
        from: changeSet.from,
        to: changeSet.to,
        placeIds: changeSet.placeIds,
        acceptedAt,
      },
    });
  }
  return {
    verdicts,
    accepted: items.changeSets.total,
    total: items.changeSets.total,
  };
};

const buildApprovalEntry = async ({
  context,
  pinnedSnapshot,
  message,
  requestsCanceled,
  changeSetsAccepted,
  changeSetsTotal,
}: {
  readonly context: ReviewRouteContext;
  readonly pinnedSnapshot: string;
  readonly message: string;
  readonly requestsCanceled: number;
  readonly changeSetsAccepted: number;
  readonly changeSetsTotal: number;
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
      changeSetsAccepted,
      changeSetsTotal,
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
    super(
      "This plan cannot be approved until every critical decision is answered",
    );
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
 * Finalizes the review against the source as it reads right now. Stamping
 * decided attributes into the source is a later increment; this accepts
 * reviewed changes, cancels leftover work, publishes the derived approved
 * state, and writes the agent handoff.
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

  const requestIds = await openRequestIds(context);
  const settledSource = await readCurrentSource(context);
  if (settledSource.digest !== expectedSnapshot) {
    return refusal({
      status: 409,
      reason: "The plan changed while the approve dialog was open",
      code: "plan-changed",
    });
  }

  let entry: ApprovalEntry;
  let verdicts: StoredChangeVerdicts;
  try {
    const [inventory, inputs] = await Promise.all([
      context.decisionAnswers.inventory(),
      context.decisionAnswers.read(),
    ]);
    const contract = reviewInputs({ inventory, inputs });
    const changeSets = await acceptChangeSets({
      context,
      inputs: contract,
      requestIds,
    });
    verdicts = changeSets.verdicts;
    entry = await buildApprovalEntry({
      context,
      pinnedSnapshot: settledSource.digest,
      message,
      requestsCanceled: 0,
      changeSetsAccepted: changeSets.accepted,
      changeSetsTotal: changeSets.total,
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

  let handoff: AgentApprovalRequest;
  try {
    handoff = approvalAgentRequest({
      approvalId: entry.approvalId,
      sessionId: context.sessionId,
      planId: context.planId,
      planPath: context.resolvedPlanPath,
      pinnedSnapshot: entry.pinnedSnapshot,
      createdAt: entry.at,
      recordedAnswers: entry.recordedAnswers.map((answer) => ({
        decisionId: answer.decisionId,
        optionId: answer.optionId,
      })),
      unansweredDecisions: entry.unansweredDecisions,
      message: entry.message,
    });
  } catch (error: unknown) {
    if (error instanceof AgentExchangeRejected) {
      return refusal({
        status: 500,
        reason: `The approval could not be handed to the agent: ${error.message}`,
      });
    }
    throw error;
  }

  const next = appendApproval({ record: current, entry });
  await writeSnapshot({
    store: context.store,
    snapshot: settledSource.digest,
    source: settledSource.source,
  });
  const canceledAt = new Date().toISOString();
  const finalization: ApprovalFinalization = {
    version: 1,
    expectedSnapshot: settledSource.digest,
    canceledAt,
    requestIds,
    approval: next,
    verdicts,
  };
  let canceledRequestIds: ReadonlyArray<string>;
  try {
    canceledRequestIds = await commitApprovalFinalization({
      store: context.store,
      planPath: context.resolvedPlanPath,
      finalization,
    });
  } catch (error: unknown) {
    if (
      error instanceof Error &&
      error.message === "The plan changed before approval could be finalized"
    ) {
      return refusal({
        status: 409,
        reason: "The plan changed while the approve dialog was open",
        code: "plan-changed",
      });
    }
    throw error;
  }
  context.readerProgress.accept(settledSource.digest);
  for (const requestId of canceledRequestIds) {
    await emitProgress({
      context,
      stepCode: "request-canceled",
      step: "Request canceled by approval",
      requestId,
    });
  }
  try {
    await writeAgentRequest({ store: context.store, request: handoff });
  } catch (error: unknown) {
    context.reportDiagnostic({
      message: "The approval could not be delivered to the agent mailbox",
      error,
    });
  }
  try {
    await writeApprovalBrief({
      store: context.store,
      approvalId: entry.approvalId,
      createdAt: entry.at,
      brief: buildApprovalBrief({
        planPath: context.resolvedPlanPath,
        entry,
      }),
    });
  } catch (error: unknown) {
    context.reportDiagnostic({
      message: "The approval brief could not be written",
      error,
    });
  }
  await emitProgress({
    context,
    stepCode: "plan-approved",
    step: "Plan approved",
    requestId: entry.approvalId,
  });
  const summary = approvalSummary({
    record: await context.approvals.read(),
    currentSnapshot: settledSource.digest,
  });
  return jsonResponse({
    status: 200,
    value: {
      approvalId: entry.approvalId,
      pinnedSnapshot: entry.pinnedSnapshot,
      canceledRequests: canceledRequestIds.length,
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
    const at = new Date().toISOString();
    const next = appendRevocation({
      record: current,
      approvalId,
      at,
    });
    await context.approvals.write(next);
    try {
      await cancelAgentRequest({
        store: context.store,
        requestId: approvalId,
        now: at,
      });
    } catch (error: unknown) {
      if (!(error instanceof AgentExchangeRejected)) {
        context.reportDiagnostic({
          message: "The approval handoff could not be canceled after revoking",
          error,
        });
      }
    }
    await emitProgress({
      context,
      stepCode: "approval-revoked",
      step: "Approval revoked",
      requestId: approvalId,
    });
    const { digest } = await readCurrentSource(context);
    return summaryResponse(
      approvalSummary({ record: next, currentSnapshot: digest }),
    );
  } catch (error: unknown) {
    if (error instanceof ApprovalRecordRejected) {
      return refusal({ status: 409, reason: error.message });
    }
    throw error;
  }
};
