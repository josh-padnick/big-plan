import { describe, expect, it } from "vitest";
import {
  parseCellSegments,
  parseTableGrid,
  parseTableRow,
} from "./parse-table-grid.js";

describe("parseTableGrid", () => {
  it("should read headers, rows, and alignments when given a padded GFM grid", () => {
    const parsed = parseTableGrid(
      [
        "| Surface | Rows | Feel |",
        "| :--- | ---: | :---: |",
        "| Callout | 1 | Loud |",
        "| Decision | 12 | Quiet |",
      ].join("\n"),
    );

    expect(parsed.diagnostics).toEqual([]);
    expect(parsed.headers).toEqual(["Surface", "Rows", "Feel"]);
    expect(parsed.alignments).toEqual(["left", "right", "center"]);
    expect(parsed.rows.map((row) => row.map((cell) => cell.text))).toEqual([
      ["Callout", "1", "Loud"],
      ["Decision", "12", "Quiet"],
    ]);
  });

  it("should accept a grid written without outer pipes", () => {
    const parsed = parseTableGrid(
      ["Name | Note", "--- | ---", "one | first"].join("\n"),
    );

    expect(parsed.diagnostics).toEqual([]);
    expect(parsed.headers).toEqual(["Name", "Note"]);
    expect(parsed.rows[0]?.map((cell) => cell.text)).toEqual(["one", "first"]);
  });

  it("should ignore blank lines between rows", () => {
    const parsed = parseTableGrid(
      ["", "| A | B |", "| --- | --- |", "", "| 1 | 2 |", ""].join("\n"),
    );

    expect(parsed.diagnostics).toEqual([]);
    expect(parsed.rows).toHaveLength(1);
  });

  it("should report a delimiter row whose cell count disagrees with the header", () => {
    const parsed = parseTableGrid(
      ["| A | B |", "| --- |", "| 1 | 2 |"].join("\n"),
    );

    expect(parsed.diagnostics[0]?.message).toContain("2 cells of dashes");
    expect(parsed.diagnostics[0]?.line).toBe(2);
  });

  it("should report a row whose cell count disagrees with the header", () => {
    const parsed = parseTableGrid(
      ["| A | B |", "| --- | --- |", "| 1 |"].join("\n"),
    );

    expect(parsed.diagnostics[0]?.message).toBe(
      "Row has 1 cells but the table has 2 columns",
    );
    expect(parsed.diagnostics[0]?.line).toBe(3);
    expect(parsed.rows).toHaveLength(0);
  });

  it("should report a grid with no data rows", () => {
    const parsed = parseTableGrid(["| A | B |", "| --- | --- |"].join("\n"));

    expect(parsed.diagnostics[0]?.message).toContain("at least one data row");
  });

  it("should report a grid with no delimiter row at all", () => {
    const parsed = parseTableGrid("| A | B |");

    expect(parsed.diagnostics[0]?.message).toContain("delimiter row");
  });

  it("should report a blank header because a nameless column cannot be chosen", () => {
    const parsed = parseTableGrid(
      ["| A |  |", "| --- | --- |", "| 1 | 2 |"].join("\n"),
    );

    expect(parsed.diagnostics[0]?.message).toContain("Column 2 has no header");
  });

  it("should report duplicate headers because headers name columns", () => {
    const parsed = parseTableGrid(
      ["| A | A |", "| --- | --- |", "| 1 | 2 |"].join("\n"),
    );

    expect(parsed.diagnostics[0]?.message).toContain("Duplicate column header");
  });

  it("should keep an escaped pipe inside its cell", () => {
    const parsed = parseTableGrid(
      ["| A | B |", "| --- | --- |", "| one \\| two | three |"].join("\n"),
    );

    expect(parsed.diagnostics).toEqual([]);
    expect(parsed.rows[0]?.map((cell) => cell.text)).toEqual([
      "one | two",
      "three",
    ]);
  });
});

describe("parseCellSegments", () => {
  it("should split a cell into text and code runs", () => {
    expect(parseCellSegments("use `Callout` here")).toEqual([
      { kind: "text", value: "use " },
      { kind: "code", value: "Callout" },
      { kind: "text", value: " here" },
    ]);
  });

  it("should leave an unclosed backtick run as literal text", () => {
    expect(parseCellSegments("a ` b")).toEqual([
      { kind: "text", value: "a ` b" },
    ]);
  });

  it("should close a multi-backtick run on a run of the same length", () => {
    expect(parseCellSegments("``a ` b``")).toEqual([
      { kind: "code", value: "a ` b" },
    ]);
  });

  it("should return one empty text segment when given an empty cell", () => {
    expect(parseCellSegments("")).toEqual([{ kind: "text", value: "" }]);
  });
});

describe("parseTableRow", () => {
  it("should parse one summary row against the table width", () => {
    const parsed = parseTableRow({
      source: "| Total | `13` |",
      columnCount: 2,
    });

    expect(parsed.diagnostics).toEqual([]);
    expect(parsed.row?.map((cell) => cell.text)).toEqual(["Total", "13"]);
  });

  it("should reject a summary row with the wrong number of cells", () => {
    expect(
      parseTableRow({ source: "| Total |", columnCount: 2 }).diagnostics,
    ).toEqual([
      {
        line: 1,
        message: "Row has 1 cells but the table has 2 columns",
      },
    ]);
  });

  it("should reject multiple rows because a table has one summary seat", () => {
    expect(
      parseTableRow({
        source: "| Subtotal | 8 |\n| Total | 13 |",
        columnCount: 2,
      }).diagnostics,
    ).toEqual([{ line: 2, message: "Expected exactly one pipe row" }]);
  });

  it("should reject text without a pipe delimiter in a single-column table", () => {
    expect(
      parseTableRow({ source: "Total", columnCount: 1 }).diagnostics,
    ).toEqual([{ line: 1, message: "Expected exactly one pipe row" }]);
  });
});
