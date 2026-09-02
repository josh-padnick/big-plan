// Declares DataTable's component integration contract: the compiler, the view
// that presents its model, Column refinements, and the optional SummaryRow.

import { compileDataTable } from "./compile.js";
import { compileDataTableDiff } from "./compile-diff.js";
import { DataTable } from "./view.js";
import { DataTableDiffView } from "./view-diff.js";
import { defineComponent } from "../_registration/define-component.js";
import { dataTableMarkdown } from "./markdown.js";

/** Declares DataTable's complete component integration contract. */
export const DATA_TABLE_COMPONENT_DEFINITION = defineComponent({
  compile: compileDataTable,
  view: DataTable,
  markdown: dataTableMarkdown,
  diff: compileDataTableDiff,
  diffView: DataTableDiffView,
  commentableAnchors: [
    { kind: "table-column", sides: "both" },
    { kind: "table-cell", sides: "both" },
    { kind: "table-row", sides: "both" },
  ],
  scopedChildren: {
    Column: { kind: "scoped-child" },
    SummaryRow: {
      kind: "scoped-child",
      markdownBody: {
        prohibited: {
          heading: "SummaryRow bodies cannot contain headings",
          footnoteReference:
            "SummaryRow bodies cannot contain footnote references",
          footnoteDefinition:
            "SummaryRow bodies cannot contain footnote definitions",
          registeredComponent:
            "SummaryRow bodies cannot contain typed components",
        },
      },
    },
  },
});
