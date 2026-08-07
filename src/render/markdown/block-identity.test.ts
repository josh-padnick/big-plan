import { describe, expect, it } from "vitest";
import { compileMarkdown } from "./compile-markdown.js";
import { serializeHtml } from "../serialize-html.js";

const compile = (markdown: string) => {
  const { root, blocks } = compileMarkdown({ markdown });
  return { html: serializeHtml({ root }), blocks };
};

const attributesFor = ({
  html,
  id,
}: {
  readonly html: string;
  readonly id: string;
}): string => {
  const match = html.match(
    new RegExp(`<[a-z0-9]+[^>]*data-block-id="${id}"[^>]*>`),
  );
  return match === null ? "" : match[0];
};

const DECISION_FIXTURE = `## Calls

<Decision question="Which store?">

Context for the call.

<Option title="SQLite" recommended summary="Zero setup for local review.">

<Consideration label="Setup" verdict="None" tone="good" />

</Option>

<Option title="Postgres" summary="A server the reviewer must run.">

<Consideration label="Setup" verdict="A server" tone="bad" />

</Option>

</Decision>
`;

const SNIPPET_FIXTURE = `## Code

<CodeSnippet file="src/a.ts" startLine="12" showLineNumbers>

\`\`\`ts
const a = 1;
const b = 2;
\`\`\`

</CodeSnippet>
`;

describe("block identity scopes", () => {
  it("should address a slide's blocks under its own heading anchor", () => {
    const { blocks } = compile("## Status quo\n\nToday.\n\n- One\n- Two\n");
    expect(blocks.map((block) => block.id)).toEqual([
      "section/status-quo/heading-1",
      "section/status-quo/paragraph-1",
      "section/status-quo/list-1",
    ]);
  });

  it("should address everything above the first slide as the document", () => {
    const { blocks } = compile("# Plan\n\nThe lede.\n\n## One\n\nA.\n");
    expect(blocks.slice(0, 2).map((block) => block.id)).toEqual([
      "document/heading-1",
      "document/paragraph-1",
    ]);
  });

  it("should give a sub-slide its own scope when a section splits into h3 runs", () => {
    const { blocks } = compile("## Design\n\nIntro.\n\n### Pipeline\n\nHow.\n");
    expect(blocks.map((block) => block.id)).toEqual([
      "section/design/heading-1",
      "section/design/paragraph-1",
      "section/pipeline/heading-1",
      "section/pipeline/paragraph-1",
    ]);
  });

  it("should number repeats of one kind within a scope in document order", () => {
    const { blocks } = compile("## One\n\nA.\n\nB.\n\nC.\n");
    expect(blocks.map((block) => block.id)).toEqual([
      "section/one/heading-1",
      "section/one/paragraph-1",
      "section/one/paragraph-2",
      "section/one/paragraph-3",
    ]);
  });

  it("should address a bare document with no sections at all", () => {
    const { blocks } = compile("Just a sentence.\n");
    expect(blocks.map((block) => block.id)).toEqual(["document/paragraph-1"]);
  });
});

describe("block identity kinds and labels", () => {
  it("should name a component by its own heading when it has one", () => {
    const { blocks } = compile(DECISION_FIXTURE);
    const decision = blocks.find((block) => block.kind === "decision");
    expect(decision?.label).toBe("Which store?");
  });

  it("should carry the component name as the block kind when a component renders", () => {
    const { blocks } = compile(
      "## Contents\n\n<QuickSummary>\n\n<Why>\n\n- Value.\n\n</Why>\n\n<What>\n\n- Build it.\n\n</What>\n\n</QuickSummary>\n",
    );
    expect(blocks.map((block) => block.kind)).toContain("quick-summary");
  });

  it("should use a component's concise title instead of its control labels", () => {
    const { blocks } = compile(
      '## Metrics\n\n<DataTable title="Queue depth by processor">\n\n```table\n| Processor | Attempts |\n| --- | ---: |\n| Stripe | 3 |\n```\n\n</DataTable>\n',
    );
    const table = blocks.find((block) => block.kind === "data-table");
    expect(table?.label).toBe("Queue depth by processor");
  });

  it("should drop the generated kicker prefix from a sub-slide heading label", () => {
    const { blocks } = compile("## Design\n\n### The worker\n\nHow.\n");
    const heading = blocks.find(
      (block) => block.id === "section/the-worker/heading-1",
    );
    expect(heading?.label).toBe("The worker");
  });

  it("should truncate a long block's label rather than carry the whole paragraph", () => {
    const { blocks } = compile(`## One\n\n${"word ".repeat(60)}\n`);
    const paragraph = blocks.find((block) => block.kind === "paragraph");
    expect(paragraph?.label.length).toBeLessThanOrEqual(72);
    expect(paragraph?.label.endsWith("…")).toBe(true);
  });

  it("should restrict an id to a path-safe character set when a heading is not", () => {
    const { blocks } = compile("## Ship it! (v2) — now?\n\nBody.\n");
    for (const block of blocks) {
      expect(block.id).toMatch(/^[a-z0-9/-]+$/);
    }
  });
});

describe("block identity boundaries", () => {
  it("should leave a slide's generated kicker outside the block tree", () => {
    const { html } = compile("## One\n\nA.\n");
    expect(html).toMatch(/<p data-slide-kicker="" class="[^"]*">1 \/ One<\/p>/);
  });

  it("should address the scroll container rather than the table it wraps", () => {
    const { html, blocks } = compile(
      "## Rows\n\n| A | B |\n| --- | --- |\n| 1 | 2 |\n",
    );
    const table = blocks.find((block) => block.kind === "table");
    expect(table).toBeDefined();
    expect(attributesFor({ html, id: table?.id ?? "" })).toContain(
      "data-table-scroll-container",
    );
  });

  it("should give adjacent Markdown rows their concrete first-cell labels", () => {
    const { html, blocks } = compile(
      "## Rows\n\n| Field | Meaning |\n| --- | --- |\n| `versionId` | Content hash |\n| `number` | History position |\n",
    );
    const rows = blocks.filter((block) => block.kind === "table-row");
    expect(rows.map((row) => row.label)).toEqual([
      "Field",
      "versionId",
      "number",
    ]);
    expect(rows.map((row) => row.id)).toEqual([
      "section/rows/table-row-1",
      "section/rows/table-row-2",
      "section/rows/table-row-3",
    ]);
    expect(html).toContain('data-block-label="versionId"');
    expect(html).toContain('data-block-label="number"');
    expect(rows.every((row) => row.section === "Rows")).toBe(true);
  });

  it("should address every Markdown table value and each header-defined column", () => {
    const { blocks } = compile(
      "## Rows\n\n| Field | Meaning |\n| --- | --- |\n| `versionId` | Content hash |\n| `number` | History position |\n",
    );
    const columns = blocks.filter((block) => block.kind === "table-column");
    const cells = blocks.filter((block) => block.kind === "table-cell");
    expect(columns.map((column) => column.label)).toEqual([
      "Column: Field",
      "Column: Meaning",
    ]);
    expect(cells.map((cell) => cell.label)).toEqual([
      "Field: versionId",
      "Meaning: Content hash",
      "Field: number",
      "Meaning: History position",
    ]);
  });

  it("should expose each QuickSummary facet without opening private component markup", () => {
    const { blocks } = compile(
      "## Summary\n\n<QuickSummary>\n\n<Why>\n\n- Value.\n\n</Why>\n\n<What>\n\n- Build it.\n\n</What>\n\n<How>\n\n- Carefully.\n\n</How>\n\n</QuickSummary>\n",
    );
    expect(
      blocks
        .filter((block) => block.kind === "quick-summary-facet")
        .map((block) => block.label),
    ).toEqual(["Why", "What", "How"]);
  });

  it("should not address a component's private internals as blocks", () => {
    const { blocks } = compile(DECISION_FIXTURE);
    // The decision card is one target; its options and considerations are the
    // component's own markup, not separately addressed units.
    expect(blocks.filter((block) => block.kind === "decision")).toHaveLength(1);
    expect(blocks.map((block) => block.id)).toEqual([
      "section/calls/heading-1",
      "section/calls/decision-1",
    ]);
  });

  it("should give a code figure's rows their file-absolute line numbers", () => {
    const { html } = compile(SNIPPET_FIXTURE);
    expect(html).toContain('data-block-line="12"');
    expect(html).toContain('data-block-line="13"');
  });
});
