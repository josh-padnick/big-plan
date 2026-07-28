// Compiles DatabaseTableSchema authored HAST into a render-ready model:
// validates the name attribute, single dbml fence, and Ddl children, parses
// the grammar, and remaps parser diagnostics onto fence-relative positions.

import type { ElementContent } from "hast";
import {
  meaningfulChildren,
  singleAuthoredFence,
} from "../_authoring/authored-body.js";
import {
  validateComponentAttributes,
  type ComponentAttributeSchema,
  type ComponentCompilerInput,
  type ScopedChild,
} from "../_authoring/contract.js";
import type { DiagnosticCollector } from "../_authoring/diagnostics.js";
import { parseTableSchema, type TableSchema } from "./parse-table-schema.js";

export type CompiledDdlSection = {
  readonly title: string;
  readonly children: ReadonlyArray<ElementContent>;
};

export type CompiledDatabaseTableSchema = {
  readonly tableName: string;
  readonly schemaName?: string;
  readonly schema: TableSchema;
  readonly source: string;
  readonly ddlSections: ReadonlyArray<CompiledDdlSection>;
};

const DATABASE_TABLE_SCHEMA_SCHEMA = {
  name: { kind: "string", required: true, nonEmpty: true },
} satisfies ComponentAttributeSchema;

const DDL_SCHEMA = {
  title: { kind: "string", required: true, nonEmpty: true },
} satisfies ComponentAttributeSchema;

// Compiles the Ddl children into titled verbatim sections, preserving
// authored order and rejecting duplicate titles so tabs stay unambiguous.
const compileDdlSections = ({
  scopedChildren,
  diagnostics,
}: {
  readonly scopedChildren: ReadonlyArray<ScopedChild>;
  readonly diagnostics: DiagnosticCollector;
}): ReadonlyArray<CompiledDdlSection> => {
  const sections: Array<CompiledDdlSection> = [];
  const seenTitles = new Set<string>();
  for (const child of scopedChildren) {
    const validated = validateComponentAttributes({
      component: "Ddl",
      attributes: child.attributes,
      position: child.position,
      diagnostics,
      schema: DDL_SCHEMA,
    });
    const children = meaningfulChildren(child.children);
    if (
      singleAuthoredFence({ children: child.children, language: "sql" }) ===
      undefined
    ) {
      diagnostics.add({
        message:
          "Ddl expects exactly one fenced code block with language sql and no other content",
        position: child.position,
      });
      continue;
    }
    const title = validated.title;
    if (title === undefined) {
      continue;
    }
    const titleKey = title.replace(/\s+/gu, " ").trim();
    if (seenTitles.has(titleKey)) {
      diagnostics.add({
        message: `Duplicate Ddl title "${title}"`,
        position: child.position,
      });
      continue;
    }
    seenTitles.add(titleKey);
    sections.push({ title, children });
  }
  return sections;
};

/** Compiles one DatabaseTableSchema component into its renderer model. */
export const compileDatabaseTableSchema = (
  input: ComponentCompilerInput,
): CompiledDatabaseTableSchema => {
  const validated = validateComponentAttributes({
    component: "DatabaseTableSchema",
    attributes: input.attributes,
    position: input.position,
    diagnostics: input.diagnostics,
    schema: DATABASE_TABLE_SCHEMA_SCHEMA,
  });
  const extracted = singleAuthoredFence({
    children: input.children,
    language: "dbml",
  });
  if (extracted === undefined) {
    input.diagnostics.add({
      message:
        "DatabaseTableSchema expects exactly one fenced code block with language dbml and no other content",
      position: input.position,
    });
  }
  const parsed =
    extracted === undefined
      ? { schema: { columns: [], indexes: [] }, diagnostics: [] }
      : parseTableSchema({ source: extracted.source });
  for (const diagnostic of parsed.diagnostics) {
    const fenceLine = extracted?.codePosition?.start.line;
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
    source: extracted?.source ?? "",
    ddlSections: compileDdlSections({
      scopedChildren: input.scopedChildren,
      diagnostics: input.diagnostics,
    }),
  };
};
