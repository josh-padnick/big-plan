// Declares CodeDiff's component integration contract and its scoped
// Annotation policy; rendering lives in the React component library.

import { compileCodeDiffComponent } from "./compile.js";
import { compileCodeDiffDiff } from "./compile-diff.js";
import { CodeDiff } from "./view.js";
import { CodeDiffDiffView } from "./view-diff.js";
import { defineComponent } from "../_registration/define-component.js";
import { codeDiffMarkdown } from "./markdown.js";

/** Declares CodeDiff's renderer and direct-child Annotation contract. */
export const CODE_DIFF_COMPONENT_DEFINITION = defineComponent({
  compile: compileCodeDiffComponent,
  view: CodeDiff,
  markdown: codeDiffMarkdown,
  diff: compileCodeDiffDiff,
  diffView: CodeDiffDiffView,
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
});
