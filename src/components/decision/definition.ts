// Declares Decision's compact option-and-consideration authoring grammar.

import { type ScopedChildDefinition } from "../_authoring/contract.js";
import { defineComponent } from "../_registration/define-component.js";
import { compileDecisionComponent } from "./compile.js";
import { Decision } from "./view.js";
import { decisionMarkdown } from "./markdown.js";

const bodyPolicy = (name: string): ScopedChildDefinition["markdownBody"] => ({
  prohibited: {
    heading: `${name} bodies cannot contain headings`,
    footnoteReference: `${name} bodies cannot contain footnote references`,
    footnoteDefinition: `${name} bodies cannot contain footnote definitions`,
    registeredComponent: `${name} bodies cannot contain typed components`,
  },
});

export const DECISION_COMPONENT_DEFINITION = defineComponent({
  compile: compileDecisionComponent,
  view: Decision,
  markdown: decisionMarkdown,
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
