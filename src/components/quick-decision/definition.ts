// Declares QuickDecision's brief option-only authoring grammar.

import { compileQuickDecisionComponent } from "./compile.js";
import { QuickDecision } from "./view.js";
import { defineComponent } from "../_registration/define-component.js";
import { quickDecisionMarkdown } from "./markdown.js";

export const QUICK_DECISION_COMPONENT_DEFINITION = defineComponent({
  compile: compileQuickDecisionComponent,
  view: QuickDecision,
  markdown: quickDecisionMarkdown,
  scopedChildren: {
    Option: {
      kind: "scoped-child",
    },
  },
});
