// Declares BigDecision's component integration contract and its recursively
// scoped authoring grammar; rendering lives in the React component library.

import {
  type ComponentDefinition,
  type ScopedChildDefinition,
} from "../../../../model/component-contract.js";
import { compileBigDecisionComponent } from "../../../../model/compile-big-decision.js";
import { renderBigDecisionStatic } from "../../../../react/big-decision/big-decision.js";

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
export const BIG_DECISION_COMPONENT_DEFINITION = {
  compile: compileBigDecisionComponent,
  renderStatic: (input) =>
    renderBigDecisionStatic(compileBigDecisionComponent(input)),
  scopedChildren: {
    Criterion: criterionDefinition(),
    Details: {
      kind: "scoped-child",
      markdownBody: bodyPolicy("Details"),
    },
    Option: optionDefinition(),
    Reversibility: reversibilityDefinition(),
  },
} satisfies ComponentDefinition;
