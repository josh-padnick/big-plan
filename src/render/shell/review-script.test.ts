// The embedded review runtime is the final browser-delivery boundary, so
// forbidden diff chrome is asserted against the generated script itself.

import { describe, expect, it } from "vitest";
import { REVIEW_SCRIPT_BODY } from "./review-script.generated.js";

describe("embedded review script", () => {
  it("should never render a your-comment tag inside a diff", () => {
    expect(REVIEW_SCRIPT_BODY).not.toContain("data-review-diff-comment-tag");
  });
});
