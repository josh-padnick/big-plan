// Tests the plan-model compiler: component models collected in document
// order with positions, ID parity with the rendered document, nested
// component collection, and the same hard-fail behavior as rendering.

import { describe, expect, it } from "vitest";
import { compilePlanModel } from "./compile-plan-model.js";
import { MarkdownDiagnosticsError, renderDocument } from "./render-document.js";

const PLAN = `# Storage plan

## Decision

<Callout type="note" title="Scope">

One decision only.

</Callout>

<DecisionAnalysis question="Which store?" state="proposed" interaction="audit">

<Criterion title="Setup">

How much local setup the store requires.

</Criterion>

<Option title="PostgreSQL" recommended summary="The team already runs it.">

<Score criterion="Setup" verdict="Needs a server" tone="bad">

A database service must be running.

</Score>

</Option>

<Option title="SQLite">

<Score criterion="Setup" verdict="Zero setup" tone="good">

The process opens the file directly.

</Score>

</Option>

<Reversibility rating="somewhat-hard">

Changing stores requires a data migration.

</Reversibility>

</DecisionAnalysis>
`;

const bigDecisionModelOf = (markdown: string): Record<string, unknown> => {
  const plan = compilePlanModel({ markdown, fallbackTitle: "fallback" });
  const entry = plan.components.find(
    ({ component }) => component === "DecisionAnalysis",
  );
  if (entry === undefined || typeof entry.model !== "object") {
    throw new Error("DecisionAnalysis model missing");
  }
  return entry.model as Record<string, unknown>;
};

describe("compilePlanModel", () => {
  it("should collect every component model in document order with positions", () => {
    const plan = compilePlanModel({ markdown: PLAN, fallbackTitle: "x" });

    expect(plan.title).toBe("Storage plan");
    expect(plan.sections.map(({ name }) => name)).toEqual(["Decision"]);
    expect(plan.components.map(({ component }) => component)).toEqual([
      "Callout",
      "DecisionAnalysis",
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

  // Machine delivery is what an agent reads before it edits a plan. Without
  // the address a reviewer's comment resolves to, the agent holds a model it
  // cannot connect to anything the reviewer said about it.
  it("should carry the block address a comment on each component resolves to", () => {
    const plan = compilePlanModel({ markdown: PLAN, fallbackTitle: "x" });
    const { html } = renderDocument({ markdown: PLAN, fallbackTitle: "x" });

    expect(
      plan.components.map(({ component, blockId }) => ({
        component,
        blockId,
      })),
    ).toEqual([
      { component: "Callout", blockId: "section/decision/callout-1" },
      {
        component: "DecisionAnalysis",
        blockId: "section/decision/decision-analysis-1",
      },
    ]);
    for (const { blockId } of plan.components) {
      expect(html).toContain(`data-block-id="${String(blockId)}"`);
    }
  });

  // A component rendered inside another component's markup is private: no
  // reader can point at it, so claiming an address for it would be a lie.
  it("should leave a component with no address of its own without a blockId", () => {
    const plan = compilePlanModel({
      markdown:
        '<Decision question="Q?">\n\n<Callout type="note">\n\nNested context.\n\n</Callout>\n\n<Option title="A" />\n\n<Option title="B" />\n\n</Decision>\n',
      fallbackTitle: "x",
    });

    expect(
      plan.components.map(({ component, blockId }) => ({
        component,
        blockId,
      })),
    ).toEqual([
      { component: "Decision", blockId: "document/decision-1" },
      { component: "Callout", blockId: undefined },
    ]);
  });

  // The key that makes the join exact is delivery-local: it names one instance
  // inside one compilation, so publishing it would invite a consumer to store
  // an address that means nothing on the next compile.
  it("should keep the delivery-local instance key out of machine delivery", () => {
    const plan = compilePlanModel({ markdown: PLAN, fallbackTitle: "x" });

    expect(JSON.stringify(plan)).not.toContain("instanceKey");
  });

  it("should fall back to the caller's title when the plan has no h1", () => {
    const plan = compilePlanModel({
      markdown: '<Callout type="tip">\n\nJust a tip.\n\n</Callout>\n',
      fallbackTitle: "Untitled plan",
    });
    expect(plan.title).toBe("Untitled plan");
    expect(plan.components).toHaveLength(1);
  });

  it("should retain authored headings nested inside a component body", () => {
    const plan = compilePlanModel({
      markdown:
        '<Callout type="note">\n\n# Nested title\n\n## Nested section\n\nBody.\n\n</Callout>\n',
      fallbackTitle: "fallback",
    });

    expect(plan.title).toBe("Nested title");
    expect(plan.sections).toEqual([
      {
        id: "nested-section",
        name: "Nested section",
        title: "Nested section",
      },
    ]);
  });

  it("should list a parent before its nested component in document order", () => {
    const plan = compilePlanModel({
      markdown:
        '<Decision question="Q?">\n\n<Callout type="note">\n\nNested context.\n\n</Callout>\n\n<Option title="A" />\n\n<Option title="B" />\n\n</Decision>\n',
      fallbackTitle: "x",
    });
    expect(plan.components.map(({ component }) => component)).toEqual([
      "Decision",
      "Callout",
    ]);
  });

  it("should present a nested outline component instead of leaking its placeholder", () => {
    const plan = compilePlanModel({
      markdown:
        '<Callout type="note">\n\n<Part title="Context" />\n\n</Callout>\n',
      fallbackTitle: "x",
    });
    const serialized = JSON.stringify(plan.components);

    expect(serialized).not.toContain("data-outline-placeholder");
    expect(serialized).toContain("data-part-title");
  });

  it("should hard-fail on diagnostics exactly as rendering does", () => {
    expect(() =>
      compilePlanModel({
        markdown: '<Decision question="Q?">\n\n</Decision>\n',
        fallbackTitle: "x",
      }),
    ).toThrow(MarkdownDiagnosticsError);
  });

  it("should not duplicate diagnostics through model collection", () => {
    try {
      compilePlanModel({
        markdown:
          '<Decision question="Q?">\n\n<Option title="A" />\n\n<Option title="A" />\n\n</Decision>\n',
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
