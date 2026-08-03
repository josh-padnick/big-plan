// Adapts DecisionAnalysis's compiled contract to the shared decision card.

import type { CompiledDecisionCard } from "../_model/decision-card.js";
import { DecisionCard } from "../_shared/decision-card/decision-card.js";

export const DecisionAnalysis = ({
  model,
}: {
  readonly model: CompiledDecisionCard;
}) => <DecisionCard model={model} />;
