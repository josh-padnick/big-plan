// Exercises the authoring lint interface through its first table-format rule,
// including intended findings, source positions, and conservative near misses.

import { describe, expect, it } from "vitest";
import { lintPlan } from "./lint-plan.js";

describe("lintPlan markdown-table-format", () => {
  it("should report the first data row when a table has no delimiter row", () => {
    expect(
      lintPlan({
        markdown:
          "# Plan\n\n## Ownership\n\n| Name | Owner |\n| API | Platform |\n",
      }),
    ).toEqual([
      {
        ruleId: "markdown-table-format",
        line: 6,
        column: 1,
        message:
          'Table-like block needs a valid delimiter row with 2 columns, for example "| --- | --- |"',
      },
    ]);
  });

  it("should report a malformed delimiter row", () => {
    expect(
      lintPlan({
        markdown:
          "  | Name | Owner |\n  | --- | not-a-delimiter |\n  | API | Platform |\n",
      }),
    ).toEqual([
      {
        ruleId: "markdown-table-format",
        line: 2,
        column: 3,
        message:
          'Table-like block needs a valid delimiter row with 2 columns, for example "| --- | --- |"',
      },
    ]);
  });

  it("should report each malformed table-like paragraph in document order", () => {
    const diagnostics = lintPlan({
      markdown:
        "| A | B |\n| 1 | 2 |\n\nText.\n\n| C | D | E |\n| 3 | 4 | 5 |\n",
    });

    expect(diagnostics.map(({ line, message }) => ({ line, message }))).toEqual(
      [
        {
          line: 2,
          message:
            'Table-like block needs a valid delimiter row with 2 columns, for example "| --- | --- |"',
        },
        {
          line: 7,
          message:
            'Table-like block needs a valid delimiter row with 3 columns, for example "| --- | --- | --- |"',
        },
      ],
    );
  });

  it("should inspect malformed table-like paragraphs inside a component body", () => {
    expect(
      lintPlan({
        markdown:
          '<Callout type="note">\n\n| Name | Owner |\n| API | Platform |\n\n</Callout>\n',
      }),
    ).toMatchObject([{ ruleId: "markdown-table-format", line: 4 }]);
  });

  it.each([
    [
      "a valid GFM table",
      "| Name | Owner |\n| --- | --- |\n| API | Platform |\n",
    ],
    ["one table-like row", "| Name | Owner |\n"],
    ["ordinary pipe prose", "Choose A | B today.\nKeep C | D tomorrow.\n"],
    [
      "a fenced code example",
      "```md\n| Name | Owner |\n| API | Platform |\n```\n",
    ],
    ["an inline code example", "`| Name | Owner |` and `| API | Platform |`\n"],
    [
      "table-like blockquote text",
      "> | Name | Owner |\n> | API | Platform |\n",
    ],
  ])("should not report %s", (_label, markdown) => {
    expect(lintPlan({ markdown })).toEqual([]);
  });
});
