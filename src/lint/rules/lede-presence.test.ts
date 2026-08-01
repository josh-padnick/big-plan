// Exercises lede-presence through the public lint interface.

import { describe, expect, it } from "vitest";
import { lintPlan } from "../lint-plan.js";

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
