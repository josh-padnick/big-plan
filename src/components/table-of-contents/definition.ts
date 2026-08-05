// Declares TableOfContents's component integration contract and its Entry child
// grammar; rendering lives in the React component library.

import type { ScopedChildDefinition } from "../_authoring/contract.js";
import { compileTableOfContentsComponent } from "./compile.js";
import { TableOfContents } from "./view.js";
import { defineOutlineComponent } from "../_registration/define-component.js";
import { defineOutlineRevisionAdapter } from "../_registration/revision-adapter.js";

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
export const TABLE_OF_CONTENTS_COMPONENT_DEFINITION = defineOutlineComponent({
  compile: compileTableOfContentsComponent,
  view: TableOfContents,
  revision: defineOutlineRevisionAdapter({ view: TableOfContents }),
  // The overview consumes the whole outline but contributes nothing to it;
  // it only bounds the slide the transform is building.
  marker: () => ({ kind: "boundary" }),
  scopedChildren: { Entry: entry },
});
