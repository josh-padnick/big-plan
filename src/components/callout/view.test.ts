// Verifies the React Callout port standalone: the semantic panel, default
// titles, the Lucide data hook, and prose body conversion.

import { describe, expect, it } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { CompiledCallout } from "./compile.js";
import { Callout } from "./view.js";

const renderCallout = (model: CompiledCallout): string =>
  renderToStaticMarkup(createElement(Callout, { model }));

describe("Callout", () => {
  it("should render the panel with the default title when none is authored", () => {
    const html = renderCallout({
      type: "warning",
      body: [
        {
          type: "element",
          tagName: "p",
          properties: {},
          children: [{ type: "text", value: "Careful." }],
        },
      ],
    });
    expect(html).toContain('data-callout="warning"');
    expect(html).toContain(">Warning</span>");
    expect(html).toContain("<p>Careful.</p>");
    expect(html).toContain('data-lucide="triangle-alert"');
  });

  it("should prefer the authored title when one is given", () => {
    const html = renderCallout({
      type: "tip",
      title: "Try it",
      body: [],
    });
    expect(html).toContain(">Try it</span>");
    expect(html).toContain('data-lucide="lightbulb"');
  });
});
