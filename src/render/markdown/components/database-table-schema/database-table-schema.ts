// Exposes DatabaseTableSchema's component definition: its authored-input
// compiler and the outer figure around the header, table note, columns grid,
// labeled sections, and hidden raw-source copy target.

import type { Element, Text } from "hast";
import {
  type ComponentDefinition,
  type ComponentRenderer,
} from "../../../../model/component-contract.js";
import {
  compileDatabaseTableSchema,
  type CompiledDatabaseTableSchema,
} from "../../../../model/compile-database-table-schema.js";
import { renderTableSchemaHeader } from "./database-table-schema-header.js";
import {
  renderTableSchemaGrid,
  renderTableSchemaSections,
} from "./database-table-schema-views.js";

const FIGURE_CLASSES =
  "table-schema mb-5 min-w-0 rounded-md border border-edge";

const text = (value: string): Text => ({ type: "text", value });

const renderTableSchemaFigure = ({
  model,
}: {
  readonly model: CompiledDatabaseTableSchema;
}): Element => ({
  type: "element",
  tagName: "figure",
  properties: {
    className: FIGURE_CLASSES.split(" "),
    "data-database-table-schema": "",
    "data-schema-table-name": `${model.schemaName ?? ""}${model.tableName}`,
  },
  children: [
    renderTableSchemaHeader({
      tableName: model.tableName,
      ...(model.schemaName === undefined
        ? {}
        : { schemaName: model.schemaName }),
      ...(model.schema.note === undefined ? {} : { note: model.schema.note }),
    }),
    {
      type: "element",
      tagName: "div",
      properties: { className: ["table-schema-body", "min-h-0"] },
      children: [
        renderTableSchemaGrid({ schema: model.schema }),
        ...renderTableSchemaSections({
          schema: model.schema,
          ddlSections: model.ddlSections,
        }),
      ],
    },
    {
      type: "element",
      tagName: "textarea",
      properties: {
        hidden: true,
        readOnly: true,
        "data-schema-source": "",
      },
      children: [text(model.source)],
    },
  ],
});

/** Compiles and renders one DatabaseTableSchema component. */
export const renderDatabaseTableSchema: ComponentRenderer = (input) =>
  renderTableSchemaFigure({ model: compileDatabaseTableSchema(input) });

/** Declares DatabaseTableSchema's complete component integration contract. */
export const DATABASE_TABLE_SCHEMA_COMPONENT_DEFINITION = {
  render: renderDatabaseTableSchema,
  compile: compileDatabaseTableSchema,
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
