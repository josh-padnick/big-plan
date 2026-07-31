// Tests that the self-contained viewer enhancement remains valid JavaScript
// when pure DataTable behavior is embedded into it.

import { describe, expect, it } from "vitest";
import { VIEWER_SCRIPT } from "./viewer-script.js";

describe("VIEWER_SCRIPT", () => {
  it("should embed a syntactically valid DataTable comparator", () => {
    const source = VIEWER_SCRIPT.replace(/^<script>/, "").replace(
      /<\/script>$/,
      "",
    );

    expect(() => Function(source)).not.toThrow();
    expect(source).toContain("const compareDataTableValues =");
    expect(source).toContain('normalized === "" ? Number.NaN');
  });
});
