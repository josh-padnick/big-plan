// Renders DatabaseTableSchema as portable schema tables and exact SQL examples.

import {
  markdownFromHast,
  markdownTable,
  type ComponentMarkdownRenderer,
} from "../_model/markdown-export.js";
import type { CompiledDatabaseTableSchema } from "./compile.js";

export const databaseTableSchemaMarkdown: ComponentMarkdownRenderer<
  CompiledDatabaseTableSchema
> = (model) => {
  const tableName = `${model.schemaName ?? ""}${model.tableName}`;
  const columns = model.schema.columns.map((column) => [
    column.name,
    column.type,
    [
      ...(column.primaryKey ? ["primary key"] : []),
      ...(column.notNull ? ["not null"] : []),
      ...(column.unique ? ["unique"] : []),
      ...(column.identity ? ["identity"] : []),
      ...(column.defaultValue === undefined
        ? []
        : [`default ${column.defaultValue}`]),
      ...(column.check === undefined ? [] : [`check ${column.check}`]),
      ...(column.ref === undefined ? [] : [`references ${column.ref.target}`]),
    ].join(", "),
    column.note ?? "",
  ]);
  const indexes = model.schema.indexes.map((index) => [
    index.name ?? "",
    index.columns.join(", "),
    index.unique ? "Yes" : "No",
    index.method ?? "",
    index.where ?? "",
    index.note ?? "",
  ]);
  return [
    `### Database table: ${tableName}`,
    ...(model.schema.note === undefined ? [] : [model.schema.note]),
    markdownTable({
      headers: ["Column", "Type", "Constraints", "Note"],
      rows: columns,
    }),
    ...(indexes.length === 0
      ? []
      : [
          "#### Indexes",
          markdownTable({
            headers: ["Name", "Columns", "Unique", "Method", "Where", "Note"],
            rows: indexes,
          }),
        ]),
    ...model.ddlSections.map(
      (section) =>
        `#### ${section.title}\n\n${markdownFromHast(section.children)}`,
    ),
  ].join("\n\n");
};
