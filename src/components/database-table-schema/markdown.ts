// Renders DatabaseTableSchema as portable schema tables and exact SQL examples.

import {
  markdownFromHast,
  markdownHeading,
  markdownInlineText,
  markdownTable,
  type ComponentMarkdownRenderer,
} from "../_model/markdown-export.js";
import type { TableColumnRef } from "./parse-table-schema.js";
import type { CompiledDatabaseTableSchema } from "./compile.js";

// The card shows referential actions as their own badges, so the export keeps
// them in SQL's own words rather than dropping the authored semantics.
const reference = (ref: TableColumnRef): string =>
  [
    `references ${ref.target}`,
    ...(ref.onDelete === undefined ? [] : [`on delete ${ref.onDelete}`]),
    ...(ref.onUpdate === undefined ? [] : [`on update ${ref.onUpdate}`]),
  ].join(" ");

export const databaseTableSchemaMarkdown: ComponentMarkdownRenderer<
  CompiledDatabaseTableSchema
> = (model, { headingOffset }) => {
  const tableName = markdownInlineText(
    `${model.schemaName ?? ""}${model.tableName}`,
  );
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
        ...(column.ref === undefined ? [] : [reference(column.ref)]),
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
    markdownHeading({
      level: 3,
      offset: headingOffset,
      text: `Database table: ${tableName}`,
    }),
    ...(model.schema.note === undefined
      ? []
      : [markdownInlineText(model.schema.note)]),
    markdownTable({
      headers: ["Column", "Type", "Constraints", "Note"],
      rows: columns,
    }),
    ...(indexes.length === 0
      ? []
      : [
          markdownHeading({
            level: 4,
            offset: headingOffset,
            text: "Indexes",
          }),
          markdownTable({
            headers: ["Name", "Columns", "Unique", "Method", "Where", "Note"],
            rows: indexes,
          }),
        ]),
    ...model.ddlSections.map(
      (section) =>
        `${markdownHeading({ level: 4, offset: headingOffset, text: markdownInlineText(section.title) })}\n\n${markdownFromHast(section.children)}`,
    ),
  ].join("\n\n");
};
