// Declares DatabaseTableSchema's component integration contract and its
// scoped Ddl policy; rendering lives in the React component library.

import { compileDatabaseTableSchema } from "./compile.js";
import { compileDatabaseTableSchemaDiff } from "./compile-diff.js";
import { DatabaseTableSchema } from "./view.js";
import { DatabaseTableSchemaDiffView } from "./view-diff.js";
import { defineComponent } from "../_registration/define-component.js";
import { databaseTableSchemaMarkdown } from "./markdown.js";

/** Declares DatabaseTableSchema's complete component integration contract. */
export const DATABASE_TABLE_SCHEMA_COMPONENT_DEFINITION = defineComponent({
  compile: compileDatabaseTableSchema,
  view: DatabaseTableSchema,
  markdown: databaseTableSchemaMarkdown,
  diff: compileDatabaseTableSchemaDiff,
  diffView: DatabaseTableSchemaDiffView,
  commentableAnchors: [{ kind: "database-table-schema-field", sides: "both" }],
  scopedChildren: {
    Ddl: {
      kind: "scoped-child",
      markdownBody: {
        prohibited: {
          heading: "Ddl bodies cannot contain headings",
          footnoteReference: "Ddl bodies cannot contain footnote references",
          footnoteDefinition: "Ddl bodies cannot contain footnote definitions",
          registeredComponent: "Ddl bodies cannot contain typed components",
        },
      },
    },
  },
});
