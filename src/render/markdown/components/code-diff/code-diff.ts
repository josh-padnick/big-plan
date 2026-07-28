// Declares CodeDiff's component integration contract and its scoped
// Annotation policy; rendering lives in the React component library.

import { type ComponentDefinition } from "../../../../model/component-contract.js";
import { compileCodeDiffComponent } from "../../../../model/compile-code-diff.js";
import { renderCodeDiffStatic } from "../../../../react/code-diff/code-diff.js";

/** Declares CodeDiff's renderer and direct-child Annotation contract. */
export const CODE_DIFF_COMPONENT_DEFINITION = {
  compile: compileCodeDiffComponent,
  renderStatic: (input) =>
    renderCodeDiffStatic(compileCodeDiffComponent(input)),
  scopedChildren: {
    Annotation: {
      kind: "scoped-child",
      markdownBody: {
        prohibited: {
          heading: "Annotation bodies cannot contain headings",
          footnoteReference:
            "Annotation bodies cannot contain footnote references",
          footnoteDefinition:
            "Annotation bodies cannot contain footnote definitions",
          registeredComponent:
            "Annotation bodies cannot contain typed components",
        },
      },
    },
  },
} satisfies ComponentDefinition;
