// The React port of DatabaseTableSchema: the outer figure around the header,
// columns grid, labeled sections, and hidden raw-source copy target; markup
// mirrors the vanilla renderer class-for-class until the vanilla side is
// deleted.

import { renderToStaticMarkup } from "react-dom/server";
import type { CompiledDatabaseTableSchema } from "../../model/compile-database-table-schema.js";
import { TableSchemaHeader } from "./database-table-schema-header.js";
import {
  TableSchemaGrid,
  TableSchemaSections,
} from "./database-table-schema-views.js";

const TableSchemaView = ({
  model,
}: {
  readonly model: CompiledDatabaseTableSchema;
}) => (
  <figure
    className="table-schema mb-5 min-w-0 rounded-md border border-edge"
    data-database-table-schema=""
    data-schema-table-name={`${model.schemaName ?? ""}${model.tableName}`}
  >
    <TableSchemaHeader
      tableName={model.tableName}
      {...(model.schemaName === undefined
        ? {}
        : { schemaName: model.schemaName })}
      {...(model.schema.note === undefined ? {} : { note: model.schema.note })}
    />
    <div className="table-schema-body min-h-0">
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

/** Renders one compiled DatabaseTableSchema to static HTML via the React port. */
export const renderDatabaseTableSchemaStatic = (
  model: CompiledDatabaseTableSchema,
): string => renderToStaticMarkup(<TableSchemaView model={model} />);
