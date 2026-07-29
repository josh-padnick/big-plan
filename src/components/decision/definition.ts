// Declares Decision's component integration contract and its option and
// consideration grammar; rendering lives in the React component library.

import { type ScopedChildDefinition } from "../_authoring/contract.js";
import { compileDecisionComponent } from "./compile.js";
import { Decision } from "./view.js";
import { defineComponent } from "../_registration/define-component.js";

const bodyPolicy = (name: string): ScopedChildDefinition["markdownBody"] => ({
  prohibited: {
    heading: `${name} bodies cannot contain headings`,
    footnoteReference: `${name} bodies cannot contain footnote references`,
    footnoteDefinition: `${name} bodies cannot contain footnote definitions`,
    registeredComponent: `${name} bodies cannot contain typed components`,
  },
});

/** Declares Decision's renderer and option-child contract blocks. */
export const DECISION_COMPONENT_DEFINITION = defineComponent({
  compile: compileDecisionComponent,
  view: Decision,
  scopedChildren: {
    Option: {
      kind: "scoped-child",
      markdownBody: bodyPolicy("Option"),
      scopedChildren: {
        Consideration: {
          kind: "scoped-child",
          markdownBody: bodyPolicy("Consideration"),
        },
      },
    },
  },
});
