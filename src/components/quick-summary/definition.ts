// Declares QuickSummary's component integration contract; rendering lives in
// the React component library.

import { compileQuickSummaryComponent } from "./compile.js";
import { QuickSummary } from "./view.js";
import { defineComponent } from "../_registration/define-component.js";

/** Declares QuickSummary's complete component integration contract. */
export const QUICK_SUMMARY_COMPONENT_DEFINITION = defineComponent({
  compile: compileQuickSummaryComponent,
  view: QuickSummary,
});
