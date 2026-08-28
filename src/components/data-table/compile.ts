// Compiles DataTable's authored form into its render-ready model: validates
// the table and Column schemas, extracts the single table fence, parses the
// pipe grid, and folds per-column overrides onto the parsed headers.

import {
  createComponentIdAllocator,
  validateComponentAttributes,
  type ComponentAttributeSchema,
  type ComponentCompilerInput,
  type ScopedChild,
} from "../_authoring/contract.js";
import { singleAuthoredFence } from "../_authoring/authored-body.js";
import type { DiagnosticCollector } from "../_authoring/diagnostics.js";
import {
  parseTableGrid,
  parseTableRow,
  type TableCell,
  type TableGridAlignment,
} from "./parse-table-grid.js";

export type DataTableFit = "wrap" | "truncate" | "scroll";
export type DataTableColumnType = "text" | "number" | "date";
export type DataTableSort = "asc" | "desc";

const FITS: ReadonlyArray<DataTableFit> = ["wrap", "truncate", "scroll"];
const TYPES: ReadonlyArray<DataTableColumnType> = ["text", "number", "date"];
const ALIGNMENTS: ReadonlyArray<TableGridAlignment> = [
  "left",
  "center",
  "right",
];
const SORTS: ReadonlyArray<DataTableSort> = ["asc", "desc"];

export type CompiledDataTableColumn = {
  readonly label: string;
  readonly type: DataTableColumnType;
  readonly align: TableGridAlignment;
  // True on the column `groupBy` names: a real column that happens to supply
  // the bands, hidden by default rather than removed.
  readonly grouping?: boolean;
  // Present only when the author overrode the table's fit for this column.
  readonly fit?: DataTableFit;
  readonly sort?: DataTableSort;
};

/**
 * One body row. `group` is present only on a grouped table, where it names the
 * subheading the row belongs under. `cells` still holds every column including
 * the grouping one, so revealing that column from the columns menu shows real
 * data rather than a gap.
 */
export type CompiledDataTableRow = {
  readonly group?: string;
  readonly cells: ReadonlyArray<TableCell>;
  // Present only on a diff projection, where filtering rows would otherwise
  // make the rendered row position differ from its source-table position.
  readonly diffSourceIndex?: number;
};

export type CompiledDataTable = {
  readonly id: string;
  readonly title?: string;
  readonly filter: boolean;
  readonly fit: DataTableFit;
  readonly columns: ReadonlyArray<CompiledDataTableColumn>;
  readonly rows: ReadonlyArray<CompiledDataTableRow>;
  readonly summaryRow?: CompiledDataTableRow;
  // Group labels in first-appearance order; empty on an ungrouped table.
  readonly groups: ReadonlyArray<string>;
  // Index of the column the bands come from, or -1 when the table is flat.
  readonly groupColumn: number;
};

const DATA_TABLE_SCHEMA = {
  title: { kind: "string", nonEmpty: true },
  filter: { kind: "booleanShorthand" },
  fit: { kind: "enum", values: FITS },
  groupBy: { kind: "string", nonEmpty: true },
} satisfies ComponentAttributeSchema;

const COLUMN_SCHEMA = {
  name: { kind: "string", required: true, nonEmpty: true },
  type: { kind: "enum", values: TYPES },
  align: { kind: "enum", values: ALIGNMENTS },
  fit: { kind: "enum", values: FITS },
  sort: { kind: "enum", values: SORTS },
} satisfies ComponentAttributeSchema;

const SUMMARY_ROW_SCHEMA = {} satisfies ComponentAttributeSchema;

type ColumnOverride = {
  readonly type?: DataTableColumnType;
  readonly align?: TableGridAlignment;
  readonly fit?: DataTableFit;
  readonly sort?: DataTableSort;
};

// Collects Column overrides keyed by the header they name, reporting unknown
// names, duplicates, and a second sort column at their own authored node.
const collectOverrides = ({
  children,
  headers,
  diagnostics,
}: {
  readonly children: ReadonlyArray<ScopedChild>;
  readonly headers: ReadonlyArray<string>;
  readonly diagnostics: DiagnosticCollector;
}): ReadonlyMap<string, ColumnOverride> => {
  const overrides = new Map<string, ColumnOverride>();
  let sorted = false;
  for (const child of children) {
    const validated = validateComponentAttributes({
      component: "Column",
      attributes: child.attributes,
      position: child.position,
      diagnostics,
      schema: COLUMN_SCHEMA,
    });
    const name = validated.name?.trim();
    if (name === undefined || name === "") continue;
    if (!headers.includes(name)) {
      diagnostics.add({
        message: `Column "${name}" names no header in this table; headers are: ${headers.join(", ")}`,
        position: child.position,
      });
      continue;
    }
    if (overrides.has(name)) {
      diagnostics.add({
        message: `Duplicate Column for header "${name}"`,
        position: child.position,
      });
      continue;
    }
    if (validated.sort !== undefined) {
      if (sorted) {
        diagnostics.add({
          message:
            "Only one Column may declare sort; a table opens in one order",
          position: child.position,
        });
      }
      sorted = true;
    }
    overrides.set(name, {
      ...(validated.type === undefined ? {} : { type: validated.type }),
      ...(validated.align === undefined ? {} : { align: validated.align }),
      ...(validated.fit === undefined ? {} : { fit: validated.fit }),
      ...(validated.sort === undefined || sorted === false
        ? {}
        : { sort: validated.sort }),
    });
  }
  return overrides;
};

// Compiles the one global aggregate row separately from sortable data.
// Keeping the distinction in the model lets every delivery preserve it.
const compileSummaryRow = ({
  children,
  columnCount,
  diagnostics,
}: {
  readonly children: ReadonlyArray<ScopedChild>;
  readonly columnCount: number;
  readonly diagnostics: DiagnosticCollector;
}): CompiledDataTableRow | undefined => {
  const summaries = children.filter((child) => child.name === "SummaryRow");
  for (const duplicate of summaries.slice(1)) {
    diagnostics.add({
      message:
        "DataTable allows one SummaryRow; combine the table-wide aggregates into that row",
      position: duplicate.position,
    });
  }
  const summary = summaries[0];
  if (summary === undefined) return undefined;
  validateComponentAttributes({
    component: "SummaryRow",
    attributes: summary.attributes,
    position: summary.position,
    diagnostics,
    schema: SUMMARY_ROW_SCHEMA,
  });
  const fence = singleAuthoredFence({
    children: summary.children,
    language: "table",
  });
  if (fence === undefined) {
    diagnostics.add({
      message:
        "SummaryRow expects exactly one fenced code block with language table containing one pipe row",
      position: summary.position,
    });
    return undefined;
  }
  const parsed = parseTableRow({ source: fence.source, columnCount });
  const fenceLine = fence.codePosition?.start.line;
  for (const diagnostic of parsed.diagnostics) {
    diagnostics.add({
      message: `Invalid summary row line ${diagnostic.line}: ${diagnostic.message}`,
      position:
        fenceLine === undefined
          ? summary.position
          : {
              start: { line: fenceLine + diagnostic.line, column: 1 },
              end: { line: fenceLine + diagnostic.line, column: 1 },
            },
    });
  }
  return parsed.row === undefined ? undefined : { cells: parsed.row };
};

/** Compiles one DataTable component into the model consumed by rendering. */
export const compileDataTable = ({
  attributes,
  children,
  scopedChildren,
  position,
  diagnostics,
  ids = createComponentIdAllocator(),
}: ComponentCompilerInput): CompiledDataTable => {
  const validated = validateComponentAttributes({
    component: "DataTable",
    attributes,
    position,
    diagnostics,
    schema: DATA_TABLE_SCHEMA,
  });
  const title = validated.title;
  const fit = validated.fit ?? "wrap";
  const id = ids.allocate({
    prefix: "table",
    label: title ?? "",
    fallbackId: "table",
  });

  const fence = singleAuthoredFence({ children, language: "table" });
  if (fence === undefined) {
    diagnostics.add({
      message:
        "DataTable expects exactly one fenced code block with language table",
      position,
    });
  }
  const parsed =
    fence === undefined
      ? { headers: [], alignments: [], rows: [], diagnostics: [] }
      : parseTableGrid(fence.source);
  const fenceLine = fence?.codePosition?.start.line;
  for (const diagnostic of parsed.diagnostics) {
    diagnostics.add({
      message: `Invalid table line ${diagnostic.line}: ${diagnostic.message}`,
      position:
        fenceLine === undefined
          ? position
          : {
              start: { line: fenceLine + diagnostic.line, column: 1 },
              end: { line: fenceLine + diagnostic.line, column: 1 },
            },
    });
  }

  const overrides = collectOverrides({
    children: scopedChildren.filter((child) => child.name === "Column"),
    headers: parsed.headers,
    diagnostics,
  });

  // Grouping is a setting over the data, not a different shape of data. The
  // grouping dimension stays a real column - listed in the columns menu,
  // sortable, and revealable - and `groupBy` only says which column's values
  // become the bands. It is hidden by default while grouping is on, because
  // the band above the rows already says it.
  const groupBy = validated.groupBy?.trim();
  let groupIndex = -1;
  if (groupBy !== undefined && groupBy !== "") {
    groupIndex = parsed.headers.indexOf(groupBy);
    if (groupIndex === -1) {
      diagnostics.add({
        message: `groupBy names no header in this table; headers are: ${parsed.headers.join(", ")}`,
        position,
      });
    } else if (parsed.headers.length < 2) {
      diagnostics.add({
        message:
          "A grouped table needs at least one column beside the grouping column",
        position,
      });
      groupIndex = -1;
    }
  }

  const columns = parsed.headers.map(
    (label, index): CompiledDataTableColumn => {
      const override = overrides.get(label);
      return {
        label,
        type: override?.type ?? "text",
        align: override?.align ?? parsed.alignments[index] ?? "left",
        ...(index === groupIndex ? { grouping: true } : {}),
        ...(override?.fit === undefined ? {} : { fit: override.fit }),
        ...(override?.sort === undefined ? {} : { sort: override.sort }),
      };
    },
  );

  const summaryRow = compileSummaryRow({
    children: scopedChildren,
    columnCount: parsed.headers.length,
    diagnostics,
  });

  // Rows stay in authored order. Grouping is activated only by the viewer
  // enhancement so the inert document remains the complete authored grid.
  const groups: Array<string> = [];
  const rows: Array<CompiledDataTableRow> = [];
  for (const row of parsed.rows) {
    if (groupIndex === -1) {
      rows.push({ cells: row });
    } else {
      const label = row[groupIndex]?.text ?? "";
      if (!groups.includes(label)) groups.push(label);
      rows.push({ group: label, cells: row });
    }
  }

  return {
    id,
    ...(title === undefined ? {} : { title }),
    filter: validated.filter === true,
    fit,
    columns,
    rows,
    ...(summaryRow === undefined ? {} : { summaryRow }),
    groups,
    groupColumn: groupIndex,
  };
};
