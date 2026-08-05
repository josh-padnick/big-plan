// Declares Wireframe's component integration contract: the compiler, the view
// presenting it, and the scoped names a plan author may write inside a
// wireframe.

import { compileWireframe } from "./compile.js";
import { WIREFRAME_ELEMENT_NAMES } from "./catalog.js";
import { Wireframe } from "./view.js";
import type { ScopedChildDefinition } from "../_authoring/contract.js";
import { defineComponent } from "../_registration/define-component.js";
import { defineRevisionAdapter } from "../_registration/revision-adapter.js";

// The wireframe vocabulary nests without a fixed depth, so the scoped-name
// graph deliberately points back at itself: the Markdown layer only needs to
// know that these names belong to Wireframe rather than to the document.
// Which name may actually stand where is the catalog's decision, reported
// against the offending element's own source position by the compiler.
const buildScopedChildren = (): Readonly<
  Record<string, ScopedChildDefinition>
> => {
  const scopedChildren: Record<string, ScopedChildDefinition> = {};
  for (const name of ["Screen", ...WIREFRAME_ELEMENT_NAMES]) {
    scopedChildren[name] = { kind: "scoped-child", scopedChildren };
  }
  return Object.freeze(scopedChildren);
};

/** Declares Wireframe's complete component integration contract. */
export const WIREFRAME_COMPONENT_DEFINITION = defineComponent({
  compile: compileWireframe,
  view: Wireframe,
  revision: defineRevisionAdapter({ view: Wireframe }),
  scopedChildren: buildScopedChildren(),
});
