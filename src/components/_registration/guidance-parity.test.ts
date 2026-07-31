// Guards the pact between the component registry and the embedded usage
// guidance: every authorable top-level component ships guidance, and no
// guidance file is orphaned from the registry.

import { describe, expect, it } from "vitest";
import { COMPONENT_GUIDANCE } from "../../cli/guidance/content.generated.js";
import { validateSlideTypeCatalog } from "../../plan-vocabulary/slide-types/catalog-validation.js";
import { SLIDE_TYPES } from "../../plan-vocabulary/slide-types/index.js";
import { REGISTERED_COMPONENT_NAMES } from "./registry.js";

describe("component usage guidance", () => {
  it("should exist for exactly the registered top-level components", () => {
    expect(Object.keys(COMPONENT_GUIDANCE).sort()).toEqual(
      [...REGISTERED_COMPONENT_NAMES].sort(),
    );
  });

  it("should open every file with a Using <Component> well heading", () => {
    for (const [name, guidance] of Object.entries(COMPONENT_GUIDANCE)) {
      expect(guidance.startsWith(`# Using ${name} well`)).toBe(true);
    }
  });

  it("should keep every slide type complete and paired only with registered components", () => {
    expect(
      validateSlideTypeCatalog({
        types: SLIDE_TYPES,
        componentNames: REGISTERED_COMPONENT_NAMES,
      }),
    ).toEqual([]);
  });
});
