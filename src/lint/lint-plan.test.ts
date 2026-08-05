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

describe("lintPlan wireframe-product-copy", () => {
  it("should report process notes inside wireframe attributes", () => {
    expect(
      lintPlan({
        markdown: `<Wireframe id="desk">
  <Screen id="home" name="Home" device="desktop">
    <Text text="Sticky header · Cmd+K search" />
    <Text text="Remembered width · J/K move" />
  </Screen>
</Wireframe>
`,
      }),
    ).toMatchObject([
      {
        ruleId: "wireframe-product-copy",
        line: 3,
        message:
          'Move process note "sticky", "Cmd+K" outside the Wireframe; artboard attributes contain only product UI copy its intended user sees',
      },
      {
        ruleId: "wireframe-product-copy",
        line: 4,
        message:
          'Move process note "remembered", "J/K" outside the Wireframe; artboard attributes contain only product UI copy its intended user sees',
      },
    ]);
  });

  it("should keep process discussion outside the artboard and product copy inside it", () => {
    expect(
      lintPlan({
        markdown: `The implementation keeps the header sticky and remembers pane width.

<Wireframe id="desk">
  <Screen id="home" name="Home" device="desktop">
    <Text text="Search tickets" />
  </Screen>
</Wireframe>
`,
      }),
    ).toEqual([]);
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
          "# T\n\nLede.\n\n<QuickSummary>\n\n- A.\n\n</QuickSummary>\n\n## S\n\nBody.\n\n<QuickSummary>\n\n- B.\n\n</QuickSummary>\n",
      }),
    ).toEqual([
      {
        ruleId: "quick-summary-singleton",
        line: 15,
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

describe("lintPlan slide-type-structure", () => {
  it("should reject a duplicate singleton type at the second marker", () => {
    expect(
      lintPlan({
        markdown:
          '<Slide type="status-quo" />\n\n## Today\n\nA.\n\n<Slide type="status-quo" />\n\n## The inherited constraint\n\nB.\n',
      }),
    ).toEqual([
      {
        ruleId: "slide-type-structure",
        line: 7,
        column: 1,
        message: "Use at most one Status quo slide in a plan",
      },
    ]);
  });

  it("should reject using both outcome types", () => {
    expect(
      lintPlan({
        markdown:
          '<Slide type="desired-experience" />\n\n## Reviewers leave feedback in place\n\nA.\n\n<Slide type="desired-outcome" />\n\n## Review state survives regeneration\n\nB.\n',
      }),
    ).toEqual([
      {
        ruleId: "slide-type-structure",
        line: 7,
        column: 1,
        message:
          "Use either Desired experience for a new feature or Desired outcome for other work, not both",
      },
    ]);
  });

  it("should require Acceptance criteria to be the last typed slide", () => {
    expect(
      lintPlan({
        markdown:
          '<Slide type="acceptance-criteria" />\n\n## The change has checkable proof\n\nA.\n\n<Slide type="user-journey" name="Accepting the plan" toc="Accept" />\n\n## A reviewer accepts the plan\n\nB.\n\n<Wireframe id="accept"><Screen id="review" name="Review" device="desktop" /></Wireframe>\n',
      }),
    ).toEqual([
      {
        ruleId: "slide-type-structure",
        line: 1,
        column: 1,
        message: "Acceptance criteria must be the last typed slide in the plan",
      },
    ]);
  });

  it("should allow repeated User journeys with distinct names and canonical Success looks like", () => {
    expect(
      lintPlan({
        markdown:
          '## Success looks like\n\nA.\n\n<Slide type="user-journey" name="Opening the plan" toc="Open" />\n\n## A reviewer opens the plan\n\nB.\n\n<Wireframe id="open"><Screen id="plan" name="Plan" device="desktop" /></Wireframe>\n\n<Slide type="user-journey" name="Accepting the plan" toc="Accept" />\n\n## A reviewer accepts the plan\n\nC.\n\n<Wireframe id="accept"><Screen id="review" name="Review" device="desktop" /></Wireframe>\n',
      }),
    ).toEqual([]);
  });

  it("should require actual UI mockups on every User journeys slide", () => {
    expect(
      lintPlan({
        markdown:
          '<Slide type="user-journey" name="Reviewing the plan" toc="Review" />\n\n## A reviewer opens the plan\n\nProse alone.\n',
      }),
    ).toEqual([
      {
        ruleId: "slide-type-structure",
        line: 1,
        column: 1,
        message:
          'User journeys slide "Reviewing the plan" must contain a Wireframe with actual UI mockups',
      },
    ]);
  });

  it("should reject repeated journey names and TOC forms", () => {
    expect(
      lintPlan({
        markdown:
          '<Slide type="user-journey" name="Reviewing the plan" toc="Review" />\n\n## An agent reviews the plan\n\nA.\n\n<Wireframe id="agent"><Screen id="review" name="Review" device="desktop" /></Wireframe>\n\n<Slide type="user-journey" name="Reviewing the plan" toc="Review" />\n\n## A captain reviews the plan\n\nB.\n\n<Wireframe id="captain"><Screen id="review" name="Review" device="desktop" /></Wireframe>\n',
      }),
    ).toEqual([
      {
        ruleId: "slide-type-structure",
        line: 9,
        column: 1,
        message:
          'Give every journey in User journeys a distinct name; "Reviewing the plan" is repeated',
      },
      {
        ruleId: "slide-type-structure",
        line: 9,
        column: 1,
        message:
          'Give every journey in User journeys a distinct table-of-contents form; "Review" is repeated',
      },
    ]);
  });

  it("should leave plain-language title judgment to guidance", () => {
    expect(
      lintPlan({
        markdown:
          '<Slide type="status-quo" />\n\n## The ultimate revolutionary architecture\n\nA.\n',
      }),
    ).toEqual([]);
  });
});

describe("lintPlan table-of-contents-matches-sections", () => {
  const plan = (overview: string): string =>
    `# T\n\nLede.\n\n${overview}\n## Status quo\n\nA.\n\n## The design\n\nB.\n`;

  it("should accept a TableOfContents whose entries repeat every section name in order", () => {
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
          'TableOfContents entry 2 says "Design" but section 2 is named "The design"; list every section name exactly, in document order',
      },
    ]);
  });

  it("should compare a typed slide against its catalog name rather than its h2 title", () => {
    expect(
      lintPlan({
        markdown:
          '# T\n\nLede.\n\n<TableOfContents>\n<Entry section="Status quo" gist="Today" />\n</TableOfContents>\n\n<Slide type="status-quo" />\n\n## Inline retries delay checkout\n\nA.\n',
      }),
    ).toEqual([]);
  });

  it("should compare a user journey against its ultra-concise TOC form", () => {
    expect(
      lintPlan({
        markdown:
          '# T\n\nLede.\n\n<TableOfContents>\n<Entry section="Draft status" gist="One journey" />\n</TableOfContents>\n\n<Slide type="user-journey" name="Drafting a status slide" toc="Draft status" />\n\n## An agent turns evidence into a status slide\n\nA.\n\n<Wireframe id="draft"><Screen id="evidence" name="Evidence" device="desktop" /></Wireframe>\n',
      }),
    ).toEqual([]);
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

describe("lintPlan slide-leading-title", () => {
  it("should report a sub-slide whose first block is a component", () => {
    expect(
      lintPlan({
        markdown:
          '# T\n\nLede.\n\n## Delivery\n\nProse.\n\n### Retiring the route\n\n<Callout type="warning" title="Deprecation">\n\nGone next release.\n\n</Callout>\n',
      }),
    ).toEqual([
      {
        ruleId: "slide-leading-title",
        line: 11,
        column: 1,
        message:
          "Title this sub-slide above the figure: its h3 renders as a small kicker, so add an h4 line stating the message this figure shows",
      },
    ]);
  });

  it("should report a slide whose first block is a fenced code block", () => {
    expect(
      lintPlan({
        markdown: "# T\n\nLede.\n\n## SQL\n\n```sql\nSELECT 1;\n```\n",
      }),
    ).toEqual([
      {
        ruleId: "slide-leading-title",
        line: 7,
        column: 1,
        message:
          "Say what this figure shows before showing it: lead the slide with a title line or a context builder, not the figure",
      },
    ]);
  });

  it("should report a slide whose first block is a table", () => {
    expect(
      lintPlan({
        markdown:
          "# T\n\nLede.\n\n## Failure classes\n\n| Code | Retry |\n| --- | --- |\n| 429 | yes |\n",
      }).map(({ ruleId, line }) => ({ ruleId, line })),
    ).toEqual([{ ruleId: "slide-leading-title", line: 7 }]);
  });

  it("should report a slide whose first block is a standalone image", () => {
    expect(
      lintPlan({
        markdown: "# T\n\nLede.\n\n## The pipeline\n\n![Pipeline](p.png)\n",
      }).map(({ ruleId, line }) => ({ ruleId, line })),
    ).toEqual([{ ruleId: "slide-leading-title", line: 7 }]);
  });

  it("should report a slide whose first block is a reference-style image", () => {
    expect(
      lintPlan({
        markdown:
          "# T\n\nLede.\n\n## The pipeline\n\n![Pipeline][pipeline]\n\n[pipeline]: p.png\n",
      }).map(({ ruleId, line }) => ({ ruleId, line })),
    ).toEqual([{ ruleId: "slide-leading-title", line: 7 }]);
  });

  it("should report a slide whose first block is a linked image", () => {
    expect(
      lintPlan({
        markdown:
          "# T\n\nLede.\n\n## The pipeline\n\n[![Pipeline](p.png)](p.png)\n",
      }).map(({ ruleId, line }) => ({ ruleId, line })),
    ).toEqual([{ ruleId: "slide-leading-title", line: 7 }]);
  });

  it("should report a slide whose first block is a reference-linked image", () => {
    expect(
      lintPlan({
        markdown:
          "# T\n\nLede.\n\n## The pipeline\n\n[![Pipeline][pipeline]][detail]\n\n[pipeline]: p.png\n[detail]: pipeline.md\n",
      }).map(({ ruleId, line }) => ({ ruleId, line })),
    ).toEqual([{ ruleId: "slide-leading-title", line: 7 }]);
  });

  it("should accept a sub-slide that titles the figure with an h4 first", () => {
    expect(
      lintPlan({
        markdown:
          "# T\n\nLede.\n\n## Delivery\n\nProse.\n\n### End to end\n\n#### One save touches only what changed\n\n<FlowDiagram>\n\nBody.\n\n</FlowDiagram>\n",
      }),
    ).toEqual([]);
  });

  it("should accept a slide that leads with a context builder before the figure", () => {
    expect(
      lintPlan({
        markdown:
          "# T\n\nLede.\n\n## SQL\n\n*A join, so every token colour appears at once.*\n\n```sql\nSELECT 1;\n```\n",
      }),
    ).toEqual([]);
  });

  it("should accept a slide whose figure follows ordinary prose", () => {
    expect(
      lintPlan({
        markdown:
          "# T\n\nLede.\n\n## The pipeline\n\nThe authored file is the only hand-edited copy.\n\n<FlowDiagram>\n\nBody.\n\n</FlowDiagram>\n",
      }),
    ).toEqual([]);
  });

  it("should accept an image used inside a sentence rather than as a figure", () => {
    expect(
      lintPlan({
        markdown: "# T\n\nLede.\n\n## Badges\n\nStatus ![ok](o.png) today.\n",
      }),
    ).toEqual([]);
  });

  it("should accept a text link used as prose", () => {
    expect(
      lintPlan({
        markdown:
          "# T\n\nLede.\n\n## The pipeline\n\n[Read the pipeline guide](pipeline.md).\n",
      }),
    ).toEqual([]);
  });

  it("should leave a section that immediately opens its sub-slides alone", () => {
    expect(
      lintPlan({
        markdown:
          "# T\n\nLede.\n\n## Delivery\n\n### First\n\n#### Titled\n\nProse.\n",
      }),
    ).toEqual([]);
  });
});

describe("lintPlan subtitle-duplication", () => {
  it("should report a figure label repeating its slide heading", () => {
    expect(
      lintPlan({
        markdown:
          '# T\n\nLede.\n\n## Open questions\n\nThree calls remain.\n\n<SimpleDecisionSet title="Open questions">\n\nBody.\n\n</SimpleDecisionSet>\n',
      }),
    ).toEqual([
      {
        ruleId: "subtitle-duplication",
        line: 9,
        column: 1,
        message:
          'Drop this figure\'s title or name what the figure shows: it repeats the heading "Open questions"',
      },
    ]);
  });

  it("should report a context builder repeating its slide heading", () => {
    expect(
      lintPlan({
        markdown:
          "# T\n\nLede.\n\n## Quality criteria\n\n*The quality criteria.*\n\nProse.\n",
      }),
    ).toEqual([
      {
        ruleId: "subtitle-duplication",
        line: 7,
        column: 1,
        message:
          'Drop this context builder or make it add something: it repeats the heading "Quality criteria"',
      },
    ]);
  });

  it("should report a reordered restatement of the heading", () => {
    expect(
      lintPlan({
        markdown:
          "# T\n\nLede.\n\n## Retry queue\n\n*Queue retry.*\n\nProse.\n",
      }).map(({ ruleId }) => ruleId),
    ).toEqual(["subtitle-duplication"]);
  });

  it("should ignore a leading article when comparing", () => {
    expect(
      lintPlan({
        markdown:
          "# T\n\nLede.\n\n## The retry queue\n\n*Retry queue.*\n\nProse.\n",
      }).map(({ ruleId }) => ruleId),
    ).toEqual(["subtitle-duplication"]);
  });

  it("should report identical non-Latin heading and component titles", () => {
    expect(
      lintPlan({
        markdown:
          '# T\n\nLede.\n\n## Очередь повторов\n\nProse.\n\n<FlowDiagram title="Очередь повторов">\n\nBody.\n\n</FlowDiagram>\n',
      }).map(({ ruleId }) => ruleId),
    ).toEqual(["subtitle-duplication"]);
  });

  it("should accept a context builder that adds information", () => {
    expect(
      lintPlan({
        markdown:
          "# T\n\nLede.\n\n## Quality criteria\n\n*How we judge the index once it ships.*\n\nProse.\n",
      }),
    ).toEqual([]);
  });

  it("should accept a figure label naming something other than the heading", () => {
    expect(
      lintPlan({
        markdown:
          '# T\n\nLede.\n\n## Settling the last calls\n\nThree remain.\n\n<SimpleDecisionSet title="Open questions">\n\nBody.\n\n</SimpleDecisionSet>\n',
      }),
    ).toEqual([]);
  });

  it("should accept a heading whose words merely appear inside a longer label", () => {
    expect(
      lintPlan({
        markdown:
          '# T\n\nLede.\n\n## Pan\n\nProse.\n\n<FlowDiagram title="Drag, scroll, or pan the artboard around at any zoom">\n\nBody.\n\n</FlowDiagram>\n',
      }),
    ).toEqual([]);
  });

  it("should leave a Part marker's act name alone", () => {
    expect(
      lintPlan({
        markdown:
          '# T\n\nLede.\n\n## Context\n\nProse.\n\n<Part title="Context" />\n\n## Next\n\nProse.\n',
      }),
    ).toEqual([]);
  });

  it("should compare only a leading emphasized paragraph, not a later aside", () => {
    expect(
      lintPlan({
        markdown:
          "# T\n\nLede.\n\n## Quality criteria\n\nProse.\n\n*The quality criteria.*\n",
      }),
    ).toEqual([]);
  });
});

describe("lintPlan collection-grouping", () => {
  it("should report a flat list past eight items with its count", () => {
    const items = Array.from(
      { length: 9 },
      (_, index) => `- Item ${index + 1}`,
    );

    expect(
      lintPlan({
        markdown: `# T\n\nLede.\n\n## Acceptance criteria\n\n${items.join("\n")}\n`,
      }),
    ).toEqual([
      {
        ruleId: "collection-grouping",
        line: 7,
        column: 1,
        message:
          "Group this 9-item list by a dimension that helps the reviewer judge - importance, lifecycle stage, owner, audience - using a bulleted legend over nested items, or split it into shorter labelled lists",
      },
    ]);
  });

  it("should report a flat table past eight rows with its count", () => {
    const rows = Array.from(
      { length: 9 },
      (_, index) => `| Criterion ${index + 1} | Pass ${index + 1} |`,
    );

    expect(
      lintPlan({
        markdown: `# T\n\nLede.\n\n## Quality criteria\n\nProse.\n\n| Criterion | Pass |\n| --- | --- |\n${rows.join("\n")}\n`,
      }),
    ).toEqual([
      {
        ruleId: "collection-grouping",
        line: 9,
        column: 1,
        message:
          "Group this 9-row table by a dimension that helps the reviewer judge - importance, lifecycle stage, owner, audience - and make that dimension the first column so rows sharing a group sit together",
      },
    ]);
  });

  it("should accept a table grouped by a repeating first column", () => {
    const rows = [
      ...Array.from({ length: 5 }, (_, i) => `| Correctness | C${i} | P${i} |`),
      ...Array.from({ length: 4 }, (_, i) => `| Experience | E${i} | P${i} |`),
    ];

    expect(
      lintPlan({
        markdown: `# T\n\nLede.\n\n## Quality criteria\n\nProse.\n\n| Group | Criterion | Pass |\n| --- | --- | --- |\n${rows.join("\n")}\n`,
      }),
    ).toEqual([]);
  });

  it("should accept a long list grouped under nested items", () => {
    const groups = ["Essential", "Experience", "Operability"].map(
      (name) =>
        `- **${name}** - what breaking one costs.\n${Array.from(
          { length: 3 },
          (_, i) => `  - ${name} item ${i + 1}`,
        ).join("\n")}`,
    );

    expect(
      lintPlan({
        markdown: `# T\n\nLede.\n\n## Quality criteria\n\nProse.\n\n${groups.join("\n")}\n`,
      }),
    ).toEqual([]);
  });

  it("should accept a list at the eight-item threshold", () => {
    const items = Array.from(
      { length: 8 },
      (_, index) => `- Item ${index + 1}`,
    );

    expect(
      lintPlan({
        markdown: `# T\n\nLede.\n\n## Acceptance criteria\n\n${items.join("\n")}\n`,
      }),
    ).toEqual([]);
  });

  it("should inspect a long collection nested inside a component body", () => {
    const items = Array.from(
      { length: 9 },
      (_, index) => `- Item ${index + 1}`,
    );

    expect(
      lintPlan({
        markdown: `# T\n\nLede.\n\n## Notes\n\nProse.\n\n<Callout type="note" title="Everything to check">\n\n${items.join("\n")}\n\n</Callout>\n`,
      }).map(({ ruleId }) => ruleId),
    ).toEqual(["collection-grouping"]);
  });
});
