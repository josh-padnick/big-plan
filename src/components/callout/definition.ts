// Declares Callout's component integration contract; rendering lives in the
// React component library.

import { compileCalloutComponent } from "./compile.js";
import { Callout } from "./view.js";
import { defineComponent } from "../../render/markdown/component-pipeline/define-component.js";

/** Declares Callout's complete component integration contract. */
export const CALLOUT_COMPONENT_DEFINITION = defineComponent({
  compile: compileCalloutComponent,
  view: Callout,
});
