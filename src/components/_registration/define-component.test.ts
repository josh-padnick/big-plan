// Proves every component definition receives the free diff contract and a
// bespoke compiler and view can replace that default without registration.

import { createElement } from "react";
import { describe, expect, it } from "vitest";
import { reactToHast } from "../../render/markdown/component-pipeline/react-hast-adapter.js";
import { defineComponent } from "./define-component.js";

const definition = defineComponent({
  compile: () => ({ label: "compiled" }),
  view: ({ model }: { readonly model: { readonly label: string } }) =>
    createElement("div", { "data-label": model.label }, model.label),
});

describe("component diff definition", () => {
  it.each([
    {
      status: "added" as const,
      proposed: { label: "Now" },
      runs: [],
    },
    {
      status: "removed" as const,
      baseline: { label: "Was" },
      runs: [],
    },
    {
      status: "changed" as const,
      baseline: { label: "Was" },
      proposed: { label: "Now" },
      runs: [],
    },
  ])("should render the free default for a $status component", (input) => {
    const compiled = definition.compileDiff(input);
    const root = reactToHast(compiled.presentation());

    expect(compiled.model).toEqual(input);
    expect(root?.properties["data-component-diff"]).toBe("");
  });

  it("should use a bespoke diff compiler and view when supplied", () => {
    const bespoke = defineComponent({
      compile: () => ({ label: "compiled" }),
      view: ({ model }: { readonly model: { readonly label: string } }) =>
        createElement("div", null, model.label),
      diff: (input) => ({ label: input.status }),
      diffView: ({ model }) =>
        createElement("aside", { "data-bespoke": "" }, model.label),
    });
    const compiled = bespoke.compileDiff({
      status: "added",
      proposed: { label: "Now" },
      runs: [],
    });

    expect(compiled.model).toEqual({ label: "added" });
    expect(
      reactToHast(compiled.presentation())?.properties["data-bespoke"],
    ).toBe("");
  });
});
