// Declares CodeSnippet's component integration contract and its scoped
// Annotation policy; rendering lives in the React component library.

import { type ComponentDefinition } from "../../../../model/component-contract.js";
import { compileCodeSnippetComponent } from "../../../../model/compile-code-snippet.js";
import { renderCodeSnippetStatic } from "../../../../react/code-snippet/code-snippet.js";

/** Declares CodeSnippet's renderer and direct-child Annotation contract. */
export const CODE_SNIPPET_COMPONENT_DEFINITION = {
  compile: compileCodeSnippetComponent,
  renderStatic: (input) =>
    renderCodeSnippetStatic(compileCodeSnippetComponent(input)),
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
