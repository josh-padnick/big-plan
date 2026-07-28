// Declares DatabaseTableSchema's component integration contract and its
// scoped Ddl policy; rendering lives in the React component library.

import { type ComponentDefinition } from "../../../../model/component-contract.js";
import { compileDatabaseTableSchema } from "../../../../model/compile-database-table-schema.js";
import { renderDatabaseTableSchemaStatic } from "../../../../react/database-table-schema/database-table-schema.js";

/** Declares DatabaseTableSchema's complete component integration contract. */
export const DATABASE_TABLE_SCHEMA_COMPONENT_DEFINITION = {
  compile: compileDatabaseTableSchema,
  renderStatic: (input) =>
    renderDatabaseTableSchemaStatic(compileDatabaseTableSchema(input)),
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
} satisfies ComponentDefinition;
