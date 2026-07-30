// Declares ComplexDecision's component integration contract and its recursively
// scoped authoring grammar; rendering lives in the React component library.

import { type ScopedChildDefinition } from "../_authoring/contract.js";
import { compileComplexDecisionComponent } from "./compile.js";
import { ComplexDecision } from "./view.js";
import { defineComponent } from "../_registration/define-component.js";

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

/** Declares ComplexDecision's renderer and recursively scoped authoring grammar. */
export const COMPLEX_DECISION_COMPONENT_DEFINITION = defineComponent({
  compile: compileComplexDecisionComponent,
  view: ComplexDecision,
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
