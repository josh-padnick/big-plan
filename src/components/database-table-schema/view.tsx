// Renders DatabaseTableSchema's outer figure, columns grid, labeled sections,
// and hidden source consumed by the live review application.

import type { CompiledDatabaseTableSchema } from "./compile.js";
import { TableSchemaHeader } from "./view-header.js";
import { TableSchemaGrid, TableSchemaSections } from "./view-layouts.js";
import {
  BODY_ATTRIBUTE,
  MAXIMIZABLE_ATTRIBUTE,
} from "../_model/figure-controls/figure-controls.js";

export const DatabaseTableSchema = ({
  model,
}: {
  readonly model: CompiledDatabaseTableSchema;
}) => (
  <figure
    className="table-schema mb-6 min-w-0 rounded-md border border-edge bg-paper"
    data-database-table-schema=""
    {...{ [MAXIMIZABLE_ATTRIBUTE]: "schema" }}
    data-schema-table-name={`${model.schemaName ?? ""}${model.tableName}`}
  >
    <TableSchemaHeader
      tableName={model.tableName}
      {...(model.schemaName === undefined
        ? {}
        : { schemaName: model.schemaName })}
      {...(model.schema.note === undefined ? {} : { note: model.schema.note })}
    />
    <div className="table-schema-body min-h-0" {...{ [BODY_ATTRIBUTE]: "" }}>
      <TableSchemaGrid schema={model.schema} />
      <TableSchemaSections
        schema={model.schema}
        ddlSections={model.ddlSections}
      />
    </div>
    <textarea
      hidden
      readOnly
      data-schema-source=""
      defaultValue={model.source}
    />
  </figure>
);
