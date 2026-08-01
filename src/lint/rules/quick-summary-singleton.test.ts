// Exercises quick-summary-singleton through the public lint interface.

import { describe, expect, it } from "vitest";
import { lintPlan } from "../lint-plan.js";

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
