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

describe("lintPlan lede-presence", () => {
  it("should report the first section heading when the title has no lede", () => {
    expect(
      lintPlan({ markdown: "# Ship the skill\n\n## Status quo\n\nToday.\n" }),
    ).toEqual([
      {
        ruleId: "lede-presence",
        line: 3,
        column: 1,
        message:
          "Open with a lede: one concise sentence after the title stating the plan's thesis, before the first section heading",
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

describe("lintPlan title-length", () => {
  it("should report a title longer than eight words", () => {
    expect(
      lintPlan({
        markdown:
          "# Ship the official Big Plan skill users install into their agents\n\nLede.\n",
      }),
    ).toEqual([
      {
        ruleId: "title-length",
        line: 1,
        column: 1,
        message:
          "Keep the title a punchy noun phrase of at most 8 words and 60 characters naming the outcome",
      },
    ]);
  });

  it("should report a title longer than sixty characters", () => {
    expect(
      lintPlan({
        markdown: `# Institutionalize cross-organizational containerization\n\nLede.\n`,
      }),
    ).toEqual([]);
    expect(
      lintPlan({
        markdown: `# Institutionalize cross-organizational containerization computations\n\nLede.\n`,
      }),
    ).toMatchObject([{ ruleId: "title-length", line: 1 }]);
  });

  it.each([
    [
      "an eight-word title",
      "# Add an official installable skill to Big Plan\n\nLede.\n",
    ],
    [
      "a title with inline code",
      "# Ship the `big-plan skill` command\n\nLede.\n",
    ],
    [
      "a document without a leading title",
      "Prose first.\n\n# A very long title that would otherwise be flagged here\n",
    ],
  ])("should not report %s", (_label, markdown) => {
    expect(lintPlan({ markdown })).toEqual([]);
  });
});

describe("lintPlan lede-style", () => {
  it.each([
    ["I propose one version-controlled skill file."],
    ["This plan adds per-key rate limiting."],
    ["this document exercises every major shape."],
    ["We will move retries into a queue."],
  ])("should report a lede opening with %j", (lede) => {
    expect(lintPlan({ markdown: `# Title\n\n${lede}\n` })).toEqual([
      {
        ruleId: "lede-style",
        line: 3,
        column: 1,
        message:
          'Write the lede as a declarative subtitle describing the delivered outcome, not an opener like "I propose" or "This plan"',
      },
    ]);
  });

  it.each([
    [
      "a declarative lede",
      "# Title\n\nA durable retry pipeline replaces inline retries.\n",
    ],
    [
      "a lede mentioning the phrase later in the sentence",
      "# Title\n\nEverything this plan touches stays local.\n",
    ],
    [
      "a component directly after the title",
      '# Title\n\n<Callout type="note">\n\nI propose nothing here.\n\n</Callout>\n',
    ],
    [
      "a document without a leading title",
      "This plan is referenced in prose.\n",
    ],
  ])("should not report %s", (_label, markdown) => {
    expect(lintPlan({ markdown })).toEqual([]);
  });
});

describe("lintPlan lede-length", () => {
  it("should report a lede longer than thirty words with its count", () => {
    const longLede = Array.from({ length: 31 }, (_, i) => `word${i}`).join(" ");
    expect(lintPlan({ markdown: `# Title\n\n${longLede}\n` })).toEqual([
      {
        ruleId: "lede-length",
        line: 3,
        column: 1,
        message:
          "Keep the lede at most 30 words (currently 31); it is the subtitle, so move supporting detail into the sections below",
      },
    ]);
  });

  it("should count words inside inline code and emphasis", () => {
    const words = Array.from({ length: 29 }, (_, i) => `word${i}`).join(" ");
    expect(
      lintPlan({ markdown: `# Title\n\n${words} \`code\` *emphasis*\n` }),
    ).toMatchObject([{ ruleId: "lede-length" }]);
  });

  it.each([
    [
      "a thirty-word lede",
      `# Title\n\n${Array.from({ length: 30 }, (_, i) => `word${i}`).join(" ")}\n`,
    ],
    [
      "a long second paragraph after a short lede",
      `# Title\n\nShort subtitle.\n\n${Array.from({ length: 40 }, (_, i) => `word${i}`).join(" ")}\n`,
    ],
    [
      "a component directly after the title",
      '# Title\n\n<Callout type="note">\n\nContext.\n\n</Callout>\n',
    ],
  ])("should not report %s", (_label, markdown) => {
    expect(lintPlan({ markdown })).toEqual([]);
  });
});

describe("lintPlan quick-summary-singleton", () => {
  it("should report each QuickSummary after the first", () => {
    expect(
      lintPlan({
        markdown:
          "# T\n\nLede.\n\n<QuickSummary>\n\n- A.\n\n</QuickSummary>\n\n## S\n\n<QuickSummary>\n\n- B.\n\n</QuickSummary>\n",
      }),
    ).toEqual([
      {
        ruleId: "quick-summary-singleton",
        line: 13,
        column: 1,
        message:
          "Only one QuickSummary is allowed; merge the key points into the first one",
      },
    ]);
  });

  it("should not report a single QuickSummary", () => {
    expect(
      lintPlan({
        markdown:
          "# T\n\nLede.\n\n<QuickSummary>\n\n- A.\n\n</QuickSummary>\n\n## S\n\nBody.\n",
      }),
    ).toEqual([]);
  });
});

describe("lintPlan verification-contract vocabulary", () => {
  it.each([
    ["Acceptance criteria", "# T\n\nLede.\n\n## Acceptance criteria\n"],
    ["Definition of done", "# T\n\nLede.\n\n## Definition of done\n"],
    ["Desired outcome", "# T\n\nLede.\n\n## Desired outcome\n"],
    ["Desired outcomes", "# T\n\nLede.\n\n### Desired Outcomes\n"],
  ])("should accept a section named %s", (_label, markdown) => {
    expect(lintPlan({ markdown })).toEqual([]);
  });
});

describe("lintPlan table-of-contents-matches-sections", () => {
  const plan = (overview: string): string =>
    `# T\n\nLede.\n\n${overview}\n## Status quo\n\nA.\n\n## The design\n\nB.\n`;

  it("should accept a TableOfContents whose entries repeat every section title in order", () => {
    expect(
      lintPlan({
        markdown: plan(
          '<TableOfContents>\n<Entry section="Status quo" gist="Today" />\n<Entry section="The design" gist="Tomorrow" />\n</TableOfContents>\n',
        ),
      }),
    ).toEqual([]);
  });

  it("should report a mismatched entry at the TableOfContents's position", () => {
    expect(
      lintPlan({
        markdown: plan(
          '<TableOfContents>\n<Entry section="Status quo" gist="Today" />\n<Entry section="Design" gist="Tomorrow" />\n</TableOfContents>\n',
        ),
      }),
    ).toEqual([
      {
        ruleId: "table-of-contents-matches-sections",
        line: 5,
        column: 1,
        message:
          'TableOfContents entry 2 says "Design" but section 2 is titled "The design"; list every section title exactly, in document order',
      },
    ]);
  });

  it("should report entries in the wrong order as pairwise mismatches", () => {
    const findings = lintPlan({
      markdown: plan(
        '<TableOfContents>\n<Entry section="The design" gist="Tomorrow" />\n<Entry section="Status quo" gist="Today" />\n</TableOfContents>\n',
      ),
    });
    expect(findings).toHaveLength(2);
    expect(findings[0]?.message).toContain(
      'TableOfContents entry 1 says "The design"',
    );
    expect(findings[1]?.message).toContain(
      'TableOfContents entry 2 says "Status quo"',
    );
  });

  it("should report a missing entry for an uncovered section", () => {
    expect(
      lintPlan({
        markdown: plan(
          '<TableOfContents>\n<Entry section="Status quo" gist="Today" />\n</TableOfContents>\n',
        ),
      }),
    ).toEqual([
      {
        ruleId: "table-of-contents-matches-sections",
        line: 5,
        column: 1,
        message:
          'TableOfContents is missing an entry for section 2 ("The design")',
      },
    ]);
  });

  it("should report an extra entry beyond the document's sections", () => {
    expect(
      lintPlan({
        markdown: plan(
          '<TableOfContents>\n<Entry section="Status quo" gist="Today" />\n<Entry section="The design" gist="Tomorrow" />\n<Entry section="Rollout" gist="Later" />\n</TableOfContents>\n',
        ),
      }),
    ).toEqual([
      {
        ruleId: "table-of-contents-matches-sections",
        line: 5,
        column: 1,
        message:
          'TableOfContents entry 3 ("Rollout") has no matching section; a TableOfContents lists exactly the document\'s sections',
      },
    ]);
  });

  it("should compare over text content when a section title carries inline code", () => {
    expect(
      lintPlan({
        markdown:
          '# T\n\nLede.\n\n<TableOfContents>\n<Entry section="The skill command" gist="Prints it" />\n</TableOfContents>\n## The `skill` command\n\nA.\n',
      }),
    ).toEqual([]);
  });

  it("should report nothing when the plan has no TableOfContents", () => {
    expect(
      lintPlan({ markdown: "# T\n\nLede.\n\n## Status quo\n\nA.\n" }),
    ).toEqual([]);
  });
});
