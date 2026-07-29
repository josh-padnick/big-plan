// Declares Part's component integration contract; rendering lives in the
// React component library.

import { compilePartComponent } from "./compile.js";
import { Part } from "./view.js";
import { defineComponent } from "../_registration/define-component.js";

/** Declares Part's complete component integration contract. */
export const PART_COMPONENT_DEFINITION = defineComponent({
  compile: compilePartComponent,
  view: Part,
});
