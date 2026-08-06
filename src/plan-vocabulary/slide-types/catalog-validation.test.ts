// Exercises the catalog completeness contract against representative valid
// and invalid additions.

import { describe, expect, it } from "vitest";
import { validateSlideTypeCatalog } from "./catalog-validation.js";
import { STATUS_QUO_SLIDE_TYPE } from "./definitions/status-quo.js";
import type { SlideTypeDefinition } from "./types.js";

const COMPONENTS = new Set(["CodeSnippet", "FileTree"]);

const validate = (
  types: ReadonlyArray<SlideTypeDefinition>,
): ReadonlyArray<string> =>
  validateSlideTypeCatalog({ types, componentNames: COMPONENTS }).map(
    ({ message }) => message,
  );

describe("validateSlideTypeCatalog", () => {
  it("should accept a complete sentence-case type", () => {
    expect(validate([STATUS_QUO_SLIDE_TYPE])).toEqual([]);
  });

  it("should report duplicate ids and names", () => {
    expect(
      validate([STATUS_QUO_SLIDE_TYPE, STATUS_QUO_SLIDE_TYPE]),
    ).toMatchObject([
      'Duplicate slide type id "status-quo"',
      'Duplicate slide type name "Status quo"',
    ]);
  });

  it("should report a non-sentence-case name", () => {
    expect(
      validate([{ ...STATUS_QUO_SLIDE_TYPE, name: "Status Quo" }]),
    ).toContain('Slide type name "Status Quo" must use sentence case');
  });

  it("should report missing authoring and component guidance", () => {
    expect(
      validate([
        {
          ...STATUS_QUO_SLIDE_TYPE,
          match: { when: "", notWhen: "" },
          guidance: [],
          components: [],
        },
      ]),
    ).toEqual([
      'Slide type "status-quo" needs matching boundaries and non-empty authoring guidance',
      'Slide type "status-quo" needs component-pairing guidance',
    ]);
  });

  it("should report unknown component pairings", () => {
    expect(
      validate([
        {
          ...STATUS_QUO_SLIDE_TYPE,
          components: [{ name: "Unknown", guidance: "Show it." }],
        },
      ]),
    ).toEqual([
      'Slide type "status-quo" has invalid component guidance for "Unknown"',
    ]);
  });
});
