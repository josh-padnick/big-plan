// Owns the private render model shared by the three public decision components.

import type { ElementContent } from "hast";

export type DecisionCardStatus = "open" | "decided" | "deferred";
export type DecisionCardTone = "good" | "bad" | "mixed" | "neutral";
export type DecisionCardScoring = "qualitative" | "weighted";
export type DecisionCardLayout = "matrix" | "rows" | "brief";
export type DecisionCardInteraction = "audit" | "choose";
export type DecisionCardReversibilityRating = "easy" | "somewhat-hard" | "hard";

export type CompiledDecisionCardCriterion = {
  readonly id: string;
  readonly title: string;
  readonly detail: ReadonlyArray<ElementContent>;
  readonly impact?: number;
};

export type CompiledDecisionCardConsideration = {
  readonly verdict: string;
  readonly tone: DecisionCardTone;
  readonly detail: ReadonlyArray<ElementContent>;
  readonly score?: number;
};

export type CompiledDecisionCardOption = {
  readonly id: string;
  readonly titleId: string;
  readonly title: string;
  readonly recommended: boolean;
  readonly chosen: boolean;
  readonly summary?: string;
  readonly considerations: ReadonlyArray<
    CompiledDecisionCardConsideration | undefined
  >;
  readonly detail: ReadonlyArray<ElementContent>;
};

export type CompiledDecisionCardReversibility = {
  readonly rating: DecisionCardReversibilityRating;
  readonly detail: ReadonlyArray<ElementContent>;
};

export type CompiledDecisionCard = {
  readonly id: string;
  readonly questionId: string;
  readonly question: string;
  readonly status: DecisionCardStatus;
  readonly layout: DecisionCardLayout;
  readonly scoring: DecisionCardScoring;
  readonly interaction: DecisionCardInteraction;
  /**
   * The author's judgment that this question must be settled before the plan
   * is approved. Criticality is authored rather than derived because only the
   * person proposing the work knows which of its open questions would change
   * what gets built; nothing about a decision's shape can be read for that.
   */
  readonly isCritical: boolean;
  readonly context: ReadonlyArray<ElementContent>;
  readonly detail: ReadonlyArray<ElementContent>;
  readonly criteria: ReadonlyArray<CompiledDecisionCardCriterion>;
  readonly options: ReadonlyArray<CompiledDecisionCardOption>;
  readonly chosenOption?: CompiledDecisionCardOption;
  readonly discriminating: ReadonlyArray<number>;
  readonly reversibility?: CompiledDecisionCardReversibility;
};

/**
 * True when the plan is genuinely asking the reader for an answer: a settled or
 * deferred question renders as a record, and an audited one is presented for
 * inspection rather than choice. The card renders its controls from this, and
 * the review runtime derives which answers it will accept from the same fact,
 * so a decision that cannot be answered can never acquire a stored answer.
 */
export const isAnswerableDecisionCard = (
  model: CompiledDecisionCard,
): boolean => model.status === "open" && model.interaction === "choose";

/**
 * True when this decision must be answered before the plan can be approved.
 * A settled or audited question carries no such obligation whatever it was
 * authored with, so criticality is read through answerability rather than
 * beside it: a decision nobody can answer can never be an unmet obligation.
 */
export const isCriticalDecisionCard = (model: CompiledDecisionCard): boolean =>
  model.isCritical && isAnswerableDecisionCard(model);

/** Computes the one normalized weighted total shared by every presentation. */
export const weightedDecisionTotal = ({
  model,
  option,
}: {
  readonly model: CompiledDecisionCard;
  readonly option: CompiledDecisionCardOption;
}): {
  readonly weights: ReadonlyArray<number>;
  readonly scores: ReadonlyArray<number>;
  readonly numerator: number;
  readonly denominator: number;
  readonly percent: number;
} => {
  const weights = model.criteria.map((criterion) => criterion.impact ?? 0);
  const scores = option.considerations.map(
    (consideration) => consideration?.score ?? 0,
  );
  const numerator = weights.reduce(
    (sum, weight, index) => sum + weight * (scores[index] ?? 0),
    0,
  );
  const denominator = weights.reduce((sum, weight) => sum + weight * 5, 0);
  return {
    weights,
    scores,
    numerator,
    denominator,
    percent:
      denominator === 0 ? 0 : Math.round((numerator / denominator) * 100),
  };
};
