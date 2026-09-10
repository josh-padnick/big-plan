// Enhances a plain Markdown table into the DataTable grid so a reviewer gets
// the same read controls - maximize, text fit (table-wide and per column),
// column reorder, sort, and row filter - without the author switching to the
// <DataTable> component or changing one character of the authored table.
//
// The authored <table> is never re-serialized: its header and body cells keep
// the links, code, and emphasis they hold, because this transform renders the
// DataTable view over a model built from the cells' text while passing the
// cells' real HAST back through the view's cell/header render overrides.
//
// It runs after component delivery, so a <table> that belongs to a component
// (DataTable, the schema figures, wireframes) sits inside a data-component
// subtree and is left untouched; only author-written prose tables are enhanced.

import type { Element, ElementContent, Root } from "hast";
import { createElement } from "react";
import { Fragment, jsx, jsxs } from "react/jsx-runtime";
import { toJsxRuntime } from "hast-util-to-jsx-runtime";
import { reactToHast } from "./component-pipeline/react-hast-adapter.js";
import { DataTable } from "../../components/data-table/view.js";
import type {
  CompiledDataTable,
  CompiledDataTableColumn,
  CompiledDataTableRow,
  DataTableColumnType,
} from "../../components/data-table/compile.js";
import type { TableGridAlignment } from "../../components/data-table/parse-table-grid.js";

// A filter box on a short table is a promise with nothing to keep, so the
// enhancer offers one only once a table is long enough that a reader hunts a
// row rather than reading straight down it.
const FILTER_ROW_THRESHOLD = 8;

const isElement = (node: ElementContent): node is Element =>
  node.type === "element";

const textOf = (node: Element): string => {
  let text = "";
  for (const child of node.children) {
    if (child.type === "text") {
      text += child.value;
    } else if (child.type === "element") {
      text += textOf(child);
    }
  }
  return text;
};

const childElements = (node: Element, tag: string): ReadonlyArray<Element> =>
  node.children.filter(
    (child): child is Element => isElement(child) && child.tagName === tag,
  );

// The first descendant element matching a tag, searching in document order.
const firstDescendant = (node: Element, tag: string): Element | undefined => {
  for (const child of node.children) {
    if (!isElement(child)) {
      continue;
    }
    if (child.tagName === tag) {
      return child;
    }
    const nested = firstDescendant(child, tag);
    if (nested !== undefined) {
      return nested;
    }
  }
  return undefined;
};

const alignmentOf = (cell: Element): TableGridAlignment => {
  const align = cell.properties["align"];
  if (align === "center" || align === "right" || align === "left") {
    return align;
  }
  const style = cell.properties["style"];
  if (typeof style === "string") {
    if (/text-align:\s*center/i.test(style)) return "center";
    if (/text-align:\s*right/i.test(style)) return "right";
  }
  return "left";
};

// Conservative type inference: a column is a number or date only when every
// non-empty cell fits a strict shape, so sorting never mis-orders text that
// merely happens to start with a digit. Text is always the safe default.
const NUMERIC = /^[-+]?[$£€]?\s?(?:\d+|\d{1,3}(?:[,\s]\d{3})+)(?:\.\d+)?\s*%?$/;
const PLAIN_NUMBER = /^[-+]?\d+(?:\.\d+)?\s*%?$/;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}([T\s]\d{2}:\d{2})?/;
const SLASH_DATE = /^\d{1,2}\/\d{1,2}\/\d{2,4}$/;

const inferType = (values: ReadonlyArray<string>): DataTableColumnType => {
  const nonEmpty = values
    .map((value) => value.trim())
    .filter((value) => value !== "");
  if (nonEmpty.length === 0) {
    return "text";
  }
  const isNumber = (value: string): boolean =>
    PLAIN_NUMBER.test(value) || NUMERIC.test(value);
  if (nonEmpty.every(isNumber)) {
    return "number";
  }
  const isDate = (value: string): boolean =>
    (ISO_DATE.test(value) || SLASH_DATE.test(value)) &&
    !Number.isNaN(Date.parse(value));
  if (nonEmpty.every(isDate)) {
    return "date";
  }
  return "text";
};

type EnhancedTable = {
  readonly model: CompiledDataTable;
  readonly headerCells: ReadonlyArray<Element>;
  readonly bodyCellRows: ReadonlyArray<ReadonlyArray<Element>>;
};

// Reads one authored <table> into a DataTable model plus the authored header
// and body cells the render overrides place back into the grid. Returns
// undefined when the table has no header row, so the caller keeps the plain
// scroll-wrapped table rather than forcing a headless grid into the view.
const readTable = (table: Element, id: string): EnhancedTable | undefined => {
  const thead = firstDescendant(table, "thead");
  const headerRow =
    thead === undefined ? undefined : childElements(thead, "tr")[0];
  if (headerRow === undefined) {
    return undefined;
  }
  const headerCells = childElements(headerRow, "th").length
    ? childElements(headerRow, "th")
    : [...childElements(headerRow, "th"), ...childElements(headerRow, "td")];
  if (headerCells.length === 0) {
    return undefined;
  }

  const bodyRows: Array<Element> = [];
  for (const tbody of childElements(table, "tbody")) {
    bodyRows.push(...childElements(tbody, "tr"));
  }
  const bodyCellRows = bodyRows.map((row) => [
    ...(childElements(row, "td").length
      ? childElements(row, "td")
      : childElements(row, "th")),
  ]);

  const columns: ReadonlyArray<CompiledDataTableColumn> = headerCells.map(
    (cell, index) => ({
      label: textOf(cell).trim() || `Column ${index + 1}`,
      type: inferType(
        bodyCellRows.map((cells) => textOf(cells[index] ?? emptyCell())),
      ),
      align: alignmentOf(cell),
    }),
  );

  const rows: ReadonlyArray<CompiledDataTableRow> = bodyCellRows.map(
    (cells) => ({
      cells: columns.map((_column, index) => {
        const cell = cells[index];
        const text = cell === undefined ? "" : textOf(cell).trim();
        return { text, segments: [{ kind: "text" as const, value: text }] };
      }),
    }),
  );

  const model: CompiledDataTable = {
    id,
    filter: rows.length >= FILTER_ROW_THRESHOLD,
    fit: "wrap",
    columns,
    rows,
    groups: [],
    groupColumn: -1,
  };
  return { model, headerCells, bodyCellRows };
};

const emptyCell = (): Element => ({
  type: "element",
  tagName: "td",
  properties: {},
  children: [],
});

// Renders the inline HAST inside one authored cell as a React node, so the
// grid shows the author's real links and code rather than flattened text.
const cellToReact = (cell: Element | undefined) =>
  cell === undefined
    ? null
    : toJsxRuntime(
        { type: "root", children: cell.children },
        { Fragment, jsx, jsxs },
      );

const enhanceTable = (table: Element, id: string): Element | undefined => {
  const read = readTable(table, id);
  if (read === undefined) {
    return undefined;
  }
  const { model, headerCells, bodyCellRows } = read;
  const figure = reactToHast(
    createElement(DataTable, {
      model,
      showGrouping: false,
      showIdentity: false,
      renderHeaderLabel: ({ columnIndex }) =>
        cellToReact(headerCells[columnIndex]),
      renderCell: ({ rowIndex, columnIndex }) =>
        cellToReact(bodyCellRows[rowIndex]?.[columnIndex]),
    }),
  );
  return figure;
};

// A table that belongs to a component is delivered inside a data-component
// subtree, and the scroll container marks a table a component already wrapped;
// neither is author prose, so the walk leaves both alone.
const bounds = (node: Element): boolean =>
  node.properties["data-component"] !== undefined ||
  node.properties["data-wireframe"] !== undefined ||
  node.properties["data-table-scroll-container"] !== undefined;

const walk = (
  node: Root | Element,
  insideManaged: boolean,
  counter: { value: number },
): void => {
  node.children = node.children.map((child) => {
    if (child.type !== "element") {
      return child;
    }
    const managed = insideManaged || bounds(child);
    if (child.tagName === "table" && !managed) {
      const enhanced = enhanceTable(child, `md-table-${counter.value}`);
      if (enhanced !== undefined) {
        counter.value += 1;
        return enhanced;
      }
    }
    walk(child, managed, counter);
    return child;
  });
};

/**
 * Enhances every author-written Markdown table into the DataTable grid. Runs in
 * place after component delivery so component-owned tables stay untouched.
 */
export const rehypeEnhanceTables = () => (tree: Root) => {
  walk(tree, false, { value: 0 });
};
