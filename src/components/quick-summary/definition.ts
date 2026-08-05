// Declares QuickSummary's component integration contract and its facet
// grammar; rendering lives in the React component library.

import { type ScopedChildDefinition } from "../_authoring/contract.js";
import {
  compileQuickSummaryComponent,
  QUICK_SUMMARY_FACETS,
} from "./compile.js";
import { QuickSummary } from "./view.js";
import { defineComponent } from "../_registration/define-component.js";
import { defineRevisionAdapter } from "../_registration/revision-adapter.js";

// Facet bodies hold nothing but a short bullet list.
const facet = (name: string): ScopedChildDefinition => ({
  kind: "scoped-child",
  markdownBody: {
    prohibited: {
      heading: `${name} bodies cannot contain headings`,
      footnoteReference: `${name} bodies cannot contain footnote references`,
      footnoteDefinition: `${name} bodies cannot contain footnote definitions`,
      registeredComponent: `${name} bodies cannot contain typed components`,
    },
  },
});

/** Declares QuickSummary's renderer and facet-child contract blocks. */
export const QUICK_SUMMARY_COMPONENT_DEFINITION = defineComponent({
  compile: compileQuickSummaryComponent,
  view: QuickSummary,
  revision: defineRevisionAdapter({ view: QuickSummary }),
  scopedChildren: Object.fromEntries(
    QUICK_SUMMARY_FACETS.map((name) => [name, facet(name)]),
  ),
});
