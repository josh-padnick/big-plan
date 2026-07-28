// Verifies the single React-to-HAST boundary's property normalization and
// single-root contract independently of product components.

import { createElement, Fragment } from "react";
import { describe, expect, it } from "vitest";
import { reactToHast } from "./react-hast-adapter.js";

describe("reactToHast", () => {
  it("should normalize hidden and data attributes across an SVG subtree", () => {
    const element = reactToHast(
      createElement(
        "svg",
        { hidden: true, "data-lucide": "check" },
        createElement("path", { "data-line-kind": "stroke" }),
      ),
    );

    expect(element?.properties).toMatchObject({
      hidden: true,
      "data-lucide": "check",
    });
    expect(element?.children[0]).toMatchObject({
      type: "element",
      properties: { "data-line-kind": "stroke" },
    });
  });

  it("should reject a presentation without exactly one root element", () => {
    expect(reactToHast("plain text")).toBeUndefined();
    expect(
      reactToHast(
        createElement(
          Fragment,
          null,
          createElement("span"),
          createElement("span"),
        ),
      ),
    ).toBeUndefined();
  });
});
