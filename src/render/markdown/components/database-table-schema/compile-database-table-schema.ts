// Compiles DatabaseTableSchema authored HAST into a render-ready model:
// validates the name attribute and single dbml fence, parses the grammar, and
// remaps parser diagnostics onto fence-relative positions.

import {
  validateComponentAttributes,
  type ComponentAttributeSchema,
  type ComponentRenderer,
} from "../component-contract.js";
import { parseTableSchema, type TableSchema } from "./parse-table-schema.js";
import { schemaSource } from "./schema-source.js";

export type CompiledDatabaseTableSchema = {
  readonly tableName: string;
  readonly schemaName?: string;
  readonly schema: TableSchema;
  readonly source: string;
};

const DATABASE_TABLE_SCHEMA_SCHEMA = {
  name: { kind: "string", required: true, nonEmpty: true },
} satisfies ComponentAttributeSchema;

/** Compiles one DatabaseTableSchema component into its renderer model. */
export const compileDatabaseTableSchema = (
  input: Parameters<ComponentRenderer>[0],
): CompiledDatabaseTableSchema => {
  const validated = validateComponentAttributes({
    component: "DatabaseTableSchema",
    attributes: input.attributes,
    position: input.position,
    diagnostics: input.diagnostics,
    schema: DATABASE_TABLE_SCHEMA_SCHEMA,
  });
  const extracted = schemaSource({ children: input.children });
  if (extracted.source === undefined) {
    input.diagnostics.add({
      message:
        "DatabaseTableSchema expects exactly one fenced code block with language dbml and no other content",
      position: input.position,
    });
  }
  const parsed =
    extracted.source === undefined
      ? { schema: { columns: [], indexes: [] }, diagnostics: [] }
      : parseTableSchema({ source: extracted.source });
  for (const diagnostic of parsed.diagnostics) {
    const fenceLine = extracted.codePosition?.start.line;
    input.diagnostics.add({
      message: `Invalid schema line ${diagnostic.line}: ${diagnostic.message}`,
      position:
        fenceLine === undefined
          ? input.position
          : {
              start: { line: fenceLine + diagnostic.line, column: 1 },
              end: { line: fenceLine + diagnostic.line, column: 1 },
            },
    });
  }
  // The muted-schema/bold-table header split mirrors the file-identity
  // dir/name split; only the last dot qualifies so "analytics.daily.rollups"
  // stays a two-part identity.
  const name = validated.name ?? "";
  const lastDotIndex = name.lastIndexOf(".");
  return {
    tableName: lastDotIndex === -1 ? name : name.slice(lastDotIndex + 1),
    ...(lastDotIndex === -1
      ? {}
      : { schemaName: name.slice(0, lastDotIndex + 1) }),
    schema: parsed.schema,
    source: extracted.source ?? "",
  };
};
