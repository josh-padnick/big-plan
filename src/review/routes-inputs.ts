// The routes that own the reviewer's answers to the decisions a plan asks: the
// record read back on load, and the one mutation that changes it.
//
// Both answer with only the answers that are still current, because currency is
// the runtime's to decide - it compiles the plan, so it alone knows what the
// plan asks the moment the source changes. The browser is told which decisions
// hold an answer that stopped applying, because a masked answer and an
// unanswered decision are the same empty card from its side.

import { readFile } from "node:fs/promises";
import { jsonResponse, payloadOf, refusal } from "./review-route-context.js";
import type {
  ReviewRouteContext,
  ReviewRouteRequest,
  ReviewRouteResponse,
} from "./review-route-context.js";
import {
  applyStagedInputMutation,
  currentAnswers,
  PlanInputsRejected,
  supersededDecisionIds,
  validateStagedInputMutation,
} from "./plan-inputs-store.js";
import type { StagedInputs } from "./plan-inputs-store.js";
import type { DecisionInventory } from "./decision-inventory.js";
import { deriveSnapshotDigest } from "./agent-exchange.js";
import { approvalSummary } from "./shared/approval.js";
import { encodeReviewState } from "./shared/review-wire.js";

const answerState = async ({
  context,
  inputs,
  inventory,
}: {
  readonly context: ReviewRouteContext;
  readonly inputs: StagedInputs;
  readonly inventory: DecisionInventory;
}): Promise<ReviewRouteResponse> => {
  const source = await readFile(context.resolvedPlanPath, "utf8");
  const approval = approvalSummary({
    record: await context.approvals.read(),
    currentSnapshot: deriveSnapshotDigest(source),
  });
  return jsonResponse({
    status: 200,
    value: encodeReviewState({
      answers: currentAnswers({ inputs, inventory }),
      supersededDecisionIds: supersededDecisionIds({ inputs, inventory }),
      revision: inputs.revision,
      ...(approval === undefined ? {} : { approval }),
    }),
  });
};

/** Reads the answers the plan still asks for, with the revision that made them. */
export const readDecisionAnswerState = async (
  context: ReviewRouteContext,
): Promise<ReviewRouteResponse> => {
  const { decisionAnswers } = context;
  const inventory = await decisionAnswers.inventory();
  return answerState({
    context,
    inputs: await decisionAnswers.read(),
    inventory,
  });
};

/**
 * Applies one mutation to the answer record. Registration in the route table
 * gives this the write gate and the session-authority check, so the whole
 * read-modify-write stays atomic against another browser's mutation and only
 * a session that still holds authority reaches it.
 */
export const stageDecisionAnswer = async (
  context: ReviewRouteContext,
  request: ReviewRouteRequest,
): Promise<ReviewRouteResponse> => {
  const { decisionAnswers } = context;
  const inventory = await decisionAnswers.inventory();
  try {
    const mutation = validateStagedInputMutation({
      value: payloadOf(request.body),
      now: new Date().toISOString(),
      inventory,
    });
    const inputs = applyStagedInputMutation({
      inputs: await decisionAnswers.read(),
      mutation,
    });
    await decisionAnswers.write(inputs);
    return answerState({ context, inputs, inventory });
  } catch (error: unknown) {
    if (error instanceof PlanInputsRejected) {
      return refusal({ status: 400, reason: error.message });
    }
    throw error;
  }
};
