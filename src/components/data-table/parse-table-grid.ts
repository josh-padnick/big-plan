// Owns the DataTable fence grammar: a GFM pipe grid parsed into a header row,
// a delimiter row carrying per-column alignment, and body rows of cells split
// into plain text and inline code runs. Pure and framework-free so the grammar
// is unit-testable without rendering.

export type TableGridAlignment = "left" | "center" | "right";

export type TableCellSegment =
  | { readonly kind: "text"; readonly value: string }
  | { readonly kind: "code"; readonly value: string };

export type TableCell = {
  // The complete plain text of the cell, which sorting and filtering read so
  // neither depends on what the reader can currently see.
  readonly text: string;
  readonly segments: ReadonlyArray<TableCellSegment>;
};

export type TableGridDiagnostic = {
  // One-based, relative to the first line of the fence body.
  readonly line: number;
  readonly message: string;
};

export type ParsedTableGrid = {
  readonly headers: ReadonlyArray<string>;
  readonly alignments: ReadonlyArray<TableGridAlignment>;
  readonly rows: ReadonlyArray<ReadonlyArray<TableCell>>;
  readonly diagnostics: ReadonlyArray<TableGridDiagnostic>;
};

type SourceLine = { readonly text: string; readonly line: number };

// Splits on syntactic pipes only. An odd run of backslashes escapes the pipe
// into cell content; an even run leaves it as a separator. Mirrors the rule
// the markdown-table-format lint rule already applies to prose tables.
const splitCells = (content: string): ReadonlyArray<string> => {
  const cells: Array<string> = [];
  let start = 0;
  for (let index = 0; index < content.length; index += 1) {
    if (content[index] !== "|") continue;
    let backslashes = 0;
    for (
      let cursor = index - 1;
      cursor >= 0 && content[cursor] === "\\";
      cursor -= 1
    ) {
      backslashes += 1;
    }
    if (backslashes % 2 === 1) continue;
    cells.push(content.slice(start, index).trim());
    start = index + 1;
  }
  cells.push(content.slice(start).trim());
  return cells;
};

// Outer pipes are optional so an author can paste either the padded form a
// formatter produces or the bare form they typed.
const rowCells = (text: string): ReadonlyArray<string> => {
  let trimmed = text.trim();
  if (trimmed.startsWith("|")) trimmed = trimmed.slice(1);
  if (trimmed.endsWith("|") && !trimmed.endsWith("\\|")) {
    trimmed = trimmed.slice(0, -1);
  }
  return splitCells(trimmed);
};

const DELIMITER = /^:?-+:?$/u;

const alignmentOf = (cell: string): TableGridAlignment => {
  const left = cell.startsWith(":");
  const right = cell.endsWith(":");
  if (left && right) return "center";
  if (right) return "right";
  return "left";
};

// Unescapes the pipe escape so a cell shows the character the author meant.
const unescapePipes = (value: string): string => value.replace(/\\\|/gu, "|");

/**
 * Splits one cell into alternating text and inline-code runs. A backtick run
 * opens a code span that closes on the next run of the same length, matching
 * how a reader expects `like this` to behave; an unclosed run stays literal.
 */
export const parseCellSegments = (
  raw: string,
): ReadonlyArray<TableCellSegment> => {
  const value = unescapePipes(raw);
  const segments: Array<TableCellSegment> = [];
  let text = "";
  let index = 0;
  while (index < value.length) {
    if (value[index] !== "`") {
      text += value[index];
      index += 1;
      continue;
    }
    let fence = 0;
    while (value[index + fence] === "`") fence += 1;
    const marker = "`".repeat(fence);
    const close = value.indexOf(marker, index + fence);
    const closesCleanly =
      close !== -1 && value[close + fence] !== "`" && close > index + fence;
    if (!closesCleanly) {
      text += marker;
      index += fence;
      continue;
    }
    if (text !== "") {
      segments.push({ kind: "text", value: text });
      text = "";
    }
    segments.push({
      kind: "code",
      value: value.slice(index + fence, close).trim(),
    });
    index = close + fence;
  }
  if (text !== "") segments.push({ kind: "text", value: text });
  return segments.length === 0 ? [{ kind: "text", value: "" }] : segments;
};

const toCell = (raw: string): TableCell => {
  const segments = parseCellSegments(raw);
  return {
    text: segments.map((segment) => segment.value).join(""),
    segments,
  };
};

const meaningfulLines = (source: string): ReadonlyArray<SourceLine> =>
  source
    .split(/\r?\n/u)
    .map((text, index) => ({ text, line: index + 1 }))
    .filter(({ text }) => text.trim() !== "");

/** Parses one authored table fence into headers, alignments, and rows. */
export const parseTableGrid = (source: string): ParsedTableGrid => {
  const lines = meaningfulLines(source);
  const diagnostics: Array<TableGridDiagnostic> = [];
  const header = lines[0];
  const delimiter = lines[1];

  if (header === undefined || delimiter === undefined) {
    return {
      headers: [],
      alignments: [],
      rows: [],
      diagnostics: [
        {
          line: 1,
          message:
            "A table fence needs a header row, a delimiter row, and at least one data row",
        },
      ],
    };
  }

  const headers = rowCells(header.text).map(unescapePipes);
  const delimiterCells = rowCells(delimiter.text);
  const delimiterIsValid =
    delimiterCells.length === headers.length &&
    delimiterCells.every((cell) => DELIMITER.test(cell));
  if (!delimiterIsValid) {
    diagnostics.push({
      line: delimiter.line,
      message: `Delimiter row must hold ${headers.length} cells of dashes, for example "${headers.map(() => "---").join(" | ")}"`,
    });
  }
  const alignments = headers.map((_, index) =>
    delimiterIsValid
      ? alignmentOf(delimiterCells[index] ?? "---")
      : ("left" as TableGridAlignment),
  );

  const blank = headers.findIndex((label) => label === "");
  if (blank !== -1) {
    diagnostics.push({
      line: header.line,
      message: `Column ${blank + 1} has no header; every column needs a name so it can be sorted and chosen`,
    });
  }
  const seen = new Set<string>();
  for (const label of headers) {
    if (label !== "" && seen.has(label)) {
      diagnostics.push({
        line: header.line,
        message: `Duplicate column header "${label}"; headers name columns, so they must be unique`,
      });
    }
    seen.add(label);
  }

  const rows: Array<ReadonlyArray<TableCell>> = [];
  for (const row of lines.slice(2)) {
    const cells = rowCells(row.text);
    if (cells.length !== headers.length) {
      diagnostics.push({
        line: row.line,
        message: `Row has ${cells.length} cells but the table has ${headers.length} columns`,
      });
      continue;
    }
    rows.push(cells.map(toCell));
  }
  if (rows.length === 0 && diagnostics.length === 0) {
    diagnostics.push({
      line: 1,
      message: "A table fence needs at least one data row",
    });
  }

  return { headers, alignments, rows, diagnostics };
};
