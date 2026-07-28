// Declares Callout's component integration contract; rendering lives in the
// React component library.

import { type ComponentDefinition } from "../../../../model/component-contract.js";
import { compileCalloutComponent } from "../../../../model/compile-callout.js";
import { renderCalloutStatic } from "../../../../react/callout/callout.js";

/** Declares Callout's complete component integration contract. */
export const CALLOUT_COMPONENT_DEFINITION = {
  compile: compileCalloutComponent,
  renderStatic: (input) => renderCalloutStatic(compileCalloutComponent(input)),
} satisfies ComponentDefinition;
