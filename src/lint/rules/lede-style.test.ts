// Exercises lede-style through the public lint interface.

import { describe, expect, it } from "vitest";
import { lintPlan } from "../lint-plan.js";

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
