// Declares SimpleDecisionSet's scoped question grammar; rendering lives in
// the React component library.

import { type ScopedChildDefinition } from "../_authoring/contract.js";
import { compileSimpleDecisionSetComponent } from "./compile.js";
import { SimpleDecisionSet } from "./view.js";
import { defineComponent } from "../_registration/define-component.js";

const bodyPolicy = (name: "SimpleDecision" | "Option") => ({
  prohibited: {
    heading: `${name} bodies cannot contain headings`,
    footnoteReference: `${name} bodies cannot contain footnote references`,
    footnoteDefinition: `${name} bodies cannot contain footnote definitions`,
    registeredComponent: `${name} bodies cannot contain typed components`,
  },
});

const optionDefinition = (): ScopedChildDefinition => ({
  kind: "scoped-child",
  markdownBody: bodyPolicy("Option"),
});

const smallDecisionDefinition = (): ScopedChildDefinition => ({
  kind: "scoped-child",
  markdownBody: bodyPolicy("SimpleDecision"),
  scopedChildren: { Option: optionDefinition() },
});

/** Declares SimpleDecisionSet's renderer and scoped authoring grammar. */
export const SIMPLE_DECISION_SET_COMPONENT_DEFINITION = defineComponent({
  compile: compileSimpleDecisionSetComponent,
  view: SimpleDecisionSet,
  scopedChildren: { SimpleDecision: smallDecisionDefinition() },
});
