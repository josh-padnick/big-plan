// Renders DatabaseTableSchema as portable schema tables and exact SQL examples.

import {
  markdownFromHast,
  markdownInlineText,
  markdownTable,
  type ComponentMarkdownRenderer,
} from "../_model/markdown-export.js";
import type { CompiledDatabaseTableSchema } from "./compile.js";

export const databaseTableSchemaMarkdown: ComponentMarkdownRenderer<
  CompiledDatabaseTableSchema
> = (model) => {
  const tableName = `${model.schemaName ?? ""}${model.tableName}`;
  const columns = model.schema.columns.map((column) => [
    markdownInlineText(column.name),
    markdownInlineText(column.type),
    markdownInlineText(
      [
        ...(column.primaryKey ? ["primary key"] : []),
        ...(column.notNull ? ["not null"] : []),
        ...(column.unique ? ["unique"] : []),
        ...(column.identity ? ["identity"] : []),
        ...(column.defaultValue === undefined
          ? []
          : [`default ${column.defaultValue}`]),
        ...(column.check === undefined ? [] : [`check ${column.check}`]),
        ...(column.ref === undefined
          ? []
          : [`references ${column.ref.target}`]),
      ].join(", "),
    ),
    markdownInlineText(column.note ?? ""),
  ]);
  const indexes = model.schema.indexes.map((index) => [
    markdownInlineText(index.name ?? ""),
    markdownInlineText(index.columns.join(", ")),
    index.unique ? "Yes" : "No",
    markdownInlineText(index.method ?? ""),
    markdownInlineText(index.where ?? ""),
    markdownInlineText(index.note ?? ""),
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
