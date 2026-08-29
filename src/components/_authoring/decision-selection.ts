// Owns the one honesty rule every decision component shares: recommendation,
// selection, and state are three separate facts, and only some combinations
// say something true. A chosen option means the question is settled, and a
// settled question names the option that settled it.
//
// It lives here rather than in each compiler because Big Plan writes these two
// attributes itself at approval: the reviewer's answer is stamped into the
// source as state="decided" plus chosen, and one rule is what makes the
// stamped bytes mean the same thing in every decision component.

import type { ScopedChild } from "./contract.js";
import type { DiagnosticCollector } from "./diagnostics.js";
import type {
  CompiledDecisionCardOption,
  DecisionCardStatus,
} from "../_model/decision-card.js";

/** Rejects any chosen/state pairing that would read as a half-settled record. */
export const validateChosenSelection = ({
  component,
  options,
  status,
  position,
  diagnostics,
}: {
  readonly component: string;
  readonly options: ReadonlyArray<CompiledDecisionCardOption>;
  readonly status: DecisionCardStatus;
  readonly position: ScopedChild["position"];
  readonly diagnostics: DiagnosticCollector;
}): void => {
  const chosen = options.filter((option) => option.chosen);
  if (chosen.length > 1) {
    diagnostics.add({
      message: `${component} cannot contain more than one chosen Option`,
      position,
    });
  }
  if (chosen.length === 1 && status !== "decided") {
    diagnostics.add({
      message: `A ${component} with a chosen Option must set state="decided"`,
      position,
    });
  }
  if (chosen.length === 0 && status === "decided") {
    diagnostics.add({
      message: `A ${component} with state="decided" must mark one Option chosen`,
      position,
    });
  }
};
