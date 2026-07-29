// Exercises the authoring lint interface through its registered rules,
// including intended findings, source positions, and conservative near misses.

import { describe, expect, it } from "vitest";
import { lintPlan } from "./lint-plan.js";

describe("lintPlan markdown-table-format", () => {
  it("should report the first data row when a table has no delimiter row", () => {
    expect(
      lintPlan({
        markdown:
          "# Plan\n\nA lede.\n\n## Ownership\n\n| Name | Owner |\n| API | Platform |\n",
      }),
    ).toEqual([
      {
        ruleId: "markdown-table-format",
        line: 8,
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

  it("should report a malformed table whose cells contain inline code", () => {
    expect(
      lintPlan({
        markdown: "| `Name` | Owner |\n| API | Platform |\n",
      }),
    ).toMatchObject([{ ruleId: "markdown-table-format", line: 2 }]);
  });

  it("should count escaped pipes as cell content in a malformed table", () => {
    expect(
      lintPlan({
        markdown: "| Name \\| Alias | Owner |\n| API \\| v1 | Platform |\n",
      }),
    ).toEqual([
      {
        ruleId: "markdown-table-format",
        line: 2,
        column: 1,
        message:
          'Table-like block needs a valid delimiter row with 2 columns, for example "| --- | --- |"',
      },
    ]);
  });

  it("should keep a pipe active after an even run of backslashes", () => {
    expect(
      lintPlan({
        markdown: "| Name \\\\| Alias | Owner |\n| API \\\\| v1 | Platform |\n",
      }),
    ).toMatchObject([
      {
        message:
          'Table-like block needs a valid delimiter row with 3 columns, for example "| --- | --- | --- |"',
      },
    ]);
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
      "a multiline inline code example",
      "`Table example:\n| Name | Owner |\n| API | Platform |\n`\n",
    ],
    [
      "table-like blockquote text",
      "> | Name | Owner |\n> | API | Platform |\n",
    ],
  ])("should not report %s", (_label, markdown) => {
    expect(lintPlan({ markdown })).toEqual([]);
  });
});

describe("lintPlan plan-lede", () => {
  it("should report the first section heading when the title has no lede", () => {
    expect(
      lintPlan({ markdown: "# Ship the skill\n\n## Status quo\n\nToday.\n" }),
    ).toEqual([
      {
        ruleId: "plan-lede",
        line: 3,
        column: 1,
        message:
          "Open with a lede: one or two sentences after the title stating the plan's thesis, before the first section heading",
      },
    ]);
  });

  it.each([
    [
      "a title followed by a lede paragraph",
      "# Ship the skill\n\nOne sentence of thesis.\n\n## Status quo\n\nToday.\n",
    ],
    [
      "a title followed by a component",
      '# Ship the skill\n\n<Callout type="note">\n\nContext.\n\n</Callout>\n\n## Status quo\n\nToday.\n',
    ],
    [
      "a title followed by a blockquote",
      "# Ship the skill\n\n> Review goal.\n\n## Status quo\n\nToday.\n",
    ],
    ["a document without a level-one title", "## Status quo\n\nToday.\n"],
    ["a title with no sections at all", "# Ship the skill\n"],
  ])("should not report %s", (_label, markdown) => {
    expect(lintPlan({ markdown })).toEqual([]);
  });
});

describe("lintPlan section-vocabulary", () => {
  it.each([
    ["## Desired outcome\n", 1],
    ["# T\n\nLede.\n\n### Desired Outcomes\n", 5],
    ["# T\n\nLede.\n\n## Definition of done\n", 5],
  ])(
    "should prefer Acceptance criteria over the heading in %j",
    (markdown, line) => {
      expect(lintPlan({ markdown })).toEqual([
        {
          ruleId: "section-vocabulary",
          line,
          column: 1,
          message:
            'Name this section "Acceptance criteria"; it is Big Plan\'s vocabulary for the contract this heading introduces',
        },
      ]);
    },
  );

  it.each([
    [
      "the preferred heading itself",
      "# T\n\nLede.\n\n## Acceptance criteria\n",
    ],
    [
      "a heading that merely contains a discouraged phrase",
      "# T\n\nLede.\n\n## Desired outcome of phase one\n",
    ],
    [
      "prose mentioning a discouraged phrase",
      "# T\n\nThe desired outcome appears in prose.\n",
    ],
  ])("should not report %s", (_label, markdown) => {
    expect(lintPlan({ markdown })).toEqual([]);
  });
});
