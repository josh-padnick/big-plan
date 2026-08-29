// Declares Callout's component integration contract; rendering lives in the
// React component library.

import { compileCalloutComponent } from "./compile.js";
import { compileCalloutDiff } from "./compile-diff.js";
import { Callout } from "./view.js";
import { CalloutDiffView } from "./view-diff.js";
import { defineComponent } from "../_registration/define-component.js";
import { calloutMarkdown } from "./markdown.js";

/** Declares Callout's complete component integration contract. */
export const CALLOUT_COMPONENT_DEFINITION = defineComponent({
  compile: compileCalloutComponent,
  view: Callout,
  markdown: calloutMarkdown,
  diff: compileCalloutDiff,
  diffView: CalloutDiffView,
});
