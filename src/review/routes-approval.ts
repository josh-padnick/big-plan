// The routes that finalize a review: approve records the reviewer's answers
// into the plan source, pins the revision it just wrote, delivers the approval
// to the agent mailbox, and revoke cancels both the approval still in force and
// a still-unresponded handoff.
//
// Approve pins the stamped revision rather than the one the reviewer was
// reading. Pinning the pre-stamp digest would have the approval go stale
// against the very write Big Plan made on the reviewer's behalf: the reviewer
// would press Approve and watch the plan report itself changed a moment later.
// So the stamp is computed first, proved to render, lint, and recompile as
// decided, and only then does one recoverable commit publish it, the accepted
// changes, the approval record, and the agent handoff. The browser never
// writes the log itself.

import { readFile } from "node:fs/promises";
import { basename, extname } from "node:path";
import { renderDocument } from "../render/render-document.js";
import {
  DecisionStampRejected,
  stampDecisions,
} from "../render/stamp-decisions.js";
import { lintPlan } from "../lint/lint-plan.js";
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
} from "./agent-exchange.js";
import {
  AgentRequestNotWithdrawable,
  appendProgressEvent,
  cancelAgentRequest,
} from "./request-mailbox.js";
import {
  randomId,
  readAgentPresence,
  readSnapshot,
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
import { readCommittedChangeSets } from "./change-set-commit.js";
import {
  commitApprovalFinalization,
  type ApprovalFinalization,
} from "./approval-finalization.js";
import { readApprovalSummary } from "./approval-view.js";

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
  readApprovalSummary({
    store: context.store,
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
  readonly stepCode: "approval-revoked" | "request-canceled";
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
  const fallbackTitle = basename(
    context.resolvedPlanPath,
    extname(context.resolvedPlanPath),
  );
  // Approval closes the sets the reviewer was shown, so it counts them the
  // same way the review surface does: one folded set per thread, whose places
  // are the ones its baseline-to-now diff actually has. An approval response
  // is the decision that closes those sets rather than a change inside one, so
  // it never contributes a set of its own.
  const committedChangeSetIds = new Set(
    (await readCommittedChangeSets({ store: context.store })).map(
      (changeSet) => changeSet.changeSetId,
    ),
  );
  const folded = changeSetsFromExchange({
    requests: exchange.requests,
    responses: exchange.responses.filter(
      (response) => response.kind !== "approval",
    ),
    placeIdsByRevision: new Map(),
    committedChangeSetIds,
  });
  for (const { from, to } of folded) {
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
  return folded.map((changeSet) => ({
    ...changeSet,
    placeIds: placeIdsByRevision.get(`${changeSet.from}:${changeSet.to}`) ?? [],
  }));
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
        actor: "reviewer",
      },
    });
  }
  return {
    verdicts,
    accepted: items.changeSets.total,
    total: items.changeSets.total,
  };
};

/**
 * What the reviewer has settled, read once. The stamp and the approval entry
 * are two views of the same answers, so they are computed from one reading:
 * anything the entry says is recorded is a pair of attributes the stamp puts
 * in the file, and an unanswered decision stays unanswered in both.
 */
type ApprovalAnswers = {
  readonly recorded: ReadonlyArray<{
    readonly decisionId: string;
    readonly optionId: string;
    readonly optionTitle: string;
  }>;
  readonly contract: ReturnType<typeof reviewInputs>;
  readonly unanswered: ReadonlyArray<string>;
};

const readApprovalAnswers = async (
  context: ReviewRouteContext,
): Promise<ApprovalAnswers> => {
  const [inventory, inputs] = await Promise.all([
    context.decisionAnswers.inventory(),
    context.decisionAnswers.read(),
  ]);
  const contract = reviewInputs({ inventory, inputs });
  const blocking = contract
    .filter((input) => input.isCritical && input.state !== "answered")
    .map((input) => input.inputId);
  if (blocking.length > 0) {
    throw new CriticalDecisionsOpen(blocking);
  }
  return {
    recorded: currentAnswers({ inputs, inventory }).map((answer) => ({
      decisionId: answer.decisionId,
      optionId: answer.optionId,
      optionTitle: answer.optionTitle,
    })),
    contract,
    unanswered: contract
      .filter((input) => input.state !== "answered")
      .map((input) => input.inputId),
  };
};

const buildApprovalEntry = ({
  answers,
  pinnedSnapshot,
  message,
  agentConnected,
  requestsCanceled,
  changeSetsAccepted,
  changeSetsTotal,
}: {
  readonly answers: ApprovalAnswers;
  readonly pinnedSnapshot: string;
  readonly message: string;
  readonly agentConnected: boolean;
  readonly requestsCanceled: number;
  readonly changeSetsAccepted: number;
  readonly changeSetsTotal: number;
}): ApprovalEntry => ({
  kind: "approval",
  approvalId: randomId(),
  at: new Date().toISOString(),
  pinnedSnapshot,
  agentConnected,
  message,
  recordedAnswers: answers.recorded,
  alreadyDecided: [],
  unansweredDecisions: answers.unanswered,
  openItemCounts: {
    changeSetsAccepted,
    changeSetsTotal,
    decisionsAnswered: answers.contract.filter(
      (input) => input.state === "answered",
    ).length,
    decisionsTotal: answers.contract.length,
    requestsCanceled,
  },
});

/**
 * Writes the reviewer's answers into the plan source and proves the result is
 * still a plan.
 *
 * The proof is the point. Stamping edits a document nobody asked Big Plan to
 * edit, so bytes that no longer render, that a lint rule now rejects, or that
 * read back as anything other than the option the reviewer picked must never
 * reach the file - a reviewer who approved a plan would find one they cannot
 * open. Lint is compared against the source it started from rather than
 * required to be empty, because a finding the author already had is not one
 * this write introduced and is not this write's to refuse.
 */
const stampApprovedAnswers = ({
  source,
  answers,
  fallbackTitle,
}: {
  readonly source: string;
  readonly answers: ApprovalAnswers;
  readonly fallbackTitle: string;
}): string => {
  const { stamped } = stampDecisions({
    markdown: source,
    answers: answers.recorded.map((answer) => ({
      decisionId: answer.decisionId,
      optionTitle: answer.optionTitle,
    })),
  });
  if (stamped === source) return stamped;
  renderDocument({ markdown: stamped, fallbackTitle, identity: {} });
  const before = lintPlan({ markdown: source }).length;
  const after = lintPlan({ markdown: stamped });
  if (after.length > before) {
    throw new DecisionStampRejected(
      `Recording the answers would leave the plan failing authoring lint: ${after
        .map(
          ({ ruleId, line, column, message }) =>
            `${line}:${column} [${ruleId}] ${message}`,
        )
        .join("; ")}`,
    );
  }
  return stamped;
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
 * Finalizes the review against the source as it reads right now: records the
 * reviewer's answers into it as decided decisions, accepts reviewed changes,
 * cancels leftover work, publishes the derived approved state against the
 * revision it just wrote, and writes the agent handoff.
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
  let stampedSource: string;
  let agentConnected = false;
  try {
    agentConnected = (
      await readAgentPresence({
        store: context.store,
        sessionId: context.sessionId,
      })
    ).connected;
  } catch (error: unknown) {
    context.reportDiagnostic({
      message: "Agent presence could not be read before approval",
      error,
    });
  }
  try {
    const answers = await readApprovalAnswers(context);
    const changeSets = await acceptChangeSets({
      context,
      inputs: answers.contract,
      requestIds,
    });
    verdicts = changeSets.verdicts;
    stampedSource = stampApprovedAnswers({
      source: settledSource.source,
      answers,
      fallbackTitle: basename(
        context.resolvedPlanPath,
        extname(context.resolvedPlanPath),
      ),
    });
    entry = buildApprovalEntry({
      answers,
      // The approval pins what it wrote, not what the reviewer was reading.
      pinnedSnapshot: deriveSnapshotDigest(stampedSource),
      message,
      agentConnected,
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
    // An answer that no longer fits the source it was given against - the
    // option renamed, the decision settled or dropped - is the reviewer's to
    // resolve by re-reading the plan, not something to stamp a guess for.
    if (error instanceof DecisionStampRejected) {
      return refusal({
        status: 409,
        reason: `The answers could not be recorded in the plan: ${error.message}`,
        code: "plan-changed",
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
    snapshot: entry.pinnedSnapshot,
    source: stampedSource,
  });
  const canceledAt = new Date().toISOString();
  const finalization: ApprovalFinalization = {
    version: 1,
    expectedSnapshot: entry.pinnedSnapshot,
    canceledAt,
    requestIds,
    approval: next,
    verdicts,
    handoff,
    brief: buildApprovalBrief({
      planPath: context.resolvedPlanPath,
      entry,
    }),
  };
  let finalizationResult: Awaited<
    ReturnType<typeof commitApprovalFinalization>
  >;
  try {
    finalizationResult = await commitApprovalFinalization({
      store: context.store,
      planPath: context.resolvedPlanPath,
      finalization,
      // Publishing the stamp inside the commit's own hold of the plan mutation
      // lock is what keeps the approval from going stale against itself.
      ...(stampedSource === settledSource.source
        ? {}
        : {
            stamp: {
              baseSnapshot: settledSource.digest,
              source: stampedSource,
            },
          }),
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
  const { canceledRequestIds, delivered } = finalizationResult;
  // Moves the reader onto the revision approval just wrote, so the browser
  // swaps in the decided rendering without the reviewer reloading the page.
  context.readerProgress.accept(entry.pinnedSnapshot);
  for (const requestId of canceledRequestIds) {
    await emitProgress({
      context,
      stepCode: "request-canceled",
      step: "Request canceled by approval",
      requestId,
    });
  }
  const summary = await loadSummary(context, entry.pinnedSnapshot);
  return jsonResponse({
    status: 200,
    value: {
      approvalId: entry.approvalId,
      pinnedSnapshot: entry.pinnedSnapshot,
      canceledRequests: canceledRequestIds.length,
      // The record is committed either way, so the approve answer carries what
      // the reviewer would otherwise have to take on faith: whether the agent
      // was actually handed the decision.
      delivered,
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
    let revoked = false;
    try {
      await cancelAgentRequest({
        store: context.store,
        requestId: approvalId,
        now: at,
        // The approval handler checks the record while it holds this same
        // request lock. Commit revocation here so a handler abandoned by the
        // HTTP write gate cannot pass that check and create the handoff after
        // cancellation has already looked for it.
        beforeCancel: async () => {
          await context.approvals.write(next);
          revoked = true;
        },
      });
    } catch (error: unknown) {
      if (!revoked) {
        return refusal({
          status: 409,
          reason:
            "The approval handoff is being updated. Try revoking it again.",
        });
      }
      if (
        error instanceof AgentRequestNotWithdrawable ||
        !(error instanceof AgentExchangeRejected)
      ) {
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
      await readApprovalSummary({
        store: context.store,
        record: next,
        currentSnapshot: digest,
      }),
    );
  } catch (error: unknown) {
    if (error instanceof ApprovalRecordRejected) {
      return refusal({ status: 409, reason: error.message });
    }
    throw error;
  }
};
