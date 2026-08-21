// Tests Decision's comparison-card contract and shared answer presentation.

import { describe, expect, it } from "vitest";
import {
  MarkdownDiagnosticsError,
  renderDocument,
} from "../../render/render-document.js";

const render = (markdown: string): string =>
  renderDocument({ markdown, fallbackTitle: "Decision" }).html;

describe("Decision", () => {
  it("should render option-local considerations as comparison cards", () => {
    const html = render(`<Decision question="Which path?">

<Option title="Canary" recommended summary="Start narrow.">

<Consideration label="Risk" verdict="Low" tone="good">

Only one region sees the first release.

</Consideration>

</Option>

<Option title="Global">

<Consideration label="Risk" verdict="High" tone="bad">

Every region sees the change together.

</Consideration>

</Option>

</Decision>`);

    expect(html).toContain("decision-rows");
    expect(html).toContain("decision-option-card");
    expect(html).toContain('data-decision-tone="good"');
    expect(html).toContain(">Risk<");
    expect(html).toContain('data-decision-definition="criterion"');
    expect(html).toContain('data-decision-layout="rows"');
    expect(html).toContain("data-decision-approved-note");
    expect(html).toContain(
      "This plan is approved. To choose an option, revoke the approval first.",
    );
  });

  it("should keep criterion labels plain when no detail is authored", () => {
    const html = render(`<Decision question="Which path?">

<Option title="Canary">
<Consideration label="Risk" verdict="Low" />
</Option>

<Option title="Global">
<Consideration label="Risk" verdict="High" />
</Option>

</Decision>`);

    expect(html).not.toContain('data-decision-definition="criterion"');
  });

  it("should reject option prose that cannot render", () => {
    expect(() =>
      render(`<Decision question="Which path?">

<Option title="A">

Hidden prose.

</Option>

<Option title="B" />

</Decision>`),
    ).toThrow(MarkdownDiagnosticsError);
  });
});
