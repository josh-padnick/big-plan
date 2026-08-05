// Keeps the hand-authored Slide reference table aligned with the executable
// slide-type catalog.

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { SLIDE_TYPES } from "../../src/plan-vocabulary/slide-types/index.js";

describe("Slide catalog documentation", () => {
  it("should list every catalog id and name", () => {
    const reference = readFileSync(
      new URL("./content/docs/components/slide.mdx", import.meta.url),
      "utf8",
    );
    const catalogSection =
      reference.split("## The catalog\n")[1]?.split("\n## ")[0] ?? "";
    const documentedTypes = [
      ...catalogSection.matchAll(/^\| `([^`]+)`\s+\| ([^|]+?)\s+\|/gm),
    ].map(([, id, name]) => ({ id, name }));

    expect(documentedTypes).toEqual(
      SLIDE_TYPES.map(({ id, name }) => ({ id, name })),
    );
  });
});
