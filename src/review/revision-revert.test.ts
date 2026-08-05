// Verifies that local revision reversal removes only the owned pair.

import { describe, expect, it } from "vitest";
import { revertRevisionPair } from "./revision-revert.js";

describe("revertRevisionPair", () => {
  it("should reverse multiple owned hunks while preserving later edits", () => {
    const before = ["# Plan", "", "Alpha", "", "Beta", ""].join("\n");
    const after = ["# Plan", "", "Alpha revised", "", "Beta revised", ""].join(
      "\n",
    );
    const current = [
      "# Plan",
      "",
      "Alpha revised",
      "",
      "Beta revised",
      "",
      "Later unrelated note",
      "",
    ].join("\n");

    expect(revertRevisionPair({ before, after, current })).toBe(
      ["# Plan", "", "Alpha", "", "Beta", "", "Later unrelated note", ""].join(
        "\n",
      ),
    );
  });

  it("should preserve a later extension to the same source line", () => {
    expect(
      revertRevisionPair({
        before: "Alpha\n",
        after: "Alpha revised\n",
        current: "Alpha revised again\n",
      }),
    ).toBe("Alpha again\n");
  });

  it("should use the immutable line position when a later revision replaced the owned text", () => {
    const before = [
      "| Field | Meaning |",
      "| --- | --- |",
      "| versionId | Content hash |",
      "| number | Position |",
      "",
    ].join("\n");
    const after = before.replace(
      "| versionId | Content hash |",
      "| versionId | Stable content hash |",
    );
    const current = after.replace(
      "| versionId | Stable content hash |",
      "| versionId | Encryption boundary |",
    );

    expect(revertRevisionPair({ before, after, current })).toBe(before);
  });
});
