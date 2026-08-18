// Tests QuickDecision's standalone brief contract and intentionally small UI.

import { describe, expect, it } from "vitest";
import {
  MarkdownDiagnosticsError,
  renderDocument,
} from "../../render/render-document.js";

const render = (markdown: string): string =>
  renderDocument({ markdown, fallbackTitle: "Quick decision" }).html;

describe("QuickDecision", () => {
  it("should render the brief answer flow without comparison", () => {
    const html = render(
      '<QuickDecision question="Ship behind a flag?" context="The first week carries the risk.">\n\n<Option title="Yes" recommended summary="Rollback stays one toggle away." />\n\n<Option title="No" />\n\n</QuickDecision>',
    );

    expect(html).toContain("decision-brief");
    expect(html).toContain("Suggest another option");
    expect(html).not.toContain("Compare all three");
  });

  it("should mark a critical question where the reader is looking", () => {
    const html = render(
      '<QuickDecision critical question="Ship behind a flag?">\n\n<Option title="Yes" recommended />\n\n<Option title="No" />\n\n</QuickDecision>',
    );

    expect(html).toContain("data-decision-critical");
    expect(html).toContain("Critical");
  });

  it("should leave a question unmarked when the author did not mark it", () => {
    const html = render(
      '<QuickDecision question="Ship behind a flag?">\n\n<Option title="Yes" recommended />\n\n<Option title="No" />\n\n</QuickDecision>',
    );

    expect(html).not.toContain("data-decision-critical");
  });

  it("should reject an option body instead of dropping it", () => {
    expect(() =>
      render(
        '<QuickDecision question="Q?">\n\n<Option title="A">\n\nHidden prose.\n\n</Option>\n\n<Option title="B" />\n\n</QuickDecision>',
      ),
    ).toThrow(MarkdownDiagnosticsError);
  });
});
