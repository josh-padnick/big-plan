// Exercises Slide's closed type attribute, self-closing body contract, model,
// and marker-only HTML behavior through the complete compilation pipeline.

import { describe, expect, it } from "vitest";
import { compilePlanModel } from "../../render/compile-plan-model.js";
import { compileMarkdown } from "../../render/markdown/compile-markdown.js";
import { serializeHtml } from "../../render/serialize-html.js";
import { MarkdownDiagnosticsError } from "../../render/render-document.js";

describe("Slide component", () => {
  it("should collect the declared type in the component and section models", () => {
    const plan = compilePlanModel({
      markdown:
        '<Slide type="status-quo" />\n\n## Inline retries delay checkout\n\nToday.\n',
      fallbackTitle: "Plan",
    });

    expect(plan.components).toMatchObject([
      {
        component: "Slide",
        model: { type: "status-quo" },
      },
    ]);
    expect(plan.sections).toEqual([
      {
        id: "inline-retries-delay-checkout",
        name: "Status quo",
        title: "Inline retries delay checkout",
        type: "status-quo",
      },
    ]);
  });

  it("should consume the marker instead of emitting marker HTML", () => {
    const compiled = compileMarkdown({
      markdown:
        '<Slide type="status-quo" />\n\n## Inline retries delay checkout\n\nToday.\n',
    });
    const html = serializeHtml({ root: compiled.root });

    expect(html).toContain(">1 / Status quo</p>");
    expect(html).toContain(
      '<h2 id="inline-retries-delay-checkout">Inline retries delay checkout</h2>',
    );
    expect(html).not.toContain("data-outline-slide-type");
    expect(html).not.toContain("data-slide-marker");
  });

  it("should reject unknown types with the complete closed catalog", () => {
    expect(() =>
      compileMarkdown({
        markdown: '<Slide type="architecture" />\n\n## The boundary\n',
      }),
    ).toThrowError(MarkdownDiagnosticsError);
    try {
      compileMarkdown({
        markdown: '<Slide type="architecture" />\n\n## The boundary\n',
      });
    } catch (error: unknown) {
      if (!(error instanceof MarkdownDiagnosticsError)) {
        throw error;
      }
      expect(error.diagnostics[0]?.message).toContain(
        "expected one of: status-quo, desired-experience, desired-outcome, user-journey, acceptance-criteria",
      );
    }
  });

  it("should reject body content", () => {
    expect(() =>
      compileMarkdown({
        markdown:
          '<Slide type="status-quo">\n\nBody.\n\n</Slide>\n\n## Today\n',
      }),
    ).toThrowError(MarkdownDiagnosticsError);
  });

  it("should reject a marker that is not immediately followed by its top-level h2", () => {
    try {
      compileMarkdown({
        markdown:
          '<Slide type="status-quo" />\n\nProse in between.\n\n## Today\n',
      });
      throw new Error("expected diagnostics");
    } catch (error: unknown) {
      if (!(error instanceof MarkdownDiagnosticsError)) {
        throw error;
      }
      expect(error.diagnostics).toMatchObject([
        {
          message:
            "Slide must be a top-level self-closing marker immediately followed by the h2 it describes",
          line: 1,
          column: 1,
        },
      ]);
    }
  });

  it("should reject a marker nested inside another component", () => {
    expect(() =>
      compileMarkdown({
        markdown:
          '<Callout type="note">\n\n<Slide type="status-quo" />\n\n## Today\n\n</Callout>\n',
      }),
    ).toThrowError(MarkdownDiagnosticsError);
  });
});
