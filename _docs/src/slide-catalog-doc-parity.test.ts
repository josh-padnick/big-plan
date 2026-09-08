// Keeps the two hand-authored slide-type surfaces aligned with the executable
// catalog: the Slide component's id-and-name table, and the catalog table on
// the For agents page, which is where an agent is told what it may author.
// Both drift silently otherwise, because a new type is a new file under
// src/plan-vocabulary/slide-types/definitions/ and nothing else fails when
// the docs miss it.

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

  it("should list every catalog type where agents are told to author", () => {
    const reference = readFileSync(
      new URL("./content/docs/for-agents/index.md", import.meta.url),
      "utf8",
    );
    const catalogSection =
      reference.split("## Slide types\n")[1]?.split("\n## ")[0] ?? "";
    const documentedIds = [
      ...catalogSection.matchAll(/^\| `([a-z-]+)`\s+\|/gm),
    ].map(([, id]) => id);

    expect(documentedIds).toEqual(SLIDE_TYPES.map(({ id }) => id));
  });
});
