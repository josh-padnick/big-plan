// Declares Callout's component integration contract; rendering lives in the
// React component library.

import { compileCalloutComponent } from "../../../../model/compile-callout.js";
import { Callout } from "../../../../ui/callout/callout.js";
import { defineComponent } from "../define-component.js";

/** Declares Callout's complete component integration contract. */
export const CALLOUT_COMPONENT_DEFINITION = defineComponent({
  compile: compileCalloutComponent,
  view: Callout,
});
