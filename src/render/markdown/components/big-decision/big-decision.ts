// Declares BigDecision's component integration contract and its recursively
// scoped authoring grammar; rendering lives in the React component library.

import { type ScopedChildDefinition } from "../../../../model/component-contract.js";
import { compileBigDecisionComponent } from "../../../../model/compile-big-decision.js";
import { BigDecision } from "../../../../ui/big-decision/big-decision.js";
import { defineComponent } from "../define-component.js";

const bodyPolicy = (
  name: "Criterion" | "Details" | "Option" | "Reversibility" | "Score",
) => ({
  prohibited: {
    heading: `${name} bodies cannot contain headings`,
    footnoteReference: `${name} bodies cannot contain footnote references`,
    footnoteDefinition: `${name} bodies cannot contain footnote definitions`,
    registeredComponent: `${name} bodies cannot contain typed components`,
  },
});

const criterionDefinition = (): ScopedChildDefinition => ({
  kind: "scoped-child",
  markdownBody: bodyPolicy("Criterion"),
});

const scoreDefinition = (): ScopedChildDefinition => ({
  kind: "scoped-child",
  markdownBody: bodyPolicy("Score"),
});

const optionDefinition = (): ScopedChildDefinition => ({
  kind: "scoped-child",
  markdownBody: bodyPolicy("Option"),
  scopedChildren: { Score: scoreDefinition() },
});

const reversibilityDefinition = (): ScopedChildDefinition => ({
  kind: "scoped-child",
  markdownBody: bodyPolicy("Reversibility"),
});

/** Declares BigDecision's renderer and recursively scoped authoring grammar. */
export const BIG_DECISION_COMPONENT_DEFINITION = defineComponent({
  compile: compileBigDecisionComponent,
  view: BigDecision,
  scopedChildren: {
    Criterion: criterionDefinition(),
    Details: {
      kind: "scoped-child",
      markdownBody: bodyPolicy("Details"),
    },
    Option: optionDefinition(),
    Reversibility: reversibilityDefinition(),
  },
});
