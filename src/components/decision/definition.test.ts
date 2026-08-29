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
    expect(html).toContain("data-decision-selector");
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

  it("should render a settled Decision as the record it now is", () => {
    const html = render(`<Decision question="Which path?" state="decided">

<Option title="Canary" recommended chosen summary="Start narrow." />

<Option title="Global" />

</Decision>`);

    expect(html).toContain('data-decision-status="decided"');
    // The outcome closes the card where the confirm step used to sit, rather
    // than as a status pill above the options the reader has not read yet.
    expect(html).toContain("data-decision-decided");
    expect(html).toContain("Answer decided");
    expect(html).toContain(
      "Recorded in the plan source, so this question is settled.",
    );
    expect(html).not.toContain("decision-status-pill");
    expect(html).toContain("data-option-chosen");
    // A settled question keeps interaction="choose" and simply stops being
    // answerable, which is the one fact the card and the review runtime both
    // read: no selector, and every choice inert.
    expect(html).toContain('data-decision-interaction="choose"');
    expect(html).not.toContain("data-decision-selector");
  });

  it("should reject a chosen Option on a question still being asked", () => {
    expect(() =>
      render(`<Decision question="Which path?">

<Option title="Canary" chosen />

<Option title="Global" />

</Decision>`),
    ).toThrow(MarkdownDiagnosticsError);
  });

  it("should reject a settled Decision that names no chosen Option", () => {
    expect(() =>
      render(`<Decision question="Which path?" state="decided">

<Option title="Canary" />

<Option title="Global" />

</Decision>`),
    ).toThrow(MarkdownDiagnosticsError);
  });

  it("should reject two chosen Options", () => {
    expect(() =>
      render(`<Decision question="Which path?" state="decided">

<Option title="Canary" chosen />

<Option title="Global" chosen />

</Decision>`),
    ).toThrow(MarkdownDiagnosticsError);
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
