// Exercises the acceptance-criteria grouping contract at its seven-item limit.

import { describe, expect, it } from "vitest";
import { lintPlan } from "../lint-plan.js";

describe("lintPlan acceptance-criteria-grouping", () => {
  it("should require grouping when a typed contract has more than seven criteria", () => {
    const criteria = Array.from(
      { length: 8 },
      (_, index) => `- Criterion ${index + 1}`,
    );
    expect(
      lintPlan({
        markdown: `<Slide type="acceptance-criteria" />\n\n## Acceptance criteria\n\nThese checks prove the work is complete.\n\n${criteria.join("\n")}\n`,
      }),
    ).toContainEqual({
      ruleId: "acceptance-criteria-grouping",
      line: 3,
      column: 1,
      message:
        "Group all 8 acceptance criteria by a dimension that helps the reviewer judge them; more than seven criteria must not stay flat",
    });
  });

  it("should allow more than seven criteria in grouped lists", () => {
    const criteria = [
      "- **Experience** - what the user can do.\n  - The first experience works.\n  - The second experience works.",
      "- **Recovery** - what happens after failure.\n  - A failure is visible.\n  - Recovery is possible.",
      "- **Evidence** - what the reviewer can check.\n  - The result is recorded.\n  - The boundary is tested.",
      "- **Operations** - what owners can observe.\n  - The event is logged.",
    ];
    expect(
      lintPlan({
        markdown: `<Slide type="acceptance-criteria" />\n\n## Acceptance criteria\n\nThese checks prove the work is complete.\n\n${criteria.join("\n")}\n`,
      }).filter(({ ruleId }) => ruleId === "acceptance-criteria-grouping"),
    ).toEqual([]);
  });
});
