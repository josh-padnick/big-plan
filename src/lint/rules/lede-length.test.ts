// Exercises lede-length through the public lint interface.

import { describe, expect, it } from "vitest";
import { lintPlan } from "../lint-plan.js";

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
