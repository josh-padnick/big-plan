// Exercises title-length through the public lint interface.

import { describe, expect, it } from "vitest";
import { lintPlan } from "../lint-plan.js";

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
