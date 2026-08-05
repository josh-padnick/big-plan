// Declares CodeDiff's component integration contract and its scoped
// Annotation policy; rendering lives in the React component library.

import { compileCodeDiffComponent } from "./compile.js";
import { CodeDiff } from "./view.js";
import { defineComponent } from "../_registration/define-component.js";
import { defineRevisionAdapter } from "../_registration/revision-adapter.js";

/** Declares CodeDiff's renderer and direct-child Annotation contract. */
export const CODE_DIFF_COMPONENT_DEFINITION = defineComponent({
  compile: compileCodeDiffComponent,
  view: CodeDiff,
  revision: defineRevisionAdapter({ view: CodeDiff }),
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
