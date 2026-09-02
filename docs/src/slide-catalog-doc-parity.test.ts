// Keeps the two hand-authored slide-type surfaces aligned with the executable
// catalog: the Slide component's id-and-name table, and the authoring
// section's per-type reference. Both drift silently otherwise, because a new
// type is a new file under src/plan-vocabulary/slide-types/definitions/ and
// nothing else fails when the docs miss it.

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

  it("should give every catalog type its own authoring reference", () => {
    const reference = readFileSync(
      new URL("./content/docs/authoring/slide-types.md", import.meta.url),
      "utf8",
    );
    const catalogSection =
      reference.split("## The catalog\n")[1]?.split("\n## ")[0] ?? "";
    const documentedNames = [
      ...catalogSection.matchAll(/^### (.+)$/gm),
    ].map(([, name]) => name);

    expect(documentedNames).toEqual(SLIDE_TYPES.map(({ name }) => name));

    for (const { id } of SLIDE_TYPES) {
      expect(catalogSection).toContain(`type="${id}"`);
    }
  });
});
