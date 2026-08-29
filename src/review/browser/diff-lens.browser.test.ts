// Verifies overlap selection for browser diff presentations.

import { describe, expect, it } from "vitest";
import type { DiffLocation } from "../shared/review-wire.js";
import { presentationLocations } from "./diff-lens.browser.js";

const location = (overrides: Partial<DiffLocation>): DiffLocation => ({
  status: "changed",
  scope: "section",
  kind: "paragraph",
  isComponentRoot: false,
  label: "Change",
  section: "Section",
  oldText: "Before",
  newText: "After",
  runs: [],
  ...overrides,
});

describe("diff presentation overlap selection", () => {
  it("keeps a compiled component diff intact when owned fields accompany it", () => {
    const root = location({
      kind: "database-table-schema",
      isComponentRoot: true,
      oldBlockId: "section/schema-1",
      newBlockId: "section/schema-1",
      view: '<figure data-component-diff=""></figure>',
    });
    const field = location({
      kind: "database-table-schema-field",
      ownerId: "section/schema-1",
      label: "Column: state",
    });

    expect(presentationLocations([root, field])).toEqual([root]);
  });

  it("uses owned fields only when no compiled component view is available", () => {
    const root = location({
      kind: "fixture-card",
      isComponentRoot: true,
      oldBlockId: "section/card-1",
      newBlockId: "section/card-1",
    });
    const field = location({
      kind: "fixture-field",
      ownerId: "section/card-1",
      label: "Description",
    });

    expect(presentationLocations([root, field])).toEqual([field]);
  });
});
