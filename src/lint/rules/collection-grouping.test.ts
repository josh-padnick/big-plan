// Exercises collection-grouping through the public lint interface.

import { describe, expect, it } from "vitest";
import { lintPlan } from "../lint-plan.js";

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
