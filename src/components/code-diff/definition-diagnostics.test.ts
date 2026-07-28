// Tests CodeDiff's authored attribute, fence, unified-diff, and scoped
// Annotation diagnostics with document-relative source positions.

import { describe, expect, it } from "vitest";
import {
  annotation,
  fence,
  renderCodeDiffFixture as render,
} from "./test-fixtures.js";

describe("renderCodeDiff diagnostics", () => {
  it("should diagnose a missing file attribute", () => {
    expect(render({ attributes: {} }).diagnostics).toContainEqual({
      line: 3,
      column: 1,
      message: 'Missing required attribute "file"; expected a string',
    });
  });

  it.each(["", "   "])("should diagnose an empty file attribute", (file) => {
    expect(render({ attributes: { file } }).diagnostics).toContainEqual({
      line: 3,
      column: 1,
      message: 'Attribute "file" must be a non-empty string',
    });
  });

  it("should diagnose a wrong-language child", () => {
    expect(
      render({ children: [fence({ language: "ts" })] }).diagnostics,
    ).toEqual([
      {
        line: 3,
        column: 1,
        message:
          "CodeDiff expects exactly one fenced code block with language diff and no other content",
      },
    ]);
  });

  it("should diagnose a missing fence", () => {
    expect(render({ children: [] }).diagnostics).toEqual([
      {
        line: 3,
        column: 1,
        message:
          "CodeDiff expects exactly one fenced code block with language diff and no other content",
      },
    ]);
  });

  it("should diagnose multiple fences", () => {
    expect(render({ children: [fence(), fence()] }).diagnostics).toEqual([
      {
        line: 3,
        column: 1,
        message:
          "CodeDiff expects exactly one fenced code block with language diff and no other content",
      },
    ]);
  });

  it("should diagnose extra markdown children", () => {
    expect(
      render({
        children: [
          fence(),
          { type: "element", tagName: "p", properties: {}, children: [] },
        ],
      }).diagnostics,
    ).toEqual([
      {
        line: 3,
        column: 1,
        message:
          "CodeDiff expects exactly one fenced code block with language diff and no other content",
      },
    ]);
  });

  it("should diagnose showLineNumbers when a headerless diff cannot supply numbers", () => {
    expect(
      render({
        attributes: { file: "x", showLineNumbers: true },
        children: [fence({ source: "-old\n+new\n" })],
      }).diagnostics,
    ).toEqual([
      {
        line: 3,
        column: 1,
        message: "CodeDiff cannot show line numbers without an @@ hunk header",
      },
    ]);
  });

  it("should diagnose an Annotation when a headerless diff cannot supply an anchor", () => {
    expect(
      render({
        children: [fence({ source: "-old\n+new\n" })],
        scopedChildren: [annotation({ lines: "1", positionLine: 12 })],
      }).diagnostics,
    ).toEqual([
      {
        line: 12,
        column: 1,
        message:
          "CodeDiff cannot anchor an Annotation without an @@ hunk header",
      },
    ]);
  });

  it("should diagnose a missing lines attribute", () => {
    const child = annotation({ lines: "1", positionLine: 11 });
    expect(
      render({
        scopedChildren: [{ ...child, attributes: {} }],
      }).diagnostics,
    ).toEqual([
      {
        line: 11,
        column: 1,
        message:
          'Missing required attribute "lines"; expected a positive-integer string or ascending range',
      },
    ]);
  });

  it.each([true, "", "0", "01", "1-1", "2-1", "1-02", "1.5"])(
    "should diagnose invalid lines form %j",
    (lines) => {
      expect(
        render({
          scopedChildren: [annotation({ lines, positionLine: 11 })],
        }).diagnostics,
      ).toEqual([
        {
          line: 11,
          column: 1,
          message:
            'Attribute "lines" must be a positive-integer string or ascending range',
        },
      ]);
    },
  );

  it.each([true, "both"])("should diagnose invalid side form %j", (side) => {
    expect(
      render({
        scopedChildren: [annotation({ lines: "1", side, positionLine: 11 })],
      }).diagnostics,
    ).toEqual([
      {
        line: 11,
        column: 1,
        message:
          'Invalid value for attribute "side"; expected one of: old, new',
      },
    ]);
  });

  it("should diagnose an unknown Annotation attribute contextually", () => {
    expect(
      render({
        scopedChildren: [
          annotation({
            lines: "1",
            positionLine: 11,
            extraAttributes: { tone: "quiet" },
          }),
        ],
      }).diagnostics,
    ).toEqual([
      {
        line: 11,
        column: 1,
        message: 'Unknown attribute "tone" on Annotation',
      },
    ]);
  });

  it.each([
    ["old", "11-12"],
    ["new", "12-14"],
  ] as const)("should diagnose missing %s-side lines %s", (side, lines) => {
    expect(
      render({
        children: [fence({ source: "@@ -12 +12 @@\n-old\n+new\n" })],
        scopedChildren: [annotation({ lines, side, positionLine: 14 })],
      }).diagnostics,
    ).toEqual([
      {
        line: 14,
        column: 1,
        message: `Annotation lines ${lines} do not exist on the ${side} side of the diff`,
      },
    ]);
  });

  it("should report malformed lines at their document and fence-relative positions", () => {
    expect(
      render({ children: [fence({ source: "@@ -1 +1 @@\nbad\n" })] })
        .diagnostics,
    ).toEqual([
      {
        line: 6,
        column: 1,
        message:
          "Invalid diff line 2: Expected a diff line beginning with space, +, or -",
      },
      {
        line: 5,
        column: 1,
        message:
          "Invalid diff line 1: Hunk declares 1 old and 1 new lines but contains 0 old and 0 new lines",
      },
    ]);
  });

  it("should preserve the fence column for a nested malformed diff", () => {
    expect(
      render({
        children: [fence({ source: "@@ -1 +1 @@\nbad\n", column: 5 })],
      }).diagnostics,
    ).toEqual([
      {
        line: 6,
        column: 5,
        message:
          "Invalid diff line 2: Expected a diff line beginning with space, +, or -",
      },
      {
        line: 5,
        column: 5,
        message:
          "Invalid diff line 1: Hunk declares 1 old and 1 new lines but contains 0 old and 0 new lines",
      },
    ]);
  });

  it("should diagnose an unsafe hunk range before anchoring an Annotation", () => {
    expect(
      render({
        children: [
          fence({
            source:
              "@@ -1 +999999999999999999999999999999999999999999 @@\n-old\n+new\n",
          }),
        ],
        scopedChildren: [
          annotation({
            lines: "999999999999999999999999999999999999999999",
          }),
        ],
      }).diagnostics,
    ).toEqual([
      {
        line: 5,
        column: 1,
        message:
          "Invalid diff line 1: Hunk values and line-number ranges must not exceed 9007199254740991",
      },
      {
        line: 10,
        column: 1,
        message:
          "Annotation line 999999999999999999999999999999999999999999 does not exist on the new side of the diff",
      },
    ]);
  });
});
