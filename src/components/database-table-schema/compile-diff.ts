import type { ComponentDiffInput } from "../_model/component-diff/contract.js";
import {
  compileNamedFieldDiff,
  type NamedField,
  type NamedFieldDiff,
} from "../_model/component-diff/named-fields.js";
import type { CompiledDatabaseTableSchema } from "./compile.js";

export type CompiledDatabaseTableSchemaDiff =
  NamedFieldDiff<CompiledDatabaseTableSchema>;
const fieldsFor = (
  model: CompiledDatabaseTableSchema,
): ReadonlyArray<NamedField<CompiledDatabaseTableSchema>> => [
  {
    name: "Table",
    value: (value) => ({
      tableName: value.tableName,
      schemaName: value.schemaName,
      note: value.schema.note,
    }),
  },
  ...model.schema.columns.map((column) => ({
    name: `Column: ${column.name}`,
    value: (value: CompiledDatabaseTableSchema) =>
      value.schema.columns.find((candidate) => candidate.name === column.name),
  })),
  ...model.schema.indexes.map((index, position) => ({
    name: `Index: ${index.name ?? index.columns.join(", ")}`,
    value: (value: CompiledDatabaseTableSchema) =>
      value.schema.indexes[position],
  })),
  ...model.ddlSections.map((section) => ({
    name: `DDL: ${section.title}`,
    value: (value: CompiledDatabaseTableSchema) =>
      value.ddlSections.find((candidate) => candidate.title === section.title),
  })),
];
export const compileDatabaseTableSchemaDiff = (
  input: ComponentDiffInput<CompiledDatabaseTableSchema>,
): CompiledDatabaseTableSchemaDiff => {
  const sample = input.status === "removed" ? input.baseline : input.proposed;
  return compileNamedFieldDiff(input, fieldsFor(sample));
};
