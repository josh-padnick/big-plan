// Declares CodeSnippet's component integration contract and its scoped
// Annotation policy; rendering lives in the React component library.

import { compileCodeSnippetComponent } from "./compile.js";
import { CodeSnippet } from "./view.js";
import { defineComponent } from "../_registration/define-component.js";
import { defineRevisionAdapter } from "../_registration/revision-adapter.js";

/** Declares CodeSnippet's renderer and direct-child Annotation contract. */
export const CODE_SNIPPET_COMPONENT_DEFINITION = defineComponent({
  compile: compileCodeSnippetComponent,
  view: CodeSnippet,
  revision: defineRevisionAdapter({ view: CodeSnippet }),
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
