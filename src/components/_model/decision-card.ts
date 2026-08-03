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
  readonly context: ReadonlyArray<ElementContent>;
  readonly detail: ReadonlyArray<ElementContent>;
  readonly criteria: ReadonlyArray<CompiledDecisionCardCriterion>;
  readonly options: ReadonlyArray<CompiledDecisionCardOption>;
  readonly chosenOption?: CompiledDecisionCardOption;
  readonly discriminating: ReadonlyArray<number>;
  readonly reversibility?: CompiledDecisionCardReversibility;
};
