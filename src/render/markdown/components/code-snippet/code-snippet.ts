// Declares CodeSnippet's component integration contract and its scoped
// Annotation policy; rendering lives in the React component library.

import { compileCodeSnippetComponent } from "../../../../model/compile-code-snippet.js";
import { CodeSnippet } from "../../../../ui/code-snippet/code-snippet.js";
import { defineComponent } from "../define-component.js";

/** Declares CodeSnippet's renderer and direct-child Annotation contract. */
export const CODE_SNIPPET_COMPONENT_DEFINITION = defineComponent({
  compile: compileCodeSnippetComponent,
  view: CodeSnippet,
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
