// Presents changed database schema fields without duplicating whole cards.

import { NamedFieldDiffView } from "../_shared/component-diff/named-field-diff-view.js";
import type { CompiledDatabaseTableSchema } from "./compile.js";
import type { CompiledDatabaseTableSchemaDiff } from "./compile-diff.js";
import { DatabaseTableSchema } from "./view.js";

const project = (
  model: CompiledDatabaseTableSchema,
  fields: ReadonlySet<string>,
): CompiledDatabaseTableSchema => ({
  ...model,
  source: "",
  schema: {
    ...model.schema,
    columns: model.schema.columns.filter((column) =>
      fields.has(`Column: ${column.name}`),
    ),
    indexes: model.schema.indexes.filter((index) =>
      fields.has(`Index: ${index.name ?? index.columns.join(", ")}`),
    ),
  },
  ddlSections: model.ddlSections.filter((section) =>
    fields.has(`DDL: ${section.title}`),
  ),
});
export const DatabaseTableSchemaDiffView = ({
  model,
  controlId,
}: {
  readonly model: CompiledDatabaseTableSchemaDiff;
  readonly controlId: string;
}) => (
  <NamedFieldDiffView
    model={model}
    controlId={controlId}
    view={DatabaseTableSchema}
    project={project}
  />
);
