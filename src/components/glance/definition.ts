// Declares Glance's component integration contract and its Item child
// grammar; rendering lives in the React component library.

import type { ScopedChildDefinition } from "../_authoring/contract.js";
import { compileGlanceComponent } from "./compile.js";
import { Glance } from "./view.js";
import { defineComponent } from "../_registration/define-component.js";

// Items are self-closing attribute carriers; their bodies allow nothing.
const item: ScopedChildDefinition = {
  kind: "scoped-child",
  markdownBody: {
    prohibited: {
      heading: "Item is self-closing and cannot contain headings",
      footnoteReference:
        "Item is self-closing and cannot contain footnote references",
      footnoteDefinition:
        "Item is self-closing and cannot contain footnote definitions",
      registeredComponent:
        "Item is self-closing and cannot contain typed components",
    },
  },
};

/** Declares Glance's renderer and Item-child contract blocks. */
export const GLANCE_COMPONENT_DEFINITION = defineComponent({
  compile: compileGlanceComponent,
  view: Glance,
  scopedChildren: { Item: item },
});
