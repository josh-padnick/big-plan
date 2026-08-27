// Proves the one-pass Markdown delivery is complete, deterministic, and
// semantic for the component cases where visual presentation carries meaning.

import { readFileSync } from "node:fs";
import rehypeStringify from "rehype-stringify";
import remarkGfm from "remark-gfm";
import remarkParse from "remark-parse";
import remarkRehype from "remark-rehype";
import { unified } from "unified";
import { describe, expect, it } from "vitest";
import { COMPONENT_REGISTRY } from "../components/_registration/registry.js";
import { renderMarkdownDocument } from "./render-markdown-document.js";

// The exported file is read outside the viewer, so these assertions read what
// a Markdown reader shows rather than the escape spelling behind it.
const readerHtml = (markdown: string): string =>
  String(
    unified()
      .use(remarkParse)
      .use(remarkGfm)
      .use(remarkRehype)
      .use(rehypeStringify)
      .processSync(markdown),
  );

const SNAPSHOT = "0123456789abcdef";

const COMPONENT_CONTRACT_MARKERS: ReadonlyArray<
  readonly [component: string, marker: string]
> = [
  ["Callout", "> **Note: Captain review**"],
  ["CodeDiff", "```diff"],
  ["CodeSnippet", "**Annotations**"],
  ["DataTable", "### Rollout gates"],
  ["DatabaseTableSchema", "### Database table: review.review\\_events"],
  ["Decision", "### Decision: Where should review-event persistence live?"],
  [
    "DecisionAnalysis",
    "### Decision: Which event store should back the first release?",
  ],
  ["FileTree", "### Review module layout"],
  ["FileTreeDiff", "Legend: Added, Modified, Removed, and Renamed"],
  ["FlowDiagram", "#### Connections"],
  ["GraphqlOperation", "### mutation reviewEventAppend"],
  ["GrpcMethod", "### bigplan.v1.ReviewService/WatchReviewEvents"],
  ["HttpEndpoint", "### POST /api/plans/{planId}/review-events"],
  ["MermaidDiagram", "```mermaid"],
  ["Part", "## Part 1 — Context and choices"],
  [
    "QuickDecision",
    "### Decision: Ship the workspace behind a local feature flag?",
  ],
  ["QuickSummary", "## Summary"],
  ["Slide", "> Slide structure — type: desired-experience"],
  ["TableOfContents", "## Plan outline"],
  ["Wireframe", "### Wireframe: Local review queue"],
];

const render = (markdown: string) =>
  renderMarkdownDocument({
    markdown,
    fallbackTitle: "Fallback plan",
    snapshot: SNAPSHOT,
  });

describe("Markdown document delivery", () => {
  it("should preserve authored Markdown and demote headings beneath Parts", () => {
    const result = render(`# Plan

Intro with **weight** and a [link](https://example.com).

## Before the part

<Part title="Delivery" />

## First increment

Details.
`);

    expect(result.markdown).toContain(`# Plan

> Exported plan version: \`${SNAPSHOT}\``);
    expect(result.markdown).toContain("## Before the part");
    expect(result.markdown).toContain("## Part 1 — Delivery");
    expect(result.markdown).toContain("### First increment");
    expect(result.markdown).toContain(
      "Intro with **weight** and a [link](https://example.com).",
    );
    expect(result.markdown.endsWith("\n")).toBe(true);
    expect(result.markdown.endsWith("\n\n")).toBe(false);
  });

  it("should deliver every registered component from the registry fixture", () => {
    const result = render(readFileSync("examples/all-components.mdx", "utf8"));
    const delivered = new Set(
      result.components.map((component) => component.component),
    );

    expect([...delivered].sort()).toEqual(
      Object.keys(COMPONENT_REGISTRY).sort(),
    );
    const prose = result.markdown.replace(/`{3,}[^\n]*\n[\s\S]*?\n`{3,}/gu, "");
    expect(prose).not.toMatch(/(?<!\\)<\/?[A-Z][A-Za-z]+(?:\s|>|\/)/u);
    expect(prose).not.toMatch(/<\/?(?:div|section|span|svg)\b/iu);
  });

  it.each(COMPONENT_CONTRACT_MARKERS)(
    "should preserve the semantic contract for %s",
    (_component, marker) => {
      const result = render(
        readFileSync("examples/all-components.mdx", "utf8"),
      );
      expect(result.markdown).toContain(marker);
    },
  );

  it("should make Decision, Mermaid, FlowDiagram, and Wireframe meaning explicit", () => {
    const result = render(readFileSync("examples/all-components.mdx", "utf8"));

    expect(result.markdown).toContain("### Decision:");
    expect(result.markdown).toContain("Recommendation:");
    expect(result.markdown).toContain("```mermaid");
    expect(result.markdown).toContain("#### Connections");
    expect(result.markdown).toContain("### Wireframe: Local review queue");
    expect(result.markdown).toContain("#### Screen: Review queue — Initial");
    expect(result.markdown).toContain("- UI outline:");
    expect(result.markdown).toContain("Navigation item: Open threads (active)");
  });

  it("should return byte-identical output for identical inputs", () => {
    const source = readFileSync("examples/all-components.mdx", "utf8");
    expect(render(source).markdown).toBe(render(source).markdown);
  });

  it("should keep adversarial scores, states, edges, annotations, and image meaning", () => {
    const result = render(
      readFileSync("examples/markdown-export-adversarial.mdx", "utf8"),
    );

    for (const meaning of [
      "**Normalized weighted totals**",
      "score 5/5",
      "Method: Σ(impact × option score)",
      "**Reversibility:** somewhat-hard",
      "candidate | unblocks after validation | canary",
      "**Lines 41-42:** Validation must settle",
      "![Operator confirmation state](data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==)",
      "#### Screen: Ready to release — Initial",
      "Badge: Checks passed (tone: success)",
      "text field: Approval code (value: Confirmed; disabled)",
      "navigates to screen ready",
    ]) {
      expect(result.markdown).toContain(meaning);
    }
  });

  it("should keep the version beside a title that is not the first block", () => {
    const result = render(`| Gate | Owner |
| --- | --- |
| Canary | Release |

# Plan

Body.
`);

    const html = readerHtml(result.markdown);
    expect(html).toContain("<td>Canary</td>");
    expect(html).toContain("<td>Release</td>");
    expect(result.markdown).toContain(`# Plan

> Exported plan version: \`${SNAPSHOT}\``);
  });

  it("should keep authored table text readable through a component table", () => {
    const result = render(`# Plan

<DataTable title="Identifiers">

\`\`\`table
| Column | Example |
| --- | --- |
| plan_id | C:\\tmp |
| a * b | left \\| right |
\`\`\`

</DataTable>
`);

    const html = readerHtml(result.markdown);
    expect(html).toContain("<td>plan_id</td>");
    expect(html).toContain("<td>C:\\tmp</td>");
    expect(html).toContain("<td>a * b</td>");
    expect(html).toContain("<td>left | right</td>");
  });

  it("should keep a multi-paragraph consideration inside its decision bullet", () => {
    const result = render(`# Plan

<Decision question="Which store?">

<Option title="PostgreSQL" recommended summary="Shared relational store.">

<Consideration label="Integrity" verdict="Excellent" tone="good">

Transactions keep the rows atomic.

A second paragraph carries the caveat.

</Consideration>

</Option>

<Option title="SQLite" summary="One embedded file.">

<Consideration label="Integrity" verdict="Strong" tone="good">

Local transactions cover the rows.

</Consideration>

</Option>

</Decision>
`);

    const html = readerHtml(result.markdown);
    const detail = "A second paragraph carries the caveat.";
    expect(html).toContain(`<p>${detail}</p>`);
    expect(html.slice(0, html.indexOf(detail))).toContain("<li>");
    expect(html.slice(html.indexOf(detail))).toContain("</li>");
  });

  it("should keep each criterion's authored rationale beside the matrix", () => {
    const result = render(
      readFileSync("examples/markdown-export-adversarial.mdx", "utf8"),
    );

    const html = readerHtml(result.markdown);
    expect(html).toContain(
      "<strong>Integrity</strong> (impact 5/5) — Related release records must commit together.",
    );
    expect(html).toContain(
      "<strong>Local setup</strong> (impact 2/5) — The first operator should start without another service.",
    );
  });

  it("should keep the weighted method note out of the last option's score", () => {
    const html = readerHtml(
      render(readFileSync("examples/markdown-export-adversarial.mdx", "utf8"))
        .markdown,
    );
    expect(html).toContain(
      "<p>Method: Σ(impact × option score) ÷ Σ(impact × 5), normalized to 100%.</p>",
    );
    expect(html).not.toMatch(/<li>[^<]*Method: Σ/u);
  });

  it("should keep a Callout label separate from its first body sentence", () => {
    const html = readerHtml(
      render(`# Plan

<Callout type="note" title="Captain review">

First body paragraph.

Second body paragraph.

</Callout>
`).markdown,
    );

    expect(html).toContain("<p><strong>Note: Captain review</strong></p>");
    expect(html).toContain("<p>First body paragraph.</p>");
  });

  it("should keep authored Markdown punctuation literal outside tables", () => {
    const html = readerHtml(
      render(`# Plan

<Decision question="Should we call __init__ or a factory?">

<Option title="Call __init__" summary="Keep the *direct* path.">

<Consideration label="Clarity" verdict="Exact" tone="good">

The reader sees the constructor.

</Consideration>

</Option>

<Option title="Use a factory" summary="Hide construction.">

<Consideration label="Clarity" verdict="Indirect" tone="mixed">

The reader follows one more hop.

</Consideration>

</Option>

</Decision>
`).markdown,
    );

    expect(html).toContain(
      "<h3>Decision: Should we call __init__ or a factory?</h3>",
    );
    expect(html).toContain("<h4>Option: Call __init__</h4>");
    expect(html).toContain("<p>Keep the *direct* path.</p>");
    expect(html).not.toContain("<strong>init</strong>");
  });

  it("should keep an outline component nested in a component body", () => {
    const result = render(`# Plan

<Callout type="note" title="Scope">

<Part title="Delivery" />

</Callout>

## After the part
`);

    const html = readerHtml(result.markdown);
    expect(html).toContain("Part — Delivery");
    expect(result.components.map((component) => component.component)).toContain(
      "Part",
    );
  });

  it("should demote component headings beneath the Part that owns them", () => {
    const result = render(`# Plan

## Before the part

<DataTable title="Rollout gates">

\`\`\`table
| Gate | Owner |
| --- | --- |
| Canary | Release |
\`\`\`

</DataTable>

<Part title="Delivery" />

## Inside the part

<DataTable title="Release gates">

\`\`\`table
| Gate | Owner |
| --- | --- |
| Canary | Release |
\`\`\`

</DataTable>

<QuickSummary>

<Why>

- The queue must survive a restart.

</Why>

<What>

- Persist every retry attempt.

</What>

<How>

- Move retries into a worker.

</How>

</QuickSummary>
`);

    const levels = result.markdown
      .split("\n")
      .filter((line) => /^#{1,6} /u.test(line));

    expect(levels).toEqual([
      "# Plan",
      "## Before the part",
      "### Rollout gates",
      "## Part 1 — Delivery",
      "### Inside the part",
      "#### Release gates",
      "### Summary",
    ]);
  });

  it("should preserve authored referential actions in a schema export", () => {
    const result = render(`# Plan

<DatabaseTableSchema name="public.orders">

\`\`\`dbml
id          bigint [pk]
customer_id bigint [not null, ref: > public.customers.id, delete: cascade, update: set null]
\`\`\`

</DatabaseTableSchema>
`);

    const html = readerHtml(result.markdown);
    expect(html).toContain(
      "<td>not null, references public.customers.id on delete cascade on update set null</td>",
    );
  });

  it("should keep a fenced example out of the table row it cannot fit in", () => {
    const result = render(`# Plan

<HttpEndpoint method="GET" path="/api/orders">

<Param name="filter" in="query" type="string">

Restricts the result set. Example:

\`\`\`json
{ "status": "open" }
\`\`\`

</Param>

</HttpEndpoint>
`);

    const html = readerHtml(result.markdown);
    expect(html).toContain("<td>Restricts the result set. Example:</td>");
    expect(html).toContain(
      '<pre><code class="language-json">{ "status": "open" }\n</code></pre>',
    );
    expect(html).toContain("<p><strong>filter</strong></p>");
    expect(html).not.toMatch(/<td>[^<]*```/u);
  });

  it("should keep a Slide's wireframe reason its own paragraph", () => {
    const html = readerHtml(
      render(`# Plan

<Slide type="user-journey" name="Operator queue" toc="Queue" wireframeReason="The queue is the product." />

## Operator queue
`).markdown,
    );

    expect(html).toContain(
      "<p>Slide structure — type: user-journey; name: Operator queue; outline label: Queue</p>",
    );
    expect(html).toContain(
      "<p>Wireframe reason: The queue is the product.</p>",
    );
  });

  it("should keep an authored bullet's inline markup in one list item", () => {
    const result = render(`# Plan

- Do **this** now and [read](https://example.com) it
- Second item with \`code\` inline
- Parent item
  - Nested child
- [x] Done task
- [ ] Open task

1. First **step**
2. Second step
`);

    const html = readerHtml(result.markdown);
    expect(html).toContain(
      '<li>Do <strong>this</strong> now and <a href="https://example.com">read</a> it</li>',
    );
    expect(html).toContain(
      "<li>Second item with <code>code</code> inline</li>",
    );
    expect(html).toContain("<li>First <strong>step</strong></li>");
    expect(html).toContain("<li>Second step</li>");
    expect(html).toContain("<li>Nested child</li>");
    expect(html).toContain("Done task");
    expect(html).toContain("Open task");
    // A tight item never wraps its own sentence in a paragraph.
    expect(html).not.toMatch(/<li>\s*<p>Do /u);
    expect(html).not.toMatch(/<li>\s*<p>Parent item<\/p>/u);
  });

  it("should keep a QuickSummary bullet's inline markup in one item", () => {
    const html = readerHtml(
      render(`# Plan

<QuickSummary>

<Why>

- The **retry queue** must survive a restart.

</Why>

<What>

- Persist every [attempt](https://example.com/audit).

</What>

<How>

- Move retries into a worker.

</How>

</QuickSummary>
`).markdown,
    );

    expect(html).toContain(
      "<li>The <strong>retry queue</strong> must survive a restart.</li>",
    );
    expect(html).toContain(
      '<li>Persist every <a href="https://example.com/audit">attempt</a>.</li>',
    );
  });

  it("should keep a multi-paragraph authored item loose as authored", () => {
    const html = readerHtml(
      render(`# Plan

- One paragraph

  Second paragraph inside the item

- Another item
`).markdown,
    );

    expect(html).toContain("<p>One paragraph</p>");
    expect(html).toContain("<p>Second paragraph inside the item</p>");
    expect(html).toContain("<p>Another item</p>");
  });

  it("should keep a soft-wrapped description in its row without repeating it", () => {
    const result = render(`# Plan

<HttpEndpoint method="POST" path="/api/events">

<Param name="anchor" in="body" type="SourceAnchor">

Source location the event refers to, captured against the current plan
revision.

</Param>

<Param name="filter" in="query" type="string">

Restricts the result set. Example:

\`\`\`json
{ "status": "open" }
\`\`\`

</Param>

</HttpEndpoint>
`);

    expect(
      result.markdown.match(/Source location the event refers to/gu),
    ).toHaveLength(1);
    expect(result.markdown).not.toContain("**anchor**");
    const html = readerHtml(result.markdown);
    expect(html).toContain(
      "<td>Source location the event refers to, captured against the current plan revision.</td>",
    );
    // The description that genuinely carries a block still keeps it.
    expect(html).toContain("<p><strong>filter</strong></p>");
    expect(html).toContain(
      '<pre><code class="language-json">{ "status": "open" }\n</code></pre>',
    );
  });

  it("should keep a tilde in authored component text literal", () => {
    const html = readerHtml(
      render(`# Plan

<DataTable title="Latency">

\`\`\`table
| Stage | Budget |
| --- | --- |
| Capture | approx ~5~ ms |
\`\`\`

</DataTable>
`).markdown,
    );

    expect(html).toContain("<td>approx ~5~ ms</td>");
    expect(html).not.toContain("<del>");
  });

  it("should keep an authored hard line break inside its paragraph", () => {
    const html = readerHtml(
      render(`# Plan

Strike ~~gone~~ and break here\\
next line.

Two spaces form:  
second line here.
`).markdown,
    );

    expect(html).toContain(
      "<p>Strike <del>gone</del> and break here<br>\nnext line.</p>",
    );
    expect(html).toContain("<p>Two spaces form:<br>\nsecond line here.</p>");
  });

  it("should keep a description that opens with inline code in its row", () => {
    const result = render(`# Plan

<HttpEndpoint method="POST" path="/api/events">

<Param name="clientEventId" in="body" type="string">

\`clientEventId\` is the idempotency key for this
append attempt.

</Param>

</HttpEndpoint>
`);

    expect(result.markdown).not.toContain("**clientEventId**\n");
    const html = readerHtml(result.markdown);
    expect(html).toContain(
      "<td><code>clientEventId</code> is the idempotency key for this append attempt.</td>",
    );
  });
});
