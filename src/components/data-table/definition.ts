// Declares DataTable's component integration contract: the compiler, the view
// that presents its model, and the Column child that refines one header.

import { compileDataTable } from "./compile.js";
import { DataTable } from "./view.js";
import { defineComponent } from "../_registration/define-component.js";

/** Declares DataTable's complete component integration contract. */
export const DATA_TABLE_COMPONENT_DEFINITION = defineComponent({
  compile: compileDataTable,
  view: DataTable,
  scopedChildren: {
    Column: { kind: "scoped-child" },
  },
});
