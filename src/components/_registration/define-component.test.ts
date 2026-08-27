// Proves every component definition receives the free diff contract and a
// bespoke compiler and view can replace that default without registration.

import { createElement } from "react";
import type { Element, Root } from "hast";
import { describe, expect, it } from "vitest";
import { reactToHast } from "../../render/markdown/component-pipeline/react-hast-adapter.js";
import { defineComponent, defineOutlineComponent } from "./define-component.js";

const EMPTY_OUTLINES = {
  baseline: { parts: [], sections: [] },
  proposed: { parts: [], sections: [] },
};

const elements = (node: Root | Element): ReadonlyArray<Element> =>
  node.children.flatMap((child) =>
    child.type === "element" ? [child, ...elements(child)] : [],
  );

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
    const root = reactToHast(compiled.presentation("example", EMPTY_OUTLINES));

    expect(compiled.model).toEqual(input);
    expect(root?.properties["data-component-diff"]).toBe("");
  });

  it("should isolate controls across separately rendered default diffs", () => {
    const compiled = definition.compileDiff({
      status: "changed",
      baseline: { label: "Was" },
      proposed: { label: "Now" },
      runs: [],
    });
    const first = reactToHast(compiled.presentation("first", EMPTY_OUTLINES));
    const second = reactToHast(compiled.presentation("second", EMPTY_OUTLINES));
    const firstInput =
      first === undefined
        ? undefined
        : elements(first).find((element) => element.tagName === "input");
    const secondInput =
      second === undefined
        ? undefined
        : elements(second).find((element) => element.tagName === "input");

    expect(firstInput?.properties.id).not.toBe(secondInput?.properties.id);
    expect(firstInput?.properties.name).not.toBe(secondInput?.properties.name);
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
      reactToHast(compiled.presentation("example", EMPTY_OUTLINES))?.properties[
        "data-bespoke"
      ],
    ).toBe("");
  });

  it("should render an outline component diff with each document's outline", () => {
    const outlined = defineOutlineComponent({
      compile: () => ({ label: "compiled" }),
      view: ({ model, outline }) =>
        createElement(
          "div",
          {
            "data-outline-parts": outline.parts.length,
            "data-outline-sections": outline.sections.length,
          },
          model.label,
        ),
      marker: () => ({ kind: "boundary" }),
    });
    const compiled = outlined.compileDiff({
      status: "changed",
      baseline: { label: "Was" },
      proposed: { label: "Now" },
      runs: [],
    });
    const root = reactToHast(
      compiled.presentation("example", {
        baseline: {
          parts: [{ number: 1, title: "Was", id: "part-was" }],
          sections: [],
        },
        proposed: {
          parts: [
            { number: 1, title: "First", id: "part-first" },
            { number: 2, title: "Now", id: "part-now" },
          ],
          sections: [],
        },
      }),
    );

    const outlinedSides =
      root === undefined
        ? []
        : elements(root).filter(
            (element) => element.properties["data-outline-parts"] !== undefined,
          );
    expect(
      outlinedSides.map((side) => side.properties["data-outline-parts"]),
    ).toEqual(["1", "2"]);
  });
});
