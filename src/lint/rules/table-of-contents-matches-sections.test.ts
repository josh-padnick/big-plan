// Exercises table-of-contents-matches-sections through the public lint interface.

import { describe, expect, it } from "vitest";
import { lintPlan } from "../lint-plan.js";

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
          'TableOfContents entry 2 says "Design" but section 2 is named "The design"; list every section name exactly, in document order',
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
