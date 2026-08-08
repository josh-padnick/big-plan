// Tests MermaidDiagram compilation boundaries independently from browser rendering.

import type { ElementContent } from "hast";
import { describe, expect, it } from "vitest";
import { createDiagnosticCollector } from "../_authoring/diagnostics.js";
import { compileMermaidDiagramComponent } from "./compile.js";

const fence = (source: string): ElementContent => ({
  type: "element",
  tagName: "pre",
  properties: {},
  children: [
    {
      type: "element",
      tagName: "code",
      properties: { className: ["language-mermaid"] },
      children: [{ type: "text", value: source }],
    },
  ],
});

describe("compileMermaidDiagramComponent", () => {
  it("should preserve a rewrite failure behind a sanitized internal error", () => {
    const source = "flowchart LR\n  source[Source] --> result[Result]";
    const diagnostics = createDiagnosticCollector();
    let thrown: unknown;

    try {
      compileMermaidDiagramComponent({
        attributes: {},
        children: [fence(source)],
        scopedChildren: [],
        position: {
          start: { line: 12, column: 3 },
          end: { line: 16, column: 20 },
        },
        diagnostics,
        renderArtifacts: new Map([
          [
            source,
            {
              light: '<svg xmlns="http://www.w3.org/2000/svg"></svg>',
              dark: '<svg xmlns="http://www.w3.org/2000/svg"></svg>',
            },
          ],
        ]),
      });
    } catch (error: unknown) {
      thrown = error;
    }

    expect(thrown).toBeInstanceOf(Error);
    if (!(thrown instanceof Error)) return;
    expect(thrown.message).toBe(
      "Internal error: Mermaid SVG review targets could not be prepared for MermaidDiagram #1 at line 12, column 3",
    );
    expect(thrown.message).not.toContain("source");
    expect(thrown.cause).toBeInstanceOf(Error);
    if (!(thrown.cause instanceof Error)) return;
    expect(thrown.cause.message).toContain("target mismatch");
    expect(diagnostics.diagnostics).toEqual([]);
  });
});
