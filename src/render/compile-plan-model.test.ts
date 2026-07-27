// Tests the plan-model compiler: component models collected in document
// order with positions, ID parity with the rendered document, nested
// component collection, and the same hard-fail behavior as rendering.

import { describe, expect, it } from "vitest";
import {
  MarkdownDiagnosticsError,
  compilePlanModel,
  renderDocument,
} from "./render-document.js";

const PLAN = `# Storage plan

## Decision

<Callout type="note" title="Scope">

One decision only.

</Callout>

<BigDecision question="Which store?" status="open">

<Criterion title="Setup" />

<Option title="PostgreSQL" recommended summary="The team already runs it.">

<Score criterion="Setup" verdict="Needs a server" tone="bad" />

</Option>

<Option title="SQLite">

<Score criterion="Setup" verdict="Zero setup" tone="good" />

</Option>

</BigDecision>
`;

const bigDecisionModelOf = (markdown: string): Record<string, unknown> => {
  const plan = compilePlanModel({ markdown, fallbackTitle: "fallback" });
  const entry = plan.components.find(
    ({ component }) => component === "BigDecision",
  );
  if (entry === undefined || typeof entry.model !== "object") {
    throw new Error("BigDecision model missing");
  }
  return entry.model as Record<string, unknown>;
};

describe("compilePlanModel", () => {
  it("should collect every component model in document order with positions", () => {
    const plan = compilePlanModel({ markdown: PLAN, fallbackTitle: "x" });

    expect(plan.title).toBe("Storage plan");
    expect(plan.sections.map(({ text }) => text)).toEqual(["Decision"]);
    expect(plan.components.map(({ component }) => component)).toEqual([
      "Callout",
      "BigDecision",
    ]);
    const callout = plan.components[0];
    expect(callout?.line).toBe(5);
    expect(callout?.model).toMatchObject({ type: "note", title: "Scope" });
    expect(plan.components[1]?.model).toMatchObject({
      question: "Which store?",
      status: "open",
      options: [
        { title: "PostgreSQL", recommended: true },
        { title: "SQLite" },
      ],
    });
  });

  it("should emit the same ids the rendered document carries", () => {
    const model = bigDecisionModelOf(PLAN);
    const { html } = renderDocument({ markdown: PLAN, fallbackTitle: "x" });
    const options = model["options"];
    if (!Array.isArray(options)) {
      throw new Error("options missing");
    }
    for (const option of options) {
      const id: unknown = (option as Record<string, unknown>)["id"];
      expect(typeof id).toBe("string");
      expect(html).toContain(`id="${String(id)}"`);
    }
  });

  it("should fall back to the caller's title when the plan has no h1", () => {
    const plan = compilePlanModel({
      markdown: '<Callout type="tip">\n\nJust a tip.\n\n</Callout>\n',
      fallbackTitle: "Untitled plan",
    });
    expect(plan.title).toBe("Untitled plan");
    expect(plan.components).toHaveLength(1);
  });

  it("should list a parent before its nested component in document order", () => {
    const plan = compilePlanModel({
      markdown:
        '<BigDecision question="Q?">\n\n<Callout type="note">\n\nNested context.\n\n</Callout>\n\n<Option title="A" />\n\n<Option title="B" />\n\n</BigDecision>\n',
      fallbackTitle: "x",
    });
    expect(plan.components.map(({ component }) => component)).toEqual([
      "BigDecision",
      "Callout",
    ]);
  });

  it("should hard-fail on diagnostics exactly as rendering does", () => {
    expect(() =>
      compilePlanModel({
        markdown: '<BigDecision question="Q?">\n\n</BigDecision>\n',
        fallbackTitle: "x",
      }),
    ).toThrow(MarkdownDiagnosticsError);
  });

  it("should not duplicate diagnostics through model collection", () => {
    try {
      compilePlanModel({
        markdown:
          '<BigDecision question="Q?">\n\n<Option title="A" />\n\n<Option title="A" />\n\n</BigDecision>\n',
        fallbackTitle: "x",
      });
      throw new Error("expected diagnostics");
    } catch (error: unknown) {
      if (!(error instanceof MarkdownDiagnosticsError)) {
        throw error;
      }
      const duplicates = error.diagnostics.filter(({ message }) =>
        message.includes("Duplicate Option title"),
      );
      expect(duplicates).toHaveLength(1);
    }
  });
});
