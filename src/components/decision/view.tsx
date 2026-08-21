// Adapts Decision's compiled contract to the shared decision card.

import type { CompiledDecisionCard } from "../_model/decision-card.js";
import { DecisionCard } from "../_shared/decision-card/decision-card.js";
import { useComponentDiffPresentation } from "../_shared/component-diff/component-diff-context.js";

export const Decision = ({
  model,
}: {
  readonly model: CompiledDecisionCard;
}) => {
  const diff = useComponentDiffPresentation();
  return (
    <DecisionCard model={model} isChangeOpen={diff?.side === "proposed"} />
  );
};
