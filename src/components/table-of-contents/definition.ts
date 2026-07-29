// Declares TableOfContents's component integration contract and its Entry child
// grammar; rendering lives in the React component library.

import type { ScopedChildDefinition } from "../_authoring/contract.js";
import { compileTableOfContentsComponent } from "./compile.js";
import { TableOfContents } from "./view.js";
import { defineComponent } from "../_registration/define-component.js";

// Entries are self-closing attribute carriers; their bodies allow nothing.
const entry: ScopedChildDefinition = {
  kind: "scoped-child",
  markdownBody: {
    prohibited: {
      heading: "Entry is self-closing and cannot contain headings",
      footnoteReference:
        "Entry is self-closing and cannot contain footnote references",
      footnoteDefinition:
        "Entry is self-closing and cannot contain footnote definitions",
      registeredComponent:
        "Entry is self-closing and cannot contain typed components",
    },
  },
};

/** Declares TableOfContents's renderer and Entry-child contract blocks. */
export const TABLE_OF_CONTENTS_COMPONENT_DEFINITION = defineComponent({
  compile: compileTableOfContentsComponent,
  view: TableOfContents,
  scopedChildren: { Entry: entry },
});
