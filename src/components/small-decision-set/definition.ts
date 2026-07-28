// Declares SmallDecisionSet's scoped question grammar; rendering lives in
// the React component library.

import { type ScopedChildDefinition } from "../_authoring/contract.js";
import { compileSmallDecisionSetComponent } from "./compile.js";
import { SmallDecisionSet } from "./view.js";
import { defineComponent } from "../../render/markdown/component-pipeline/define-component.js";

const bodyPolicy = (name: "SmallDecision" | "Option") => ({
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
  markdownBody: bodyPolicy("SmallDecision"),
  scopedChildren: { Option: optionDefinition() },
});

/** Declares SmallDecisionSet's renderer and scoped authoring grammar. */
export const SMALL_DECISION_SET_COMPONENT_DEFINITION = defineComponent({
  compile: compileSmallDecisionSetComponent,
  view: SmallDecisionSet,
  scopedChildren: { SmallDecision: smallDecisionDefinition() },
});
